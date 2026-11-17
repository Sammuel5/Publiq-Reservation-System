/**
 * Input normalization helpers.
 *
 * These run on the server before validation/persistence so that the same person
 * always maps to the same Customer record and lookups behave predictably.
 */

/**
 * Normalize a Philippine mobile number to E.164 (`+639XXXXXXXXX`).
 * Accepts "0917 123 4567", "9171234567", "+63 917 123 4567", "63-917-123-4567".
 * Returns `null` when the input cannot be a valid PH mobile number.
 */
export function normalizeMobileNumber(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  if (!digits) return null;

  let local: string;

  if (digits.startsWith("+63")) local = digits.slice(3);
  else if (digits.startsWith("63") && digits.length >= 12) local = digits.slice(2);
  else if (digits.startsWith("0")) local = digits.slice(1);
  else local = digits;

  // PH mobile numbers are 10 digits after the country code and start with 9.
  if (!/^9\d{9}$/.test(local)) return null;

  return `+63${local}`;
}

/** Display form for staff-facing screens: 0917 123 4567. */
export function formatMobileNumber(e164: string): string {
  const match = /^\+63(\d{3})(\d{3})(\d{4})$/.exec(e164);
  if (!match) return e164;
  return `0${match[1]} ${match[2]} ${match[3]}`;
}

/** Last 4 digits only — used in public lookup responses. */
export function maskMobileNumber(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  return `••••••${digits.slice(-4)}`;
}

export function normalizeEmail(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) ? value : null;
}

/**
 * Collapse whitespace and normalize casing for names.
 * "  juan   DELA cruz " → "Juan Dela Cruz"
 */
export function normalizePersonName(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((part) =>
      part.length <= 2 && part === part.toLowerCase()
        ? part // keep particles like "de", "la", "van" lowercase
        : part
            .split("-")
            .map((chunk) =>
              chunk.length === 0
                ? chunk
                : chunk[0]!.toUpperCase() + chunk.slice(1).toLowerCase(),
            )
            .join("-"),
    )
    .join(" ");
}

export function slugify(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Trim and null-out empty strings (keeps optional fields out of the DB). */
export function blankToNull<T extends string | null | undefined>(
  value: T,
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Defense-in-depth against stored XSS: strip angle brackets from free text. */
export function sanitizeText(raw: string): string {
  return raw.replace(/[<>]/g, "").trim();
}
