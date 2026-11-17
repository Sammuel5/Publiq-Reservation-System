import { z } from "zod";

/**
 * Shared auth validation schemas.
 * These are used on the client for instant feedback AND re-validated on the
 * server — the server never trusts the browser.
 */

export const emailField = z
  .string({ required_error: "Email is required." })
  .trim()
  .min(1, "Email is required.")
  .max(254, "That email address is too long.")
  .email("Enter a valid email address.")
  .transform((value) => value.toLowerCase());

export const loginSchema = z.object({
  email: emailField,
  password: z
    .string({ required_error: "Password is required." })
    .min(1, "Password is required.")
    .max(200, "That password is too long."),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password."),
    newPassword: z
      .string()
      .min(12, "Use at least 12 characters.")
      .max(200)
      .regex(/[a-z]/, "Include a lowercase letter.")
      .regex(/[A-Z]/, "Include an uppercase letter.")
      .regex(/\d/, "Include a number.")
      .regex(/[^A-Za-z0-9]/, "Include a symbol."),
    confirmPassword: z.string().min(1, "Confirm your new password."),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    path: ["newPassword"],
    message: "Choose a password you have not used before.",
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
