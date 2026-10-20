import { strict as assert } from 'node:assert';
import { before, describe, test } from 'node:test';

import type { SubmitForm, SubmitResult } from '../src/lib/submit';

/**
 * `INTAKE_URL` is read from the environment once, at module load, so the variable has to be
 * set before the module is pulled in — hence the dynamic import in `before()` rather than a
 * static one at the top. Nothing here talks to that host: every test stubs `fetch`.
 */
// Configured with a trailing slash on purpose: the module strips it, and a double slash in
// the path is the kind of thing only a real request notices.
process.env.EXPO_PUBLIC_INTAKE_URL = 'https://intake.example.test/';

let submitMarket: typeof import('../src/lib/submit').submitMarket;

before(async () => {
  ({ submitMarket } = await import('../src/lib/submit'));
});

const FORM: SubmitForm = {
  name: 'Cedar Square Market',
  address: '18 Cedar Square, Portland OR',
  lat: '45.523100',
  lon: '-122.676500',
  website: '',
  days: ['sat'],
  open: '09:00',
  close: '14:00',
  perDayHours: false,
  dayHours: {},
  tags: ['accepts-snap'],
  note: '',
};

interface Call {
  url: string;
  init: RequestInit;
  body: any;
}

const realFetch = globalThis.fetch;

/**
 * Runs one submission against a stubbed service and hands back both the result and what went
 * over the wire. The stub is torn down in a `finally` so a failing assertion can never leave
 * a fake `fetch` installed for the next test.
 */
async function post(
  reply: () => Response,
  form: Partial<SubmitForm> = {},
  meta: Partial<{ honeypot: string; openedAt: number }> = {}
): Promise<{ result: SubmitResult; calls: Call[] }> {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: any, init: any) => {
    calls.push({ url: String(input), init, body: JSON.parse(String(init?.body ?? 'null')) });
    return reply();
  }) as typeof globalThis.fetch;
  try {
    const result = await submitMarket(
      { ...FORM, ...form },
      {
        honeypot: '',
        openedAt: Date.now() - 30_000,
        country: 'US' as const,
        timezone: 'America/Los_Angeles',
        ...meta,
      }
    );
    return { result, calls };
  } finally {
    globalThis.fetch = realFetch;
  }
}

/** Narrows to the refusal arm, so `message` and `fields` can be read without a cast per test. */
function refused(result: SubmitResult): Extract<SubmitResult, { ok: false }> {
  assert.equal(result.ok, false, 'expected a refusal');
  return result as Extract<SubmitResult, { ok: false }>;
}

/** The 422 shape the intake service actually sends: `{ path: 'schedule.0.open', message }`. */
const invalid =
  (...issues: { path: string; message: string }[]) =>
  () =>
    new Response(JSON.stringify({ error: 'invalid', issues }), { status: 422 });

const status = (code: number, body: unknown = null) => () =>
  new Response(body === null ? null : JSON.stringify(body), { status: code });

