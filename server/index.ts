import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { Submission, seasonIsCoherent } from '@/lib/market-schema';
import { judge } from './checks';
import { clientIp, hashBucket } from './client-ip';
import { assertServiceEnv, env, loadConfig } from './config';
import { createStore } from './store';

/**
 * Submission intake. Accepts a market from anyone, with no account, applies
 * mechanical checks, and queues it. It never decides whether a market belongs
 * in the dataset — the batching agent turns the queue into a pull request and a
 * human decides there (docs/trd.md §4).
 */
const config = loadConfig();

// Not top-level await: the root package.json is CommonJS because the Expo app
// needs it to be, so startup is wrapped in main() rather than changing the
// module system of the whole repository for one file.
let store: Awaited<ReturnType<typeof createStore>>;

const json = (res: ServerResponse, status: number, body: unknown) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    // No credentials are involved and the dataset is public, so a wildcard is
    // honest here rather than lazy: any site may host a submission form.
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
  });
  res.end(payload);
};

async function readBody(req: IncomingMessage, limitBytes = 64 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new Error('payload too large');
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function handleSubmit(req: IncomingMessage, res: ServerResponse) {
  const ipHash = hashBucket(clientIp(req, env.trustedProxyHeader), env.ipSalt);

  const limited = await store.overLimit(ipHash, config.rate_limit);
  if (limited.blocked) {
    return json(res, 429, {
      error: 'rate_limited',
      message: `Too many submissions from this connection. Try again later, or open a pull request against data/markets.json.`,
    });
  }

  let body: any;
  try {
    body = await readBody(req);
  } catch {
    return json(res, 400, { error: 'bad_request', message: 'Could not read that submission.' });
  }

  // Counted before validation: otherwise malformed payloads are free, and
  // spraying rubbish costs nothing.
  await store.record(ipHash);

  const parsed = Submission.safeParse(body?.market);
  if (!parsed.success) {
    return json(res, 422, {
      error: 'invalid',
      // Field-level, so a form can show the message next to the input.
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  if (!seasonIsCoherent(parsed.data)) {
    return json(res, 422, {
      error: 'invalid',
      issues: [{ path: 'season_start', message: 'Give both season dates, or neither.' }],
    });
  }

  const verdict = judge(
    parsed.data,
    {
      honeypot: typeof body?.website_url === 'string' && body.website_url ? body.website_url : null,
      elapsedSeconds: typeof body?.elapsed_seconds === 'number' ? body.elapsed_seconds : null,
    },
    config
  );

  if (verdict.kind === 'hard') {
    // Deliberately indistinguishable from success. Telling a bot which check it
    // tripped is telling it how to pass next time; a person who somehow trips
    // one can still open a pull request, which the copy says.
    return json(res, 202, { status: 'received' });
  }

  await store.enqueue({ id: randomUUID(), payload: parsed.data, ipHash, flags: verdict.flags });
  return json(res, 202, { status: 'received' });
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'POST, OPTIONS',
    });
    return res.end();
  }
  if (req.method === 'POST' && req.url === '/submit') {
    // handleSubmit is async, so anything it throws would otherwise surface as an unhandled
    // rejection and take the process down — one bad request ending the submission path for
    // everyone. Nothing here is worth dying over: fail the request, keep serving.
    return handleSubmit(req, res).catch((err) => {
      console.error('submit failed:', err);
      if (!res.headersSent) json(res, 500, { error: 'server_error', message: 'Something went wrong. Try again shortly.' });
    });
  }
  if (req.method === 'GET' && req.url === '/health') return json(res, 200, { ok: true });
  return json(res, 404, { error: 'not_found' });
});

async function main() {
  // Before anything else: a missing salt or token must stop the service starting, not wait
  // to surface as a 500 on somebody's submission.
  assertServiceEnv();

  store = await createStore();
  await store.init();

  // Retention is not a background job; doing it on boot is enough at this
  // volume and cannot silently stop running.
  const pruned = await store.prune(config.retention_days);

  server.listen(env.port, () => {
    console.log(
      `intake listening on :${env.port} [${store.kind}] ` +
        `(pruned ${pruned.rateLimitRows} limit rows, ${pruned.rejectedRows} rejected)`
    );
    if (!env.trustedProxyHeader) {
      console.log('X-Forwarded-For is ignored — set INTAKE_TRUSTED_PROXY_HEADER if behind a proxy.');
    }
    if (store.kind === 'sqlite') {
      console.log(`queue: ${env.dbPath} — this must be persistent disk, or it empties on redeploy.`);
    }
  });
}

main().catch((err) => {
  console.error('intake failed to start:', err.message);
  process.exit(1);
});
