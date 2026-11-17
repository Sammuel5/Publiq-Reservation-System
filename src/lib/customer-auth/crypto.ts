import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Authenticated encryption for short-lived customer-only cookies. */
export function seal(payload: object, secret: string): string {
  if (secret.length < 32) throw new Error("Customer session secret must be at least 32 characters");
  const key = createHash("sha256").update(secret).digest();
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
}
export function unseal<T>(value: string, secret: string): T | null {
  if (secret.length < 32 || value.length > 8192) return null;
  try {
    const bytes = Buffer.from(value, "base64url"); if (bytes.length < 29) return null;
    const key = createHash("sha256").update(secret).digest();
    const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8")) as T;
  } catch { return null; }
}
export function equalTokens(a: string, b: string): boolean {
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
export function validSeat(value: string): boolean { return /^(VIP [1-7]|VIP 3 \+ 4|Couch [2-6])$/.test(value); }