describe('a validation error always reaches somebody', () => {
  // The bug: the form is not shaped like the payload. One open/close pair is fanned out into
  // a schedule entry per selected day, so the service answers `schedule.0.open` — a key no
  // input owns. The client keyed its error map straight off the wire path, no field matched,
  // and the message was shown to nobody.
  test('a malformed time lands on the open and close inputs it came from', async () => {
    const { result } = await post(
      invalid(
        { path: 'schedule.0.open', message: 'Times look like 08:30' },
        { path: 'schedule.0.close', message: 'Times look like 08:30' }
      )
    );
    const r = refused(result);
    assert.deepEqual(r.fields, { open: 'Times look like 08:30', close: 'Times look like 08:30' });
    assert.equal(r.message, 'Some details need fixing.');
  });

  // Per-day mode gives every day its own pair of inputs, so a message about entry 2 has to
  // find the day that produced entry 2. Landing it on the shared pair would point at the
  // wrong box: somebody reads "Times look like 08:30" under Saturday while Wednesday is the
  // broken one, corrects a time that was already right, and submits the same failure again.
  test('in per-day mode a bad time lands on the day that produced it', async () => {
    // Tapped Saturday first, but the payload is normalised to week order, so entry 0 is
    // Wednesday and entry 1 is Saturday. The mapping has to walk the order actually sent,
    // not the order the chips were pressed in.
    const { result } = await post(
      invalid({ path: 'schedule.1.open', message: 'Times look like 08:30' }),
      {
        days: ['sat', 'wed'],
        perDayHours: true,
        // `8am` used to stand here as the malformed value; `parseTimeInput` reads that now,
        // so the exemplar has to be something no reading recovers (`market-schema.test.ts`
        // still lists `8am` among the strings HHMM itself rejects, which is unchanged).
        dayHours: { sat: { open: '7:99', close: '13:00' }, wed: { open: '15:00', close: '19:00' } },
      }
    );
    const r = refused(result);
    assert.deepEqual(r.fields, { open_sat: 'Times look like 08:30' });
  });

  // The index counts entries that were actually sent, not days that were ticked. A day whose
  // pair is incomplete never reaches the wire, so it must not be counted when walking back —
  // off-by-one here puts the message under a day the service never saw.
  test('the index walks back over the entries that were sent, not the days that were picked', async () => {
    const { result } = await post(
      invalid({ path: 'schedule.0.close', message: 'Times look like 08:30' }),
      {
        days: ['sat', 'wed'],
        open: '',
        close: '',
        perDayHours: true,
        // Saturday has no times at all, so Wednesday is entry 0 on the wire.
        dayHours: { wed: { open: '15:00', close: '7pm' } },
      }
    );
    const r = refused(result);
    assert.deepEqual(r.fields, { close_wed: 'Times look like 08:30' });
  });

  // Two selected days means the same bad time is reported twice per input. The form has one
  // open box, not one per day, so the duplicates must collapse rather than pile up under keys
  // like `schedule.1.open` that nothing renders.
  test('a bad time repeated across every selected day fills each input once', async () => {
    const { result } = await post(
      invalid(
        { path: 'schedule.0.open', message: 'Times look like 08:30' },
        { path: 'schedule.0.close', message: 'Times look like 08:30' },
        { path: 'schedule.1.open', message: 'Times look like 08:30' },
        { path: 'schedule.1.close', message: 'Times look like 08:30' }
      ),
      { days: ['sat', 'sun'] }
    );
    const r = refused(result);
    assert.deepEqual(Object.keys(r.fields ?? {}).sort(), ['close', 'open']);
    assert.equal(r.message, 'Some details need fixing.');
  });

  // Tag chips have no error slot, and the path is `tags.0` — the index means it would not
  // match a `tags` key even if one existed. Unshowable is not the same as unimportant: it
  // has to end up in the visible message instead of being swallowed.
  test('an unknown tag is said out loud, because the tag chips have no error slot', async () => {
    const { result } = await post(
      invalid({ path: 'tags.0', message: 'Invalid option: expected one of "indoor"' })
    );
    const r = refused(result);
    assert.deepEqual(r.fields, {});
    assert.match(r.message, /Invalid option: expected one of "indoor"/);
  });

  // Same shape for the day chips: an over-long schedule is rejected at `schedule` itself,
  // which no input owns either.
  test('a schedule-level rejection the day chips cannot show still reaches the message', async () => {
    const { result } = await post(
      invalid({ path: 'schedule', message: 'Too big: expected array to have <=14 items' })
    );
    const r = refused(result);
    assert.deepEqual(r.fields, {});
    assert.match(r.message, /Too big/);
  });

  test('an input error and an unplaceable one both survive the same response', async () => {
    const { result } = await post(
      invalid(
        { path: 'name', message: 'Too small: expected string to have >=3 characters' },
        { path: 'tags.0', message: 'Pick a tag from the list.' }
      )
    );
    const r = refused(result);
    assert.deepEqual(r.fields, { name: 'Too small: expected string to have >=3 characters' });
    assert.match(r.message, /Pick a tag from the list\./);
  });

  test('every unplaceable message is repeated, not just the first', async () => {
    const { result } = await post(
      invalid(
        { path: 'tags.0', message: 'First problem.' },
        { path: 'schedule.0.day', message: 'Second problem.' }
      )
    );
    const r = refused(result);
    assert.equal(r.message, 'Some details need fixing. First problem. Second problem.');
  });

  // `season_start` is a rule the service enforces on its own ("both dates, or neither"), and
  // the form has no season inputs at all — so this is a message that can only ever be seen if
  // unplaceable issues are surfaced.
  test('a server-only rule that no input owns still reaches the submitter', async () => {
    const { result } = await post(
      invalid({ path: 'season_start', message: 'Give both season dates, or neither.' })
    );
    const r = refused(result);
    assert.deepEqual(r.fields, {});
    assert.match(r.message, /Give both season dates, or neither\./);
  });

  // Zod reports a whole-payload failure with an empty path. Nothing should key off it, and
  // nothing should throw on it either.
  test('a rejection of the payload as a whole is not dropped', async () => {
    const { result } = await post(
      invalid({ path: '', message: 'Invalid input: expected object.' })
    );
    const r = refused(result);
    assert.deepEqual(r.fields, {});
    assert.match(r.message, /Invalid input: expected object\./);
  });

  // A 422 body that is not JSON (a proxy's HTML error page, say) must still refuse in words.
  // The parse is guarded, so this is about the guard staying there: an exception here would
  // reject the promise inside the screen's un-caught `send()`, leaving the form stuck busy.
  test('a 422 with an unreadable body still refuses in words rather than throwing', async () => {
    const { result } = await post(() => new Response('<html>gateway error</html>', { status: 422 }));
    const r = refused(result);
    assert.equal(r.message, 'Some details need fixing.');
    assert.deepEqual(r.fields, {});
  });

  test('a 422 carrying no issues at all still says something', async () => {
    const { result } = await post(status(422, { error: 'invalid' }));
    const r = refused(result);
    assert.equal(r.message, 'Some details need fixing.');
    assert.deepEqual(r.fields, {});
  });
});

