/**
 * License keys, verified entirely on the device. A key is a small signed statement:
 *   BRW1-<base64url(JSON payload)>.<base64url(ECDSA P-256 signature over the payload part)>
 * Only the seller holds the private key; Burrow ships the public key and checks signatures
 * with WebCrypto. No network request is ever made.
 */

export const KEY_PREFIX = 'BRW1-';
export const MAX_KEY_LENGTH = 1024;

export interface LicenseInfo {
  /** The order or customer reference the key was issued for. Not personal data. */
  id: string;
  /** Epoch ms the key was issued. */
  issuedAt: number;
}

const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGN_PARAMS = { name: 'ECDSA', hash: 'SHA-256' } as const;

export function base64UrlToBytes(s: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** Removes spaces and line breaks that sneak in when a key is copied from an email. */
export function normalizeKey(input: string): string {
  return input.replace(/\s+/g, '');
}

function parsePayload(bytes: Uint8Array): LicenseInfo | null {
  try {
    const p: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof p !== 'object' || p === null) return null;
    const { v, id, iat } = p as Record<string, unknown>;
    if (v !== 1 || typeof id !== 'string' || id.length === 0 || id.length > 64) return null;
    if (typeof iat !== 'number' || !Number.isFinite(iat) || iat < 0) return null;
    return { id, issuedAt: iat };
  } catch {
    return null;
  }
}

/** Returns the license details if `input` is a genuine key signed for this public key, else null. Never throws. */
export async function verifyLicenseKey(input: string, publicKey: JsonWebKey): Promise<LicenseInfo | null> {
  const key = normalizeKey(input);
  if (!key.startsWith(KEY_PREFIX) || key.length > MAX_KEY_LENGTH) return null;
  const [payloadPart, sigPart, extra] = key.slice(KEY_PREFIX.length).split('.');
  if (!payloadPart || !sigPart || extra !== undefined) return null;
  const payload = base64UrlToBytes(payloadPart);
  const signature = base64UrlToBytes(sigPart);
  if (!payload || !signature || signature.length !== 64) return null;
  const info = parsePayload(payload);
  if (!info) return null;
  try {
    const pub = await crypto.subtle.importKey('jwk', publicKey, ALGORITHM, false, ['verify']);
    const ok = await crypto.subtle.verify(SIGN_PARAMS, pub, signature, new TextEncoder().encode(payloadPart));
    return ok ? info : null;
  } catch {
    return null;
  }
}
