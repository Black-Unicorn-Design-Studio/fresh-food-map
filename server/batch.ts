import { randomUUID } from 'node:crypto';

import { MarketCollection, type SubmissionInput } from '@/lib/market-schema';
import { env, loadConfig } from './config';
import { createStore } from './store';

/**
 * Turns queued submissions into a pull request.
 *
 * This is the only place the queue becomes a proposal, and it is deliberately
 * not the place anything becomes published — merging is (docs/trd.md §4). The
 * agent's job is to save a reviewer time, never to be the gate: it accepts and
 * flags, and the only things it refuses were refused at intake by mechanical
 * checks that essentially cannot false-positive.
 */
const api = async (path: string, init?: RequestInit) =>
  fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.github.token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'user-agent': 'fresh-food-map-intake',
      ...(init?.headers ?? {}),
    },
  });

async function ok(res: Response, what: string) {
  if (!res.ok) throw new Error(`${what}: ${res.status} ${await res.text()}`);
  return res.json() as Promise<any>;
}

/**
 * A submission carries facts; everything else is assigned here — a fresh id,
 * `source: 'community'` for attribution, `active: true`. The agent proposes and never
 * publishes: merging the pull request is what publishes a market and what checks it,
 * and that is a person on GitHub (docs/trd.md §3).
 */
function toFeature(s: SubmissionInput) {
  return {
    type: 'Feature' as const,
    geometry: { type: 'Point' as const, coordinates: [s.lon, s.lat] as [number, number] },
    properties: {
      id: randomUUID(),
      name: s.name,
      address: s.address,
      schedule: s.schedule,
      season_start: s.season_start,
      season_end: s.season_end,
      website: s.website,
      source: 'community' as const,
      tags: s.tags,
      source_ref: null,
      active: true,
      // Carried from the submission rather than decided here. The submitter was standing in
      // the place; this process is a batch job on a server that knows nothing about where the
      // market is beyond what it was told, and the alternative — inferring a country from the
      // coordinates — would put a network lookup on the one path that is deliberately
      // mechanical and offline.
      country: s.country,
      // Carried, not computed. The submitter was standing in the market's timezone; deriving
      // one here would mean a coordinate lookup on a path that is deliberately offline.
      timezone: s.timezone,
    },
  };
}

function prBody(
  items: { feature: ReturnType<typeof toFeature>; flags: string[]; note: string | null }[]
) {
  const flagged = items.filter((i) => i.flags.length > 0);
  const lines = [
    `${items.length} market${items.length === 1 ? '' : 's'} submitted through the intake form.`,
    '',
    '**Merging this pull request is the check.** Nothing here has been looked at by a person',
    'yet — the service checked shape, spam signals and duplicates, and nothing else. Once this',
    'merges, these markets are published as checked, so confirm each one exists and its details',
    'match its own listing before you merge. Editing an entry or dropping it from this branch',
    'is normal, and far cheaper than a correction after the fact.',
    '',
    '## What to check',
    '',
  ];

  if (flagged.length === 0) {
    lines.push(
      'No soft check tripped. That means the shape was fine, not that anyone has looked —',
      'every market here still needs checking against its own listing before this merges.'
    );
  } else {
    lines.push(
      `${flagged.length} of these tripped a soft check. They are **in the diff** — the agent`,
      'does not reject — and they are where to start, not where to stop:',
      ''
    );
    for (const i of flagged) {
      lines.push(`- **${i.feature.properties.name}** — ${i.flags.join(', ')}`);
    }
  }

  const noted = items.filter((i) => i.note);
  if (noted.length) {
    lines.push('', '## Notes from submitters', '', '_Context for review; not published._', '');
    for (const i of noted) lines.push(`- **${i.feature.properties.name}**: ${i.note}`);
  }

  lines.push(
    '',
    '---',
    '',
    'Opened automatically by the intake service. Submissions are validated against the same',
    'schema CI uses, so this branch should already pass `npm run validate-data`. That is a check',
    'on shape — that a record is well-formed, not that the market exists.'
  );
  return lines.join('\n');
}

