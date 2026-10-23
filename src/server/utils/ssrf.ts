/**
 * SSRF and URL validation protections
 * Ensures no loopback, private RFC1918, link-local, or cloud metadata endpoints are accessed.
 */

// Private IPv4 ranges
const PRIVATE_IPV4_REGEX = /^(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3}|0\.0\.0\.0)$/;

// Blocked hostnames (cloud metadata, internal DNS, localhost)
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  'metadata.google.internal',
  '169.254.169.254',
  'instance-data',
  'metadata.local'
]);

export interface SafeUrlCheckResult {
  isValid: boolean;
  normalizedUrl?: string;
  error?: string;
}

export function validateSafeUrl(rawUrl: string): SafeUrlCheckResult {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { isValid: false, error: 'URL must be a non-empty string.' };
  }

  const trimmed = rawUrl.trim();
  if (trimmed.length > 2048) {
    return { isValid: false, error: 'URL exceeds maximum length of 2048 characters.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch (err) {
    return { isValid: false, error: 'Invalid URL format. Please provide a full URL including https://' };
  }

  // Enforce HTTPS or HTTP (disallow file://, gopher://, ftp://, data://, etc.)
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { isValid: false, error: 'Only http and https video URLs are supported.' };
  }

  // Reject standard credentials in URLs (e.g., https://user:pass@host)
  if (parsed.username || parsed.password) {
    return { isValid: false, error: 'URLs with embedded credentials are not permitted.' };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Check against blocked hostnames
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { isValid: false, error: 'Access to internal or restricted hostnames is blocked.' };
  }

  // Check if hostname looks like private IPv4 address
  if (PRIVATE_IPV4_REGEX.test(hostname)) {
    return { isValid: false, error: 'Access to private network IP addresses is blocked.' };
  }

  // Disallow non-standard ports (only allow default 80 and 443)
  if (parsed.port && parsed.port !== '80' && parsed.port !== '443') {
    return { isValid: false, error: 'Connections to custom ports are blocked.' };
  }

  return { isValid: true, normalizedUrl: parsed.toString() };
}

