import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import argon2 from 'argon2';

export const hashPassword = (pw: string) => argon2.hash(pw, { type: argon2.argon2id });
export const verifyPassword = (hash: string, pw: string) => argon2.verify(hash, pw);

// AES-256-GCM; format: base64(iv).base64(tag).base64(ciphertext)
export function encryptField(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join('.');
}

export function decryptField(payload: string, key: Buffer): string {
  const [ivB64, tagB64, ctB64] = payload.split('.');
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('malformed ciphertext');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export function fieldKey(): Buffer {
  const hex = process.env.FIELD_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) throw new Error('FIELD_ENCRYPTION_KEY must be 64 hex chars (256-bit)');
  return Buffer.from(hex, 'hex');
}
