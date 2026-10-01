import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** Token opaco de 256 bits, seguro para URL. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Apenas o hash do token é persistido; o token em claro existe só no cliente. */
export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
