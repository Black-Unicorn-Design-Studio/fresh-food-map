import { strict as assert } from 'node:assert';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import { describe, test } from 'node:test';

import { bucket, clientIp, hashBucket } from '../server/client-ip';

const SALT = 'test-salt-not-a-secret';

/** `clientIp` reads exactly two things off a request; a real IncomingMessage needs a live socket. */
function request(headers: IncomingHttpHeaders, remoteAddress?: string): IncomingMessage {
  return { headers, socket: { remoteAddress } } as unknown as IncomingMessage;
}

describe('bucket: no address shape may take the service down', () => {
  /**
   * Regression for the outage: the old expansion looped on a bound that moved with the
   * array it was filling, threw RangeError inside an async request handler, and killed the
   * process. Every one of these contains `::`, so a single submission from any of them
   * ended the submission path for everyone. The assertion is deliberately weak — the point
   * is only that a bucket comes back at all.
   *
   * A truly non-terminating loop would hang the runner rather than fail this test; that is
   * the one failure mode no assertion here can catch, and hanging is signal enough.
   */
  test('every real IPv6 spelling produces a bucket instead of a crash', () => {
    const addresses = [
      '::',
      '::1',
      '2001:db8::1',
      '2001:db8::',
      '2001:db8:85a3::8a2e:370:7334',
      'fd00:1234:5678:9abc::1',
      'fe80::1%en0',
      '::ffff:1.2.3.4',
      '2001:0db8:0000:0000:0000:ff00:0042:8329',
      '203.0.113.7',
      '',
    ];
    for (const ip of addresses) {
      assert.doesNotThrow(() => bucket(ip), `bucket(${JSON.stringify(ip)}) threw`);
      assert.equal(typeof bucket(ip), 'string');
    }
  });

  /**
   * Nothing validates the string before it reaches here, and with INTAKE_TRUSTED_PROXY_HEADER
   * set it is whatever a header said. More than eight groups makes the zero-fill length
   * negative, and `Array(-2)` is another RangeError — the same unhandled-throw shape as the
   * outage, reachable by typing garbage into a header.
   */
  test('a malformed over-long address is bucketed, not fatal', () => {
    assert.doesNotThrow(() => bucket('1:2:3:4:5:6:7:8:9::a'));
    assert.equal(bucket('1:2:3:4:5:6:7:8:9::a'), '1:2:3:4::/64');
  });
});

