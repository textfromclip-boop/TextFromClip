// Cryptographic helpers for cookies, magic links and webhook signatures.
// Uses Web Crypto (available in Cloudflare Workers and Node 18+), never FNV/Math.random.

const encoder = new TextEncoder();

export function bytesToHex(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let out = '';
  for (const b of arr) out += b.toString(16).padStart(2, '0');
  return out;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return bytesToHex(digest);
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return bytesToHex(sig);
}

/** Constant-time string comparison (both inputs are expected to be hex/ASCII). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i % (a.length || 1)) || 0) ^ (b.charCodeAt(i % (b.length || 1)) || 0);
  }
  return diff === 0;
}

/** Verifies a hex-encoded HMAC-SHA256 signature over `message`. */
export async function verifyHmacSha256Hex(
  secret: string,
  message: string,
  signatureHex: string | null | undefined
): Promise<boolean> {
  if (!secret || !signatureHex || !/^[0-9a-f]+$/i.test(signatureHex.trim())) return false;
  const expected = await hmacSha256Hex(secret, message);
  return timingSafeEqual(expected, signatureHex.trim().toLowerCase());
}

/** Cryptographically secure random token (base64url). 32 bytes = 256 bits by default. */
export function randomToken(byteLength: number = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

/** Short random id (hex), for cookie IDs and record IDs. */
export function randomId(prefix: string = '', byteLength: number = 12): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return `${prefix}${bytesToHex(bytes)}`;
}
