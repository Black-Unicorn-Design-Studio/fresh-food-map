import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeAddress } from '../src/lib/address-format';

test('the zip joins the state with a space, not a comma', () => {
  assert.equal(normalizeAddress('1940 Mount Zion Road, Morrow, GA, 30260'),
    '1940 Mount Zion Road, Morrow, GA 30260');
});

test('a spelled-out state is abbreviated', () => {
  assert.equal(normalizeAddress('Sunset Drive, Athens, Georgia, 30606'),
    'Sunset Drive, Athens, GA 30606');
  assert.equal(normalizeAddress('1393 North Highland Avenue Northeast, Atlanta, Georgia, 30306'),
    '1393 North Highland Avenue Northeast, Atlanta, GA 30306');
});

test('a state only counts where a state belongs — a street keeps its name', () => {
  // The killer case: "Georgia Avenue" must not become "GA Avenue".
  assert.equal(normalizeAddress('8700 Georgia Avenue, Silver Spring, MD 20910'),
    '8700 Georgia Avenue, Silver Spring, MD 20910');
});

test('an all-lowercase address is title-cased, and a lowercase state raised', () => {
  assert.equal(normalizeAddress('12610 old gunpowder rd md 20705'),
    '12610 Old Gunpowder Rd MD 20705');
});

test('existing capitals are left alone, so real names survive', () => {
  for (const a of [
    '100 East Villanow Street, LaFayette, GA 30728',
    '55 McDonald Avenue, DeKalb, GA 30030',
    "12 O'Brien Lane, Bel Air, MD 21014",
  ]) {
    assert.equal(normalizeAddress(a), a, `${a} should be untouched`);
  }
});

test('whitespace is collapsed and trimmed', () => {
  assert.equal(normalizeAddress('  15793   Old Columbia Pike,  Burtonsville, MD 20866 '),
    '15793 Old Columbia Pike, Burtonsville, MD 20866');
});

test('an already-correct address is unchanged', () => {
  for (const a of [
    '15793 Old Columbia Pike, Burtonsville, MD 20866',
    '1573 W Broad St, Athens, GA 30606',
    '5601 Sunnyside Avenue, Beltsville, MD 20705',
  ]) {
    assert.equal(normalizeAddress(a), a);
  }
});

test('it never refuses, and never invents', () => {
  // Empty stays empty; a missing city is not conjured; a zip-less address survives.
  assert.equal(normalizeAddress(''), '');
  assert.equal(normalizeAddress('   '), '');
  assert.equal(normalizeAddress('7153 Cooper Point Road, Bozman, MD'),
    '7153 Cooper Point Road, Bozman, MD');
  assert.equal(normalizeAddress('9090 Frederick Road, Ellicott City, 21042'),
    '9090 Frederick Road, Ellicott City, 21042');
});

test('directional abbreviations stay upper when title-casing', () => {
  assert.equal(normalizeAddress('3799 east-west highway ne, hyattsville, md 20782'),
    '3799 East-West Highway NE, Hyattsville, MD 20782');
});

test('a trailing two-letter word is only a state if it is a real code', () => {
  // The bug this guards: an early draft uppercased any trailing two letters, so
  // `123 Main St` became `123 Main ST`. Only real postal codes count.
  assert.equal(normalizeAddress('123 Main St'), '123 Main St');
  assert.equal(normalizeAddress('40 Water St, Frostburg, MD 21532'),
    '40 Water St, Frostburg, MD 21532');
  // And the case that needs the trailing check to exist at all: no commas anywhere.
  assert.equal(normalizeAddress('12610 old gunpowder rd md 20705'),
    '12610 Old Gunpowder Rd MD 20705');
});

test('output still satisfies the schema length bounds', () => {
  const long = 'a'.repeat(260);
  assert.ok(normalizeAddress(long).length <= 260, 'it does not grow the string');
});

// The title-caser runs on a wholly lowercase string, which is what fast typing on a phone
// produces, and it mangled every British postcode: the inward half always, the outward half
// whenever it was not accidentally rescued by the US street-quadrant set.
test('both halves are uppercased, not title-cased', () => {
  assert.equal(
    normalizeAddress('8 southwark street, london, se1 1tl'),
    '8 Southwark Street, London, SE1 1TL',
  );
  // `ba` is in no set at all, so this one was broken in both halves: `Ba1 1Lz`.
  assert.equal(normalizeAddress('12 high street, bath, ba1 1lz'), '12 High Street, Bath, BA1 1LZ');
});

test('a single-letter area and a digit-letter outward code both survive', () => {
  assert.equal(normalizeAddress('1a market way, salford m6 5ja'), '1A Market Way, Salford M6 5JA');
  assert.equal(normalizeAddress('10 downing street, london, sw1a 2aa'), '10 Downing Street, London, SW1A 2AA');
});

test('an American address is left exactly as it was', () => {
  // `MD 20866` and `CA 90210` put a space where the postcode pattern wants a digit, so
  // neither can match — the two conventions cannot collide.
  assert.equal(
    normalizeAddress('12610 old gunpowder rd, beltsville, md 20866'),
    '12610 Old Gunpowder Rd, Beltsville, MD 20866',
  );
  assert.equal(normalizeAddress('1573 w broad st, athens, ga 30606'), '1573 W Broad St, Athens, GA 30606');
});
