import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  COUNTRIES,
  COUNTRY_LABELS,
  COUNTRY_UNITS,
  POSTAL_CODE_LABELS,
  isSupportedCountry,
  regionFromLocale,
} from '../src/constants/countries';
import { COUNTRY_BOUNDS, DEFAULT_CENTERS } from '../src/lib/geo';

describe('regionFromLocale', () => {
  test('takes the region from an ordinary tag', () => {
    assert.equal(regionFromLocale('en-GB'), 'GB');
    assert.equal(regionFromLocale('en-US'), 'US');
  });

  test('skips a script subtag rather than reading it as a region', () => {
    // `es-Latn-GB` is the case that breaks a naive "two letters after a dash" match, and
    // `zh-Hant` is the case that makes one invent a region that is not there.
    assert.equal(regionFromLocale('es-Latn-GB'), 'GB');
    assert.equal(regionFromLocale('zh-Hant'), null);
  });

  test('accepts the underscore form iOS sometimes reports', () => {
    assert.equal(regionFromLocale('es_GB'), 'GB');
  });

  test('a language with no region is null, not a guess', () => {
    assert.equal(regionFromLocale('en'), null);
    assert.equal(regionFromLocale(''), null);
    assert.equal(regionFromLocale(null), null);
  });

  test('normalises case, because a tag is allowed to be scruffy', () => {
    assert.equal(regionFromLocale('en-gb'), 'GB');
  });

  test('a UN M49 numeric region parses but is not a country this app supports', () => {
    // `es-419` is Latin America. It is a valid region and deliberately not a country code,
    // so it must survive parsing and then fail the support check rather than crash either.
    assert.equal(regionFromLocale('es-419'), '419');
    assert.equal(isSupportedCountry(regionFromLocale('es-419')), false);
  });

  test('only the countries the app has been taught are supported', () => {
    assert.equal(isSupportedCountry('GB'), true);
    assert.equal(isSupportedCountry('gb'), true);
    assert.equal(isSupportedCountry('JM'), true);
    assert.equal(isSupportedCountry('FR'), false);
  });

  test('a Jamaican locale resolves to a country the app supports', () => {
    assert.equal(regionFromLocale('en-JM'), 'JM');
    assert.equal(isSupportedCountry(regionFromLocale('en-JM')), true);
  });
});

/**
 * The gap these close: `COUNTRIES` is the list, and four separate tables have to agree with
 * it. Three are `Record<CountryCode, …>`, so a missing entry is a typecheck failure — but a
 * typecheck failure is not a *named* one, and nothing at all catches a box and a centre that
 * disagree about where a country is. A half-added country renders wrongly rather than
 * failing, which `src/constants/countries.ts` calls the worse of the two failures because
 * nothing announces it. These announce it.
 */
describe('a country is added completely or not at all', () => {
  test('every supported country has a unit, a label, a centre and a box', () => {
    for (const code of COUNTRIES) {
      assert.ok(COUNTRY_UNITS[code], `${code} has no distance unit`);
      assert.ok(COUNTRY_LABELS[code], `${code} has no label for the settings panel`);
      assert.ok(DEFAULT_CENTERS[code], `${code} has no opening centre`);
      assert.ok(COUNTRY_BOUNDS[code], `${code} has no opening box`);
    }
  });

  test('every supported country has decided what it calls a postal code', () => {
    // `null` is a decision here, not an omission — so this asserts the KEY is present rather
    // than that the value is truthy, which is the whole difference between "Jamaica has no
    // postal code" and "nobody got round to Jamaica".
    for (const code of COUNTRIES) {
      assert.ok(code in POSTAL_CODE_LABELS, `${code} has not said what it calls a postal code`);
    }
  });

  test('the postal word is the one each country actually uses', () => {
    assert.equal(POSTAL_CODE_LABELS.US, 'ZIP code');
    assert.equal(POSTAL_CODE_LABELS.GB, 'postcode');
    // Jamaica discontinued postal codes outright. A placeholder that asked for one would be
    // asking for something the reader's country does not have.
    assert.equal(POSTAL_CODE_LABELS.JM, null);
  });

  test("each country's opening centre falls inside its own opening box", () => {
    // A transposed lat/lon typechecks perfectly and puts the reader in the sea.
    for (const code of COUNTRIES) {
      const [west, south, east, north] = COUNTRY_BOUNDS[code];
      const { lat, lon } = DEFAULT_CENTERS[code];
      assert.ok(lon > west && lon < east, `${code}: centre longitude ${lon} is outside its box`);
      assert.ok(lat > south && lat < north, `${code}: centre latitude ${lat} is outside its box`);
    }
  });

  test('every box is the right way round', () => {
    for (const code of COUNTRIES) {
      const [west, south, east, north] = COUNTRY_BOUNDS[code];
      assert.ok(east > west, `${code}: east ${east} is not east of west ${west}`);
      assert.ok(north > south, `${code}: north ${north} is not north of south ${south}`);
    }
  });
});
