// ── Outbound fetch for user-supplied URLs (SSRF guard) ───────────────────────
//
// Job links, careers pages and company sites come from users or scraped
// data. Fetching them blindly lets anyone make this server request
// http://169.254.169.254/ (cloud metadata), localhost services or the VPC,
// and the evaluator then hands the page text back. Every such fetch goes
// through safeFetch():
//   • http/https only, default ports or 80/443/8080/8443;
//   • the hostname must resolve only to public addresses (checked again on
//     every redirect hop — redirects are followed manually);
//   • response bodies are capped.
import dns from 'node:dns';
import net from 'node:net';

const MAX_REDIRECTS = 5;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443']);

export class UnsafeUrlError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
}

const BLOCKED_V4 = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
].map(([base, bits]) => [ipv4ToInt(base), bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0]);

/** True for loopback, private, link-local, CGNAT, multicast, reserved and documentation ranges. */
export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const n = ipv4ToInt(ip);
    return BLOCKED_V4.some(([base, mask]) => (n & mask) === (base & mask));
  }
  if (net.isIPv6(ip)) {
    const v6 = ip.toLowerCase().replace(/^\[|\]$/g, '');
    if (v6 === '::' || v6 === '::1') return true;
    const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v6) || v6.startsWith('64:ff9b:') || v6.startsWith('2001:db8');
  }
  return true; // not an IP at all → treat as unsafe
}

async function defaultLookup(hostname) {
  const records = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  return records.map(r => r.address);
}

/**
 * Throw UnsafeUrlError unless `rawUrl` is http(s) and its host resolves only
 * to public addresses. Returns the parsed URL.
 */
export async function assertPublicUrl(rawUrl, { lookup = defaultLookup } = {}) {
  let url;
  try { url = new URL(String(rawUrl)); } catch { throw new UnsafeUrlError('Not a valid URL'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new UnsafeUrlError(`Only http(s) links are allowed (got ${url.protocol})`);
  if (url.username || url.password) throw new UnsafeUrlError('Links with credentials are not allowed');
  if (!ALLOWED_PORTS.has(url.port)) throw new UnsafeUrlError(`Port ${url.port} is not allowed`);

  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new UnsafeUrlError('Links to local or internal hosts are not allowed');
  }
  let addresses;
  if (net.isIP(host)) addresses = [host];
  else {
    try { addresses = await lookup(host); } catch { throw new UnsafeUrlError(`Could not resolve ${host}`); }
  }
  if (!addresses.length || addresses.some(isPrivateAddress)) {
    throw new UnsafeUrlError('Links to private or internal addresses are not allowed');
  }
  return url;
}

/**
 * fetch() for untrusted URLs. Same signature as fetch; extra options:
 *   maxBytes (default 5 MB) — the body is cut off beyond this;
 *   lookup — DNS resolver (tests).
 * Returns { res, url, text() } where text() enforces maxBytes.
 */
export async function safeFetch(rawUrl, { maxBytes = DEFAULT_MAX_BYTES, lookup, timeoutMs = 10000, ...init } = {}) {
  let current = String(rawUrl);
  const signal = init.signal ?? AbortSignal.timeout(timeoutMs);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertPublicUrl(current, { lookup });
    const res = await fetch(url, { ...init, signal, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), url).toString();
      try { await res.body?.cancel(); } catch { /* ignore */ }
      continue;
    }
    return {
      res,
      url: url.toString(),
      async text() {
        if (!res.body) return '';
        const reader = res.body.getReader();
        const chunks = [];
        let total = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > maxBytes) { await reader.cancel(); break; }
          chunks.push(value);
        }
        return Buffer.concat(chunks.map(c => Buffer.from(c))).toString('utf8');
      },
    };
  }
  throw new UnsafeUrlError('Too many redirects');
}
