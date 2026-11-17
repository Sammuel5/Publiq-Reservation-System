import type { ZodError } from "zod";

/**
 * Convert a ZodError into a flat field → message map.
 *
 * Only the FIRST issue per field is kept: a field with multiple failing rules
 * should show one clear message ("Email is required.") rather than being
 * overwritten by a later, more specific rule ("Enter a valid email address.").
 *
 * Shared by the login form, the reservation wizard and every admin form so the
 * behaviour is identical everywhere.
 */
export type FieldErrorMap = Record<string, string>;

export function fieldErrorsFromZod(error: ZodError): FieldErrorMap {
  const errors: FieldErrorMap = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    if (errors[key] === undefined) {
      errors[key] = issue.message;
    }
  }
  return errors;
}
