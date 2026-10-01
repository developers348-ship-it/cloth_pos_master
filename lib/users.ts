import { Role } from "@prisma/client";

/**
 * Shared rules for the user-management endpoints.
 *
 * Kept free of Prisma calls so both POST /api/settings/users and
 * PATCH /api/settings/users/[id] apply exactly the same rules — an edit form
 * that accepted a two-character password the create form rejected was the kind
 * of drift this avoids.
 */

export const MIN_PASSWORD_LENGTH = 8;

export const ROLES = Object.values(Role) as string[];

/** Emails are the login identifier, so they are compared case-insensitively. */
export function normalizeEmail(email: string): string {
  return String(email).trim().toLowerCase();
}

function looksLikeEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Returns an error message, or null when the fields are acceptable. Every field
 * is optional so a PATCH can validate just the parts it is changing.
 */
export function validateUserInput(input: {
  name?: unknown;
  email?: unknown;
  password?: unknown;
  role?: unknown;
}): string | null {
  if (input.name !== undefined) {
    const name = String(input.name).trim();
    if (name.length < 2) return "Name must be at least 2 characters";
    if (name.length > 100) return "Name must be 100 characters or fewer";
  }

  if (input.email !== undefined) {
    const email = normalizeEmail(String(input.email));
    if (!looksLikeEmail(email)) return "Enter a valid email address";
  }

  if (input.password !== undefined) {
    const password = String(input.password);
    if (password.length < MIN_PASSWORD_LENGTH) {
      return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
    }
  }

  if (input.role !== undefined && !ROLES.includes(String(input.role))) {
    return "Unknown role";
  }

  return null;
}
