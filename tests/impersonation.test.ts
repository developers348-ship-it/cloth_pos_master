import { describe, expect, it } from "vitest";
import { canImpersonateRole, impersonationBlockReason, ROLE_RANK } from "@/lib/impersonation";
import { DEFAULT_PERMISSIONS, isAllowed } from "@/lib/permissions";

/**
 * "Login as user" is the one feature in the app that hands one person another
 * person's access, so the rule that keeps it from being a privilege escalation
 * — you may only step *down* — is worth pinning here rather than trusting to a
 * reading of the UI.
 */

const ADMIN = { id: "admin-1", role: "ADMIN" };
const SUPER = { id: "super-1", role: "SUPER_ADMIN" };

function target(role: string, over: Partial<{ id: string; isActive: boolean }> = {}) {
  return { id: "target-1", role, isActive: true, ...over };
}

describe("impersonationBlockReason", () => {
  it("lets an admin step down into the counter roles", () => {
    for (const role of ["MANAGER", "CASHIER", "ACCOUNTANT"]) {
      expect(impersonationBlockReason(ADMIN, target(role))).toBeNull();
    }
  });

  it("refuses a sideways step into an equal role", () => {
    // The escalation that matters: an admin who could become another admin
    // would inherit whatever that account was granted, under their name.
    expect(impersonationBlockReason(ADMIN, target("ADMIN"))).toMatch(/below your own/);
    expect(impersonationBlockReason(SUPER, target("SUPER_ADMIN"))).toMatch(/below your own/);
    // Cashier and accountant are equal rank, so neither can become the other.
    expect(
      impersonationBlockReason({ id: "c", role: "CASHIER" }, target("ACCOUNTANT"))
    ).toMatch(/below your own/);
  });

  it("refuses a step up", () => {
    expect(impersonationBlockReason(ADMIN, target("SUPER_ADMIN"))).toMatch(/below your own/);
  });

  it("refuses yourself", () => {
    expect(impersonationBlockReason(ADMIN, target("CASHIER", { id: ADMIN.id }))).toMatch(/already/);
  });

  it("refuses a deactivated account", () => {
    // A login that is blocked for the user themselves must not be reachable by
    // an admin borrowing the account.
    expect(impersonationBlockReason(SUPER, target("CASHIER", { isActive: false })))
      .toMatch(/deactivated/);
  });

  it("treats an unknown role as the bottom rank rather than the top", () => {
    expect(impersonationBlockReason({ id: "x", role: "WHAT" }, target("CASHIER")))
      .toMatch(/below your own/);
    expect(impersonationBlockReason(SUPER, target("WHAT"))).toBeNull();
  });
});

describe("canImpersonateRole — what the settings row offers", () => {
  it("agrees with the block reason on every pair of roles", () => {
    for (const actorRole of Object.keys(ROLE_RANK)) {
      for (const targetRole of Object.keys(ROLE_RANK)) {
        const offered = canImpersonateRole(actorRole, targetRole);
        const blocked = impersonationBlockReason(
          { id: "a", role: actorRole },
          target(targetRole)
        );
        expect(offered).toBe(blocked === null);
      }
    }
  });

  it("offers nothing when there is no signed-in role", () => {
    expect(canImpersonateRole(undefined, "CASHIER")).toBe(false);
  });
});

describe("the IMPERSONATE_USER key", () => {
  it("is granted to the two roles that manage the accounts, and no one else", () => {
    expect(isAllowed(DEFAULT_PERMISSIONS, "ADMIN", "IMPERSONATE_USER")).toBe(true);
    expect(isAllowed(DEFAULT_PERMISSIONS, "MANAGER", "IMPERSONATE_USER")).toBe(false);
    expect(isAllowed(DEFAULT_PERMISSIONS, "CASHIER", "IMPERSONATE_USER")).toBe(false);
    expect(isAllowed(DEFAULT_PERMISSIONS, "ACCOUNTANT", "IMPERSONATE_USER")).toBe(false);
  });
});
