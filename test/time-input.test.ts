import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseTimeInput } from '../src/lib/time-input';
import { HHMM } from '../src/lib/market-schema';

test('a bare hour is an hour on the 24-hour clock', () => {
  assert.equal(parseTimeInput('7'), '07:00');
  assert.equal(parseTimeInput('07'), '07:00');
  assert.equal(parseTimeInput('19'), '19:00');
  assert.equal(parseTimeInput('0'), '00:00');
  assert.equal(parseTimeInput('23'), '23:00');
});

test('a meridiem outranks the bare reading', () => {
  assert.equal(parseTimeInput('7pm'), '19:00');
  assert.equal(parseTimeInput('3pm'), '15:00');
  assert.equal(parseTimeInput('7am'), '07:00');
  assert.equal(parseTimeInput('7 PM'), '19:00');
  assert.equal(parseTimeInput('7 p.m.'), '19:00');
});

test('midnight and midday are the two everyone gets wrong', () => {
  assert.equal(parseTimeInput('12am'), '00:00');
  assert.equal(parseTimeInput('12pm'), '12:00');
  assert.equal(parseTimeInput('12:30am'), '00:30');
  assert.equal(parseTimeInput('12:30pm'), '12:30');
  assert.equal(parseTimeInput('noon'), '12:00');
  assert.equal(parseTimeInput('midnight'), '00:00');
});

test('digits without a colon split where a time would', () => {
  assert.equal(parseTimeInput('730'), '07:30');
  assert.equal(parseTimeInput('1930'), '19:30');
  assert.equal(parseTimeInput('0800'), '08:00');
  assert.equal(parseTimeInput('7:30'), '07:30');
  assert.equal(parseTimeInput('19:30'), '19:30');
});

test('already-valid input survives unchanged', () => {
  for (const t of ['00:00', '08:30', '13:00', '23:59']) {
    assert.equal(parseTimeInput(t), t);
  }
});

test('empty is not an error — a market may have no hours', () => {
  // `scheduleFor()` drops a pair missing either half, so blank means "not given". An error
  // here would land under a field nobody touched.
  assert.equal(parseTimeInput(''), '');
  assert.equal(parseTimeInput('   '), '');
});

test('an impossible time is refused rather than guessed at', () => {
  for (const t of ['25', '24', '7:99', '99:99', 'abc', '7:', ':30', '-7', '7pmm', '12345']) {
    assert.equal(parseTimeInput(t), null, `${t} should have no reading`);
  }
});

test('a meridiem hour runs 1 to 12 and nothing else', () => {
  // Guessing at these is how a form invents a value CI would reject.
  assert.equal(parseTimeInput('13pm'), null);
  assert.equal(parseTimeInput('0pm'), null);
  assert.equal(parseTimeInput('0am'), null);
  assert.equal(parseTimeInput('24pm'), null);
});

test('everything it returns satisfies the schema it feeds', () => {
  // The rule this exists to protect: the app must never write a value its own CI rejects.
  const inputs = [
    '7', '19', '7pm', '3pm', '730', '1930', '12am', '12pm', '7:30', '23:59', '0', 'noon',
    'midnight', '12:30am', '0800', '7 p.m.',
  ];
  for (const raw of inputs) {
    const out = parseTimeInput(raw);
    assert.notEqual(out, null, `${raw} should parse`);
    assert.equal(HHMM.safeParse(out).success, true, `${raw} -> ${out} must satisfy HHMM`);
  }
});
