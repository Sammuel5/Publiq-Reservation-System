import { randomInt } from "node:crypto";
import { Reservation } from "@/lib/db/models";
import { isDuplicateKeyError } from "@/lib/errors";

/**
 * Reservation reference generation.
 *
 * Format: `NK-XXXXXX` — 6 characters from an unambiguous alphabet (no O/0/I/1)
 * so staff can read it over the phone. ~1.2 billion combinations.
 *
 * Uniqueness is guaranteed by the database (`uniq_reference` index): we retry on
 * duplicate-key rather than trusting a pre-check, which keeps it correct under
 * concurrency.
 */

const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const PREFIX = "NK-";
const BODY_LENGTH = 6;
const MAX_ATTEMPTS = 6;

export function generateReferenceCandidate(): string {
  let body = "";
  for (let i = 0; i < BODY_LENGTH; i += 1) {
    body += ALPHABET[randomInt(0, ALPHABET.length)];
  }
  return `${PREFIX}${body}`;
}

export function normalizeReference(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, "");
}

export function isValidReferenceFormat(input: string): boolean {
  return /^NK-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/.test(normalizeReference(input));
}

/**
 * Create a reservation document with a unique reference, retrying on collision.
 * `insert` performs the actual write and returns the created document.
 */
export async function createWithUniqueReference<T>(
  insert: (reference: string) => Promise<T>,
): Promise<T> {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const reference = generateReferenceCandidate();
    try {
      return await insert(reference);
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        // Either the reference collided (retry) or a slot lock was taken
        // (surface as a booking conflict, handled by the caller).
        const message = JSON.stringify(
          (error as { keyPattern?: Record<string, unknown> }).keyPattern ?? {},
        );
        if (message.includes("reservationReference")) {
          lastError = error;
          continue;
        }
      }
      throw error;
    }
  }

  throw new Error(
    `Could not allocate a unique reservation reference after ${MAX_ATTEMPTS} attempts: ${String(lastError)}`,
  );
}

/** True when the error came from the `uniq_reference` index. */
export async function referenceExists(reference: string): Promise<boolean> {
  const found = await Reservation.exists({ reservationReference: reference });
  return Boolean(found);
}