export async function runBatch(): Promise<{ opened: string | null; count: number }> {
  const config = loadConfig();
  const store = await createStore();
  await store.init();

  const rows = await store.pending(config.batch_size);
  if (rows.length === 0) {
    await store.close();
    return { opened: null, count: 0 };
  }

  const items = rows.map((r) => {
    const payload = JSON.parse(r.payload) as SubmissionInput;
    return {
      id: r.id,
      feature: toFeature(payload),
      flags: JSON.parse(r.flags ?? '[]') as string[],
      note: payload.note ?? null,
    };
  });

  const { repo, baseBranch } = env.github;

  // One open batch at a time, deliberately.
  //
  // Every batch branches from `baseBranch` and appends to the same data/markets.json, so two
  // outstanding pull requests always conflict — whichever merges second goes stale, and the
  // reviewer who did nothing wrong is the one who has to resolve it. Worse, closing the loser
  // silently drops accepted submissions: their rows are already `batched` with that pull
  // request's URL, so they are never offered again.
  //
  // Waiting is the cheap fix. Nothing is lost by it — the queue keeps the rows `pending` and
  // the next run picks them up — and it means a reviewer is never under time pressure to
  // merge before the next batch lands on top of them. A merge driver that unions by id is
  // the eventual answer; until then, this refuses rather than proposing a conflict.
  const open = (await ok(
    await api(`/repos/${repo}/pulls?state=open&base=${encodeURIComponent(baseBranch)}&per_page=100`),
    'list open pull requests'
  )) as { number: number; head: { ref: string } }[];
  const outstanding = open.find((pr) => pr.head.ref.startsWith('intake/batch-'));
  if (outstanding) {
    await store.close();
    console.log(
      `#${outstanding.number} is still open; leaving ${rows.length} submission(s) queued. ` +
        `Merge or close it and run again.`
    );
    return { opened: null, count: 0 };
  }

  const baseRef = await ok(await api(`/repos/${repo}/git/ref/heads/${baseBranch}`), 'read base ref');
  const file = await ok(
    await api(`/repos/${repo}/contents/data/markets.json?ref=${baseBranch}`),
    'read dataset'
  );
  const collection = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
  collection.features.push(...items.map((i) => i.feature));

  // Validate the result before proposing it. Opening a pull request that fails
  // CI wastes a reviewer's time on a problem the submitter cannot fix.
  const check = MarketCollection.safeParse(collection);
  if (!check.success) {
    await store.close();
    throw new Error(
      `refusing to open a PR that would fail validation:\n` +
        check.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    );
  }

  const branch = `intake/batch-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
  await ok(
    await api(`/repos/${repo}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseRef.object.sha }),
    }),
    'create branch'
  );

  await ok(
    await api(`/repos/${repo}/contents/data/markets.json`, {
      method: 'PUT',
      body: JSON.stringify({
        message: `data: add ${items.length} submitted market${items.length === 1 ? '' : 's'}`,
        branch,
        sha: file.sha,
        content: Buffer.from(JSON.stringify(collection, null, 2) + '\n').toString('base64'),
      }),
    }),
    'commit dataset'
  );

  const pr = await ok(
    await api(`/repos/${repo}/pulls`, {
      method: 'POST',
      body: JSON.stringify({
        title: `data: ${items.length} market${items.length === 1 ? '' : 's'} from the intake form`,
        head: branch,
        base: baseBranch,
        body: prBody(items),
      }),
    }),
    'open pull request'
  );

  await store.markBatched(
    items.map((i) => i.id),
    pr.html_url
  );
  await store.close();
  return { opened: pr.html_url, count: items.length };
}

if (require.main === module) {
  runBatch()
    .then((r) =>
      console.log(r.opened ? `opened ${r.opened} with ${r.count}` : 'nothing pending')
    )
    .catch((e) => {
      console.error('batch failed:', e.message);
      process.exit(1);
    });
}
