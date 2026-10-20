/**
 * The "Flag or update this listing" link on the detail screen.
 *
 * It is the only repair route the app offers a reader, and it is a URL assembled from a
 * market's own fields — so the failure mode is a link that opens an issue form with the market
 * name missing, or one that breaks on the first market whose name contains an ampersand. Both
 * are silent: the link still opens.
 *
 * `reportUrl` is also where the decision *not* to route corrections through the intake service
 * is written down; a correction naming an existing market is a same-name-within-100m duplicate,
 * which intake hard-fails and drops without a trace.
 */
import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';

import { SOURCE_URL, issuesEndpoint, reportUrl, sourcePath } from '@/constants/source';

const market = { id: '1f0a6a2e-8c1d-4b5e-9d2a-000000000001', name: 'Ferry Plaza Farmers Market' };

/** What a browser would hand the issue form back as. */
const params = (url: string) => new URL(url).searchParams;

describe('reportUrl', () => {
  test('points at the configured source repository', () => {
    assert.ok(reportUrl(market).startsWith(SOURCE_URL), `expected ${SOURCE_URL} as the base`);
  });

  test('is a valid absolute URL', () => {
    // Assembled by hand out of a template string, so this is not a given.
    assert.doesNotThrow(() => new URL(reportUrl(market)));
  });

  test('names the market in the title and the id in the body', () => {
    // The split is deliberate: a maintainer greps the dataset for the id, and reads the name
    // in a list of issues. Losing either one costs a round trip asking which market it was.
    const q = params(reportUrl(market));
    assert.match(q.get('title') ?? '', /Ferry Plaza Farmers Market/);
    assert.match(q.get('body') ?? '', /1f0a6a2e-8c1d-4b5e-9d2a-000000000001/);
  });

  test('survives a name full of URL punctuation', () => {
    // "Smith & Sons #2 / Tuesdays?" is a plausible market name and every character in it means
    // something in a query string. Unencoded, the body would be truncated at the first `&`.
    const awkward = { id: 'abc', name: 'Smith & Sons #2 / Tuesdays?' };
    const q = params(reportUrl(awkward));
    assert.equal(q.get('title'), 'Correction: Smith & Sons #2 / Tuesdays?');
    assert.match(q.get('body') ?? '', /Smith & Sons #2 \/ Tuesdays\?/);
  });

  test('keeps the body a prompt, not a form somebody must decode', () => {
    // Newlines have to arrive as newlines: an issue template collapsed onto one line is worse
    // than no template, because it reads as noise the reporter has to clear out first.
    assert.match(params(reportUrl(market)).get('body') ?? '', /\n/);
  });

  test('does not double a slash when the source URL has a trailing one', () => {
    // `EXPO_PUBLIC_SOURCE_URL` is typed by a human into an env file, and a trailing slash is
    // the most common way that goes. GitHub answers `//issues/new` with a 404, which looks
    // like a missing repository rather than a stray character.
    assert.equal(issuesEndpoint('https://example.org/repo/'), 'https://example.org/repo/issues/new');
    assert.equal(issuesEndpoint('https://example.org/repo'), 'https://example.org/repo/issues/new');
    assert.equal(issuesEndpoint('https://example.org/repo///'), 'https://example.org/repo/issues/new');
  });

  test('other repository paths get the same guard, from either side of the join', () => {
    // The privacy screen links the issue list and its own history through `sourcePath`, so a
    // trailing slash on the base or a leading one on the path must not produce `//` either.
    assert.equal(sourcePath('issues', 'https://example.org/repo/'), 'https://example.org/repo/issues');
    assert.equal(
      sourcePath('/commits/main/src/app/privacy.tsx', 'https://example.org/repo'),
      'https://example.org/repo/commits/main/src/app/privacy.tsx',
    );
  });

  test('the real link never contains a doubled slash after the host', () => {
    const path = new URL(reportUrl(market)).pathname;
    assert.ok(!path.includes('//'), `doubled slash in ${path}`);
  });
});
