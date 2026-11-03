import { randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Private (RFC 1918) IPv4 literal, e.g. 192.168.1.122. */
export function isPrivateIPv4(address) {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address || '');
  if (!match) return false;
  const [a, b, c, d] = match.slice(1).map(Number);
  if ([a, b, c, d].some(part => part > 255)) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** Host header allowed for this port. LAN mode adds private IPv4 literals; never a DNS name. */
export function hostAllowed(host, port, lan) {
  if (host === `127.0.0.1:${port}` || host === `localhost:${port}`) return true;
  if (!lan) return false;
  const match = /^([\d.]+):(\d+)$/.exec(host || '');
  return Boolean(match) && match[2] === String(port) && isPrivateIPv4(match[1]);
}

export function isLoopback(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

export function newAccessCode() {
  const bytes = randomBytes(8);
  const chars = [...bytes].map(byte => ALPHABET[byte % ALPHABET.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

const normalize = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export function codeMatches(input, code) {
  const a = Buffer.from(normalize(input)), b = Buffer.from(normalize(code));
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

/** In-memory sessions: a restart signs everybody out. */
export const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
export function createSessions({ now = Date.now, ttl = SESSION_MS } = {}) {
  const tokens = new Map();
  return {
    issue() { const token = randomBytes(32).toString('hex'); tokens.set(token, now() + ttl); return token; },
    valid(cookieHeader) {
      const match = /(?:^|;\s*)qd_session=([0-9a-f]{64})(?:;|$)/.exec(cookieHeader || '');
      if (!match) return false;
      const expires = tokens.get(match[1]);
      if (expires === undefined) return false;
      if (now() >= expires) { tokens.delete(match[1]); return false; }
      return true;
    },
  };
}

/** At most `limit` failed attempts per address in `windowMs`. */
export function createLimiter({ limit = 5, windowMs = 60000, now = Date.now } = {}) {
  const failures = new Map();
  const recent = address => (failures.get(address) || []).filter(time => now() - time < windowMs);
  return {
    blocked: address => recent(address).length >= limit,
    fail(address) { failures.set(address, [...recent(address), now()]); },
    clear(address) { failures.delete(address); },
  };
}

export const loginPage = message => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Quota Desk</title><style>body{font:18px system-ui;max-width:22rem;margin:20vh auto;padding:0 1rem}input,button{font:inherit;padding:.6rem;width:100%;box-sizing:border-box;margin-top:.6rem}.error{color:#b00020}</style></head><body><h1>Quota Desk</h1><p>Enter the access code shown by the server.</p>${message ? `<p class="error">${message}</p>` : ''}<form method="post" action="/login"><input name="code" autocomplete="off" autocapitalize="characters" autofocus placeholder="XXXX-XXXX"><button>Sign in</button></form></body></html>`;