describe('bucket: a /64 is one submitter', () => {
  /**
   * A household is routinely handed a whole /64, so the addresses within it are one person.
   * Bucketing per address would hand that person unlimited attempts.
   */
  test('every address inside one /64 shares a bucket', () => {
    const sameHousehold = [
      '2001:db8:abcd:1::1',
      '2001:db8:abcd:1::dead:beef',
      '2001:db8:abcd:1:ffff:ffff:ffff:ffff',
      '2001:db8:abcd:1:0:0:0:2',
    ];
    const buckets = new Set(sameHousehold.map((ip) => bucket(ip)));
    assert.equal(buckets.size, 1, `expected one bucket, got ${[...buckets].join(', ')}`);
  });

  /**
   * With a trusted proxy header the address is spelled by the proxy, not the socket. A
   * limiter that can be sidestepped by writing 2001:0db8 for 2001:db8 is decorative.
   */
  test('two spellings of one /64 share a bucket', () => {
    const spellings = [
      '2001:db8::1',
      '2001:0db8::9',
      '2001:DB8::1',
      '2001:0db8:0000:0000:0000:ff00:0042:8329',
      '2001:db8:0:0:0:0:0:1',
    ];
    const buckets = new Set(spellings.map((ip) => bucket(ip)));
    assert.deepEqual([...buckets], ['2001:db8:0:0::/64']);
  });

  test('separate /64s never collide', () => {
    const distinct = [
      '2001:db8:0:1::1',
      '2001:db8:0:2::1',
      '2001:db8:1:1::1',
      'fd00:1234:5678:9abc::1',
      'fe80::1',
    ];
    assert.equal(new Set(distinct.map((ip) => bucket(ip))).size, distinct.length);
  });

  /** The zone is local to whichever machine wrote the string down; it is not part of the address. */
  test('a zone index does not split one household into several', () => {
    assert.equal(bucket('fe80::1%en0'), bucket('fe80::1'));
    assert.equal(bucket('fe80::1%en0'), bucket('fe80::2%eth3'));
  });

  /** IPv4 is handed out per connection, so it is used whole — no prefix is elided. */
  test('IPv4 is bucketed whole', () => {
    assert.equal(bucket('192.0.2.5'), '192.0.2.5');
    assert.notEqual(bucket('192.0.2.5'), bucket('192.0.2.6'));
  });

  /**
   * A dual-stack socket reports 203.0.113.9 as ::ffff:203.0.113.9 while a proxy header
   * carries the plain form. Two buckets for one submitter would be two allowances.
   */
  test('an IPv4-mapped address is the same submitter as the plain form', () => {
    assert.equal(bucket('::ffff:203.0.113.9'), '203.0.113.9');
    assert.equal(bucket('::ffff:203.0.113.9'), bucket('203.0.113.9'));
  });

  /**
   * REGRESSION. The `::ffff:` prefix test used to be case-sensitive while group
   * normalisation lowercased, so an uppercase-mapped address was expanded as ordinary IPv6
   * whose first four groups are all zero: every uppercase-mapped submitter landed in ONE
   * bucket, shared with ::1, and a handful of submissions rate-limited everyone arriving
   * that way. RFC 5952 prefers lowercase, but nothing obliges a proxy to write it so.
   */
  test('an IPv4-mapped address buckets the same in either case, and stays its own submitter', () => {
    assert.equal(bucket('::FFFF:203.0.113.9'), '203.0.113.9');
    assert.equal(bucket('::FFFF:203.0.113.9'), bucket('::ffff:203.0.113.9'));
    assert.notEqual(bucket('::FFFF:203.0.113.9'), bucket('::FFFF:198.51.100.1'));
    assert.notEqual(bucket('::FFFF:203.0.113.9'), bucket('::1'));
  });

  /**
   * REGRESSION. Some proxies write the bracketed host:port form into a forwarded header.
   * The bracket used to survive into the bucket, making `[2001:db8::1]:443` a different
   * submitter from the same /64 written bare — a second allowance for one person, which is
   * exactly what this normalisation exists to prevent.
   */
  test('a bracketed host:port form is the same submitter as the bare address', () => {
    assert.equal(bucket('[2001:db8::1]:443'), '2001:db8:0:0::/64');
    assert.equal(bucket('[2001:db8::1]:443'), bucket('2001:db8::1'));
  });
});

