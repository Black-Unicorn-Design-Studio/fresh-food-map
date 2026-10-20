import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/**
 * Getting this wrong is the single most common way an IP rate limiter ends up
 * decorative, so it is its own module. Nothing checked it until a non-terminating loop
 * in `bucket()` shipped here and crashed the service on any IPv6 address containing
 * `::`; `test/client-ip.test.ts` now covers it, that outage first.
 *
 * X-Forwarded-For is set by the client. If the service reads it unconditionally,
 * a spammer sends a different value per request and every request looks like a
 * new address. So it is ignored unless INTAKE_TRUSTED_PROXY_HEADER names a
 * header that a proxy in front of this service is known to overwrite —
 * CF-Connecting-IP behind Cloudflare, for instance. Unset means: trust only the
 * socket.
 */
export function clientIp(req: IncomingMessage, trustedHeader: string | null): string {
  if (trustedHeader) {
    const v = req.headers[trustedHeader.toLowerCase()];
    // Last occurrence, not first: a proxy appends, and the same reasoning that makes the
    // rightmost comma-separated entry authoritative makes the last repeated header so.
    const value = Array.isArray(v) ? v[v.length - 1] : v;
    // Rightmost entry: a proxy appends, so anything a client injected is to the left.
    if (value) return value.split(',').map((p) => p.trim()).filter(Boolean).pop() ?? '';
  }
  return req.socket.remoteAddress ?? '';
}

/**
 * A single household is routinely handed a whole IPv6 /64, so limiting per
 * address would give one person unlimited attempts. IPv4 is used whole.
 */
export function bucket(ip: string): string {
  // Strip, in order: a bracketed host:port form some proxies write ([2001:db8::1]:443),
  // a zone index (fe80::1%en0), then the IPv4-mapped prefix. Each of these used to survive
  // into the bucket, and every one of them is a second allowance for one submitter — or, in
  // the mapped case, a shared bucket for many of them.
  const unbracketed = ip.startsWith('[') ? (ip.slice(1).split(']')[0] ?? '') : ip;
  const noZone = unbracketed.split('%')[0];
  // Case-insensitive: RFC 5952 prefers lowercase but nothing obliges a proxy to write it
  // that way, and an uppercase ::FFFF: address was being expanded as ordinary IPv6 whose
  // first four groups are all zero — collapsing every such submitter into one bucket,
  // shared with ::1.
  const addr = /^::ffff:/i.test(noZone) ? noZone.slice(7) : noZone;
  if (!addr.includes(':')) return addr;

  // `::` elides one run of zero groups and may appear at most once, so splitting on it
  // gives the groups before and after; the gap is however many zeros make eight.
  //
  // The previous expansion looped on a bound that moved with the array it was filling, so
  // it never terminated and threw RangeError — which, unhandled, killed the process on any
  // address containing `::`. That includes ::1 and most real IPv6.
  const halves = addr.split('::');
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length > 1 && halves[1] ? halves[1].split(':') : [];
  const groups =
    halves.length > 1
      ? [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail]
      : addr.split(':');

  // Normalised so two spellings of one address share a bucket. It arrives from the socket
  // in a consistent form, but with INTAKE_TRUSTED_PROXY_HEADER set it comes from a proxy,
  // and a limiter that can be sidestepped by writing 2001:0db8 for 2001:db8 is decorative.
  const norm = (g: string) => g.replace(/^0+(?=.)/, '').toLowerCase();
  return groups.slice(0, 4).map(norm).join(':') + '::/64';
}

/** Stored hashed: equality is all a limiter needs, and a leaked file leaks nothing. */
export function hashBucket(ip: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${bucket(ip)}`).digest('hex').slice(0, 32);
}