describe('what each status means', () => {
  // 202 is deliberately the answer for both a queued submission and a hard-failed one — the
  // service will not tell a bot which check it tripped. The client must not try to look
  // behind that, and must not treat the empty body as a failure.
  test('202 is the answer that means accepted', async () => {
    const { result } = await post(status(202, { status: 'received' }));
    assert.deepEqual(result, { ok: true });
  });

  // Only 202 counts. A 200 from something that is not the intake service — a captive portal,
  // a misrouted proxy — must not be reported as "queued for review", because nothing was.
  test('a 200 is not mistaken for acceptance', async () => {
    const { result } = await post(status(200, { status: 'received' }));
    assert.match(refused(result).message, /\(200\)/);
  });

  // Being rate-limited must not read as a dead end: opening a pull request against
  // data/markets.json is always available and needs nothing running.
  test('429 offers the pull-request route instead of a dead end', async () => {
    const { result } = await post(status(429, { error: 'rate_limited' }));
    assert.match(refused(result).message, /pull request/);
  });

  test('an unreachable service reads as unreachable, not as bad input', async () => {
    const { result } = await post(() => {
      throw new TypeError('Failed to fetch');
    });
    const r = refused(result);
    assert.match(r.message, /Couldn't reach the submission service/);
    // No field errors: nothing about the submission was judged, so nothing should be
    // highlighted red as if the submitter got it wrong.
    assert.equal(r.fields, undefined);
  });

  test('an unexpected status names itself, so a report can be filed', async () => {
    const { result } = await post(status(500, { error: 'server_error' }));
    assert.match(refused(result).message, /unexpected error \(500\)/);
  });
});

describe('what the form actually puts on the wire', () => {
  // This fan-out is the reason `schedule.0.open` exists at all — it is the shape mismatch the
  // error mapping above has to undo.
  test('one open/close pair fans out to one schedule entry per selected day', async () => {
    const { calls } = await post(status(202), { days: ['fri', 'sat', 'sun'] });
    assert.deepEqual(calls[0].body.market.schedule, [
      { day: 'fri', open: '09:00', close: '14:00' },
      { day: 'sat', open: '09:00', close: '14:00' },
      { day: 'sun', open: '09:00', close: '14:00' },
    ]);
  });

  test('an incomplete time pair sends no schedule rather than half of one', async () => {
    const { calls } = await post(status(202), { days: ['sat'], open: '', close: '' });
    assert.deepEqual(calls[0].body.market.schedule, []);
  });

  // Closed vocabulary: an unknown tag is dropped here rather than sent and trusted. It is
  // dropped silently, which is the same decision the dataset makes — a tag nobody can check
  // is a claim, not a fact.
  test('tags outside the closed vocabulary never leave the client', async () => {
    const { calls } = await post(status(202), {
      tags: ['accepts-snap', 'artisanal' as never, 'indoor'],
    });
    assert.deepEqual(calls[0].body.market.tags, ['accepts-snap', 'indoor']);
  });

  // A submitter supplies facts about a market, never its provenance: `id`, `source`,
  // `source_ref` and `active` are the service's to assign, and accepting `source` from the
  // wire would let anyone label their own submission as coming from a state portal.
  test('a submitter sends facts and no provenance at all', async () => {
    const { calls } = await post(status(202));
    const market = calls[0].body.market;
    assert.deepEqual(
      Object.keys(market).sort(),
      // `country` is context the app supplies rather than provenance the submitter claims —
      // which country's address grammar this line is written in. The forbidden list below is
      // what provenance actually looks like, and it is unchanged.
      ['address', 'country', 'lat', 'lon', 'name', 'note', 'schedule', 'tags', 'timezone', 'website']
    );
    for (const forbidden of ['id', 'source', 'source_ref', 'active', 'verified', 'verified_at']) {
      assert.equal(forbidden in market, false, `${forbidden} must not be submittable`);
    }
    // Text inputs, but the schema wants numbers — sending the strings would fail validation
    // for every submission.
    assert.equal(typeof market.lat, 'number');
    assert.equal(typeof market.lon, 'number');
  });

  // The schema accepts a URL or null, never "". An empty input sent as an empty string would
  // pass intake's own form and then fail the shared schema.
  test('blank optional text goes as null, which is what the schema accepts', async () => {
    const { calls } = await post(status(202), { website: '', note: '  ' });
    assert.equal(calls[0].body.market.website, null);
    assert.equal(calls[0].body.market.note, null);
    const trimmed = await post(status(202), { website: ' https://example.org ', note: ' hi ' });
    assert.equal(trimmed.calls[0].body.market.website, 'https://example.org');
    assert.equal(trimmed.calls[0].body.market.note, 'hi');
  });

  test('a trailing slash on the configured URL does not become a double slash', async () => {
    const { calls } = await post(status(202));
    assert.equal(calls[0].url, 'https://intake.example.test/submit');
    assert.equal(calls[0].init.method, 'POST');
    assert.deepEqual(calls[0].init.headers, { 'content-type': 'application/json' });
  });

  // Both anti-spam signals are supplied by this module rather than by the screen, so the
  // screen cannot forget one. `elapsed_seconds` is a clock reading, so only its type and sign
  // are asserted — a value assertion here would be a flake.
  test('the anti-spam signals are supplied here, not left to the caller', async () => {
    const { calls } = await post(status(202), {}, { honeypot: 'a bot filled this in' });
    assert.equal(calls[0].body.website_url, 'a bot filled this in');
    assert.equal(typeof calls[0].body.elapsed_seconds, 'number');
    assert.equal(calls[0].body.elapsed_seconds >= 0, true);
  });
});