describe('clientIp: the limiter must not be decorative', () => {
  /**
   * X-Forwarded-For is set by the client. Read unconditionally, a spammer sends a different
   * value per request and every request looks like a new address. Unset trusted header
   * means: trust only the socket.
   */
  test('X-Forwarded-For is ignored when no proxy header is trusted', () => {
    const req = request({ 'x-forwarded-for': '198.51.100.9' }, '203.0.113.7');
    assert.equal(clientIp(req, null), '203.0.113.7');
  });

  test('a spoofed header cannot buy a fresh rate-limit counter', () => {
    const first = request({ 'x-forwarded-for': '198.51.100.9' }, '203.0.113.7');
    const second = request({ 'x-forwarded-for': '198.51.100.10' }, '203.0.113.7');
    assert.equal(
      hashBucket(clientIp(first, null), SALT),
      hashBucket(clientIp(second, null), SALT),
    );
  });

  /** A proxy appends, so anything the client injected sits to the left of the proxy's entry. */
  test("a client-injected value cannot win: the rightmost entry is the proxy's", () => {
    const req = request(
      { 'x-forwarded-for': '198.51.100.9, 198.51.100.10, 203.0.113.7' },
      '10.0.0.1',
    );
    assert.equal(clientIp(req, 'x-forwarded-for'), '203.0.113.7');
  });

  test('a trusted header is matched however the operator capitalised the env var', () => {
    const req = request({ 'cf-connecting-ip': '203.0.113.7' }, '10.0.0.1');
    assert.equal(clientIp(req, 'CF-Connecting-IP'), '203.0.113.7');
  });

  test('a missing trusted header falls back to the socket', () => {
    const req = request({}, '203.0.113.7');
    assert.equal(clientIp(req, 'cf-connecting-ip'), '203.0.113.7');
  });

  test('an empty trusted header falls back to the socket', () => {
    const req = request({ 'cf-connecting-ip': '' }, '203.0.113.7');
    assert.equal(clientIp(req, 'cf-connecting-ip'), '203.0.113.7');
  });

  test('padding and empty entries never become the client address', () => {
    const req = request({ 'x-forwarded-for': ' 198.51.100.9 ,  , 203.0.113.7 , ' }, '10.0.0.1');
    assert.equal(clientIp(req, 'x-forwarded-for'), '203.0.113.7');
  });

  /**
   * DOCUMENTS BEHAVIOUR worth knowing. A trusted header made only of separators is truthy,
   * so the socket fallback is skipped and the address is the empty string — every such
   * request shares one bucket. It errs toward over-limiting (nobody buys a fresh counter),
   * but a misconfigured proxy silently pools every visitor into a single counter instead of
   * falling back to the socket address that was available all along.
   */
  test('a trusted header with no usable entries yields no address rather than the socket', () => {
    const req = request({ 'cf-connecting-ip': ' , , ' }, '203.0.113.7');
    assert.equal(clientIp(req, 'cf-connecting-ip'), '');
  });

  /**
   * REGRESSION. An array-valued header used to take the FIRST element — the exact opposite
   * of the rightmost rule applied to the comma-joined form. A client sending its own header
   * line, with the proxy appending a second, would have won and picked its own bucket. Node
   * joins repeated lines of ordinary headers with ', ' (so they normally travel the comma
   * path), which is the only reason this was latent rather than live.
   */
  test("an array-valued header takes the proxy's entry, not the client's", () => {
    const req = request({ 'cf-connecting-ip': ['198.51.100.9', '203.0.113.7'] }, '10.0.0.1');
    assert.equal(clientIp(req, 'cf-connecting-ip'), '203.0.113.7');
  });

  /** A socket can lack a remote address once it is closing; that must not throw downstream. */
  test('a socket with no remote address degrades to an empty address, not a crash', () => {
    const req = request({});
    assert.equal(clientIp(req, null), '');
    assert.equal(bucket(''), '');
    assert.doesNotThrow(() => hashBucket(clientIp(req, null), SALT));
  });

  test('an IPv6 address from a trusted proxy still reaches its /64', () => {
    const req = request({ 'cf-connecting-ip': '2001:0db8:abcd:1::5' }, '10.0.0.1');
    assert.equal(bucket(clientIp(req, 'cf-connecting-ip')), '2001:db8:abcd:1::/64');
  });
});

describe('hashBucket: equality is all a limiter needs', () => {
  test('the same submitter always hashes to the same counter', () => {
    assert.equal(hashBucket('203.0.113.7', SALT), hashBucket('203.0.113.7', SALT));
  });

  test('one /64 is one counter however it is spelled', () => {
    assert.equal(hashBucket('2001:db8::1', SALT), hashBucket('2001:0DB8:0:0:0:0:0:beef', SALT));
  });

  test('separate submitters never share a counter', () => {
    const hashes = ['203.0.113.7', '203.0.113.8', '2001:db8:0:1::1', '2001:db8:0:2::1'].map((ip) =>
      hashBucket(ip, SALT),
    );
    assert.equal(new Set(hashes).size, hashes.length);
  });

  /** The whole point of storing hashes: a leaked queue file leaks no addresses. */
  test('a leaked counter file leaks no addresses', () => {
    for (const ip of ['203.0.113.7', '2001:db8:abcd:1::5', '::ffff:198.51.100.22']) {
      const hash = hashBucket(ip, SALT);
      assert.match(hash, /^[0-9a-f]{32}$/);
      assert.equal(hash.includes(ip), false);
      assert.equal(hash.includes(bucket(ip)), false);
      assert.equal(hash.includes(SALT), false);
    }
  });

  /** Documented trade in the module: rotating the salt resets rate limiting. */
  test('rotating the salt resets every counter', () => {
    assert.notEqual(hashBucket('203.0.113.7', SALT), hashBucket('203.0.113.7', 'rotated-salt'));
  });
});
