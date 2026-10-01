/**
 * "Login as user" — the rules, with no Prisma or next-auth in sight so the
 * settings screen can import them to decide which rows get the button and the
 * server can import them to decide whether to honour the request.
 *
 * An admin signing in as a cashier is a support and testing tool: it shows the
 * menu the cashier sees and lets the admin ring up a sale under their name.
 * That makes it a way of *changing* who you are, so the one thing it must never
 * become is a way of changing who you are into someone with more power. The
 * rank rule below is what prevents that: you may only step down.
 */

/**
 * How much authority each role carries. CASHIER and ACCOUNTANT are deliberately
 * equal — they are different jobs, not different levels — which, with the
 * strictly-lower rule, means neither can step into the other even if a custom
 * matrix hands one of them IMPERSONATE_USER.
 */
export const ROLE_RANK: Record<string, number> = {
  SUPER_ADMIN: 5,
  ADMIN: 4,
  MANAGER: 3,
  CASHIER: 2,
  ACCOUNTANT: 2,
};

export type ImpersonationTargetLike = {
  id: string;
  role: string;
  isActive: boolean;
};

/**
 * Why this actor may not become this target, or null when they may.
 *
 * The message is shown to the admin as-is, so it says which rule stopped it.
 * Holding IMPERSONATE_USER is checked separately against the permission matrix
 * — this covers the parts the matrix can't express.
 */
export function impersonationBlockReason(
  actor: { id: string; role: string },
  target: ImpersonationTargetLike
): string | null {
  if (actor.id === target.id) return "You are already signed in as this user";
  if (!target.isActive) {
    return "This account is deactivated — activate it before signing in as them";
  }

  const actorRank = ROLE_RANK[actor.role] ?? 0;
  const targetRank = ROLE_RANK[target.role] ?? 0;

  // Strictly lower, so an admin cannot sidestep into another admin's account
  // (nor into a Super Admin's) and pick up permissions their own role was never
  // granted. Without this, "login as" would be a privilege escalation with an
  // audit trail pointing at the wrong person.
  if (targetRank >= actorRank) {
    return "You can only sign in as a user whose role is below your own";
  }

  return null;
}

/** Whether to offer the button at all, given only the two roles. */
export function canImpersonateRole(actorRole: string | undefined, targetRole: string): boolean {
  if (!actorRole) return false;
  return (ROLE_RANK[targetRole] ?? 0) < (ROLE_RANK[actorRole] ?? 0);
}
