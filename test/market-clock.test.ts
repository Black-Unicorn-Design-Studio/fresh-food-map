import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isUsableTimezone, marketClock } from '../src/lib/market-clock';
import { isOpenNow, type Market } from '../src/lib/markets';

/**
 * `isOpenNow` read the device clock while a market's schedule means local time at the market.
 * These pin the difference, which is invisible until the two are in different zones.
 */
const market = (over: Partial<Market> = {}): Market => ({
  id: 'x',
  name: 'Test Market',
  address: 'Somewhere',
  lat: 0,
  lon: 0,
  schedule: [{ day: 'sat', open: '09:00', close: '13:00' }],
  seasonStart: null,
  seasonEnd: null,
  website: null,
  source: 'manual',
  tags: [],
  ...over,
});

describe('marketClock', () => {
  test('reports the time where the market is, not where the reader is', () => {
    // 15:00 UTC on Saturday 19 September 2026.
    const now = new Date('2026-09-19T15:00:00Z');
    assert.deepEqual(marketClock('America/New_York', now), {
      day: 'sat',
      minutes: 11 * 60,
      monthDay: '09-19',
    });
    assert.deepEqual(marketClock('Europe/London', now), {
      day: 'sat',
      minutes: 16 * 60,
      monthDay: '09-19',
    });
  });

  test('daylight saving is the rules, not an offset', () => {
    // New York is UTC-4 in September and UTC-5 in January. A stored offset would be an hour
    // wrong for eight months of the year, which is why the dataset keeps an IANA name.
    assert.equal(marketClock('America/New_York', new Date('2026-09-19T15:00:00Z')).minutes, 11 * 60);
    assert.equal(marketClock('America/New_York', new Date('2026-01-17T15:00:00Z')).minutes, 10 * 60);
  });

  test('a zone with no daylight saving keeps the same wall clock all year', () => {
    // Jamaica is the negative that proves the rule above: America/Jamaica has never observed
    // daylight saving, so unlike New York it reads the same in January and September. It also
    // means a Jamaican market and an Eastern-US one agree for half the year and differ for
    // the other half — which is exactly the case a stored UTC offset would get wrong, and
    // exactly why the dataset stores a zone name instead.
    assert.equal(marketClock('America/Jamaica', new Date('2026-09-19T15:00:00Z')).minutes, 10 * 60);
    assert.equal(marketClock('America/Jamaica', new Date('2026-01-17T15:00:00Z')).minutes, 10 * 60);
    // New York matches it in winter and is an hour ahead in summer.
    assert.equal(marketClock('America/New_York', new Date('2026-01-17T15:00:00Z')).minutes, 10 * 60);
    assert.equal(marketClock('America/New_York', new Date('2026-09-19T15:00:00Z')).minutes, 11 * 60);
  });

  test('the market can be on a different day from the reader', () => {
    // 23:30 UTC Saturday is still Saturday evening in London and already the small hours of
    // Sunday in Sydney — so a Sunday market there is open and a Saturday one is not.
    const now = new Date('2026-09-19T23:30:00Z');
    assert.equal(marketClock('Europe/London', now).day, 'sun');
    assert.equal(marketClock('America/Los_Angeles', now).day, 'sat');
  });

  test('a missing zone falls back rather than throwing', () => {
    // A dataset refetched from a CDN can be older than the app reading it.
    const clock = marketClock(undefined, new Date('2026-09-19T15:00:00Z'));
    assert.ok(typeof clock.minutes === 'number' && clock.minutes >= 0);
    assert.match(clock.monthDay, /^\d{2}-\d{2}$/);
  });

  test('an unknown zone falls back rather than throwing', () => {
    const clock = marketClock('Mars/Olympus_Mons', new Date('2026-09-19T15:00:00Z'));
    assert.ok(typeof clock.minutes === 'number');
  });

  test('isUsableTimezone is the check the schema makes', () => {
    assert.equal(isUsableTimezone('Europe/London'), true);
    assert.equal(isUsableTimezone('America/New_York'), true);
    assert.equal(isUsableTimezone('Mars/Olympus_Mons'), false);
  });
});

describe('isOpenNow across timezones', () => {
  test('a Maryland market is shut when Manchester thinks it is mid-morning', () => {
    // The reported bug, exactly: 10:00 in Manchester is 05:00 in Maryland, and a market
    // trading 09:00-13:00 there has not opened. Reading the device clock said it had.
    const now = new Date('2026-09-19T09:00:00Z'); // 10:00 BST, 05:00 EDT
    const maryland = market({ timezone: 'America/New_York' });
    assert.equal(isOpenNow(maryland, now), false);
  });

  test('and open when it actually is, wherever the reader stands', () => {
    const now = new Date('2026-09-19T14:00:00Z'); // 10:00 EDT — open
    assert.equal(isOpenNow(market({ timezone: 'America/New_York' }), now), true);
    // The same instant is 15:00 in London, so a London market on the same hours has shut.
    assert.equal(isOpenNow(market({ timezone: 'Europe/London' }), now), false);
  });

  test('the season ends when the month does where the stalls are', () => {
    // 23:30 UTC on 30 September is already 1 October in London: a season ending 09-30 is over
    // there while it is still September for a reader further west.
    const now = new Date('2026-09-30T23:30:00Z');
    const ended = market({
      timezone: 'Europe/London',
      seasonStart: '05-01',
      seasonEnd: '09-30',
      schedule: [{ day: 'thu', open: '00:00', close: '23:59' }],
    });
    assert.equal(isOpenNow(ended, now), false, 'October in London means the season is over');
  });
});
