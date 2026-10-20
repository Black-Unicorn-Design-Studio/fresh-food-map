import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { hoursFor, scheduleFor, type SubmitForm } from '../src/lib/submit';

/**
 * Per-day hours on the submit form.
 *
 * The form carries one shared open/close pair plus a sparse map of per-day overrides, and
 * `scheduleFor` is the only thing that turns those two into what the wire actually sees.
 * The invariants below are the ones that decide whether a market's hours arrive correct,
 * arrive wrong, or fail validation for a reason nobody typed.
 */

const BASE: SubmitForm = {
  name: 'Cedar Square Market',
  address: '18 Cedar Square, Portland OR',
  lat: '45.523100',
  lon: '-122.676500',
  website: '',
  days: [],
  open: '',
  close: '',
  perDayHours: false,
  dayHours: {},
  tags: [],
  note: '',
};

const form = (over: Partial<SubmitForm>): SubmitForm => ({ ...BASE, ...over });

describe('scheduleFor', () => {
  it('gives every selected day the shared pair when per-day is off', () => {
    const s = scheduleFor(form({ days: ['sat', 'wed'], open: '08:00', close: '13:00' }));
    assert.deepEqual(s, [
      { day: 'wed', open: '08:00', close: '13:00' },
      { day: 'sat', open: '08:00', close: '13:00' },
    ]);
  });

  it('lets one day differ while the rest keep the shared pair', () => {
    const s = scheduleFor(
      form({
        days: ['sat', 'wed'],
        open: '08:00',
        close: '13:00',
        perDayHours: true,
        dayHours: { wed: { open: '15:00', close: '19:00' } },
      }),
    );
    assert.deepEqual(s, [
      { day: 'wed', open: '15:00', close: '19:00' },
      { day: 'sat', open: '08:00', close: '13:00' },
    ]);
  });

  it('ignores overrides entirely while the mode is off', () => {
    const s = scheduleFor(
      form({
        days: ['wed'],
        open: '08:00',
        close: '13:00',
        perDayHours: false,
        dayHours: { wed: { open: '15:00', close: '19:00' } },
      }),
    );
    assert.deepEqual(
      s,
      [{ day: 'wed', open: '08:00', close: '13:00' }],
      'turning the switch off must not leave a stale override reaching the wire',
    );
  });

  it('drops a day whose pair is incomplete rather than sending it half-filled', () => {
    const s = scheduleFor(
      form({
        days: ['sat', 'wed'],
        open: '08:00',
        close: '13:00',
        perDayHours: true,
        dayHours: { wed: { open: '15:00', close: '' } },
      }),
    );
    assert.deepEqual(
      s,
      [{ day: 'sat', open: '08:00', close: '13:00' }],
      'hours are optional, so an unfinished day is a gap a reviewer fills, not a rejection',
    );
  });

  it('sends no schedule at all when no hours were given', () => {
    assert.deepEqual(scheduleFor(form({ days: ['sat', 'wed'] })), []);
  });

  it('sends nothing when days were never picked, whatever the times say', () => {
    assert.deepEqual(scheduleFor(form({ open: '08:00', close: '13:00' })), []);
  });

  it('normalises to week order however the chips were tapped', () => {
    const tapped = scheduleFor(form({ days: ['sun', 'wed', 'sat'], open: '08:00', close: '13:00' }));
    const other = scheduleFor(form({ days: ['sat', 'sun', 'wed'], open: '08:00', close: '13:00' }));
    assert.deepEqual(
      tapped.map((e) => e.day),
      ['wed', 'sat', 'sun'],
    );
    assert.deepEqual(
      tapped,
      other,
      'two people submitting the same market must produce the same JSON, or a data pull request diffs on tap order',
    );
  });

  it('cannot emit the same day twice', () => {
    const s = scheduleFor(form({ days: ['sat', 'sat'], open: '08:00', close: '13:00' }));
    assert.deepEqual(s, [{ day: 'sat', open: '08:00', close: '13:00' }]);
  });
});

describe('hoursFor', () => {
  it('falls back to the shared pair for a day with no override', () => {
    assert.deepEqual(
      hoursFor(form({ open: '08:00', close: '13:00', perDayHours: true }), 'sat'),
      { open: '08:00', close: '13:00' },
      'a day the switch has not touched must not go blank when the mode turns on',
    );
  });

  it('takes the override when the mode is on', () => {
    assert.deepEqual(
      hoursFor(
        form({ open: '08:00', close: '13:00', perDayHours: true, dayHours: { sat: { open: '07:00', close: '12:00' } } }),
        'sat',
      ),
      { open: '07:00', close: '12:00' },
    );
  });
});
