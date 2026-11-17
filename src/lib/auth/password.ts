import bcrypt from "bcryptjs";

/**
 * Password hashing.
 *
 * - bcrypt (via bcryptjs, a pure-JS implementation) with cost factor 12.
 *   Chosen over native `bcrypt` because it needs no build toolchain on Vercel
 *   serverless and no node-gyp; the algorithm and work factor are identical.
 * - Plaintext passwords never leave this module and are never logged or stored.
 */

const BCRYPT_ROUNDS = 12;

/**
 * A valid bcrypt hash of a throwaway value. When a login is attempted for an
 * unknown email we still run one comparison so response timing does not reveal
 * whether an account exists.
 */
const TIMING_EQUALIZATION_HASH =
  "$2b$12$0GIakol5Ug4d4tHBFzr0pudmKVC.deqWTUo1V7K.1JzhfRaqZnIg2";

export async function hashPassword(plainPassword: string): Promise<string> {
  if (!plainPassword) throw new Error("Password is required");
  return bcrypt.hash(plainPassword, BCRYPT_ROUNDS);
}

export async function verifyPassword(
  plainPassword: string,
  passwordHash: string,
): Promise<boolean> {
  if (!plainPassword || !passwordHash) return false;
  try {
    return await bcrypt.compare(plainPassword, passwordHash);
  } catch {
    return false;
  }
}

/** Burn the same amount of time as a real check when the account is unknown. */
export async function equalizeVerifyTiming(plainPassword: string): Promise<void> {
  await bcrypt.compare(plainPassword, TIMING_EQUALIZATION_HASH).catch(() => false);
}

export type PasswordPolicyResult = {
  ok: boolean;
  issues: string[];
};

/** Minimum policy: 12+ chars with upper, lower, digit and symbol. */
export function validatePasswordPolicy(password: string): PasswordPolicyResult {
  const issues: string[] = [];
  if (password.length < 12) issues.push("Use at least 12 characters.");
  if (!/[a-z]/.test(password)) issues.push("Include a lowercase letter.");
  if (!/[A-Z]/.test(password)) issues.push("Include an uppercase letter.");
  if (!/\d/.test(password)) issues.push("Include a number.");
  if (!/[^A-Za-z0-9]/.test(password)) issues.push("Include a symbol.");
  if (/\s/.test(password)) issues.push("Do not use spaces.");
  return { ok: issues.length === 0, issues };
}

/** Cryptographically random password for admin-created staff accounts. */
export function generateSecurePassword(length = 20): string {
  const alphabet =
    "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*-_=+";
  const { randomInt } = require("node:crypto") as typeof import("node:crypto");
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += alphabet[randomInt(0, alphabet.length)];
  }
  return out;
}
