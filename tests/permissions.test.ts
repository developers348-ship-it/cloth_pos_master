import { describe, expect, it } from "vitest";
import { DEFAULT_PERMISSIONS, PERMISSIONS, isAllowed, hasPermission } from "@/lib/permissions";

/**
 * `isAllowed` is the single resolver behind both the server guard
 * (lib/authz.ts) and the client hook (lib/permissions-client.tsx). It decides
 * who can void an invoice or move money, so its edges — an unknown key, a
 * missing role, a stored override that predates a permission — are worth
 * pinning down.
 */

describe("isAllowed — the resolver", () => {
  it("allows a role the matrix grants", () => {
    expect(isAllowed(DEFAULT_PERMISSIONS, "MANAGER", "VOID_INVOICE")).toBe(true);
  });

  it("refuses a role the matrix does not grant", () => {
    expect(isAllowed(DEFAULT_PERMISSIONS, "CASHIER", "VOID_INVOICE")).toBe(false);
    expect(isAllowed(DEFAULT_PERMISSIONS, "MANAGER", "DELETE_INVOICE")).toBe(false);
  });

  it("always allows SUPER_ADMIN, even against a matrix that omits them", () => {
    // The editor forces SUPER_ADMIN into every key, but a hand-edited or
    // corrupted override must not be able to lock the owner out.
    expect(isAllowed({ DELETE_INVOICE: [] }, "SUPER_ADMIN", "DELETE_INVOICE")).toBe(true);
    expect(isAllowed({}, "SUPER_ADMIN", "ANYTHING_AT_ALL")).toBe(true);
  });

  it("refuses when there is no role", () => {
    expect(isAllowed(DEFAULT_PERMISSIONS, undefined, "CREATE_INVOICE")).toBe(false);
    expect(isAllowed(DEFAULT_PERMISSIONS, null, "CREATE_INVOICE")).toBe(false);
    expect(isAllowed(DEFAULT_PERMISSIONS, "", "CREATE_INVOICE")).toBe(false);
  });

  it("fails closed on an unknown key", () => {
    // A typo in a guard must deny, not wave everyone through.
    expect(isAllowed(DEFAULT_PERMISSIONS, "ADMIN", "DELETE_INVOCE")).toBe(false);
  });

  it("falls back to the defaults for a key the override never mentioned", () => {
    // This is the bug the per-key layering fixes: an override saved before
    // MARK_INVOICE_PAID existed must not deny it to every role.
    const staleOverride = { DELETE_INVOICE: ["ADMIN"] };
    expect(isAllowed(staleOverride, "MANAGER", "MARK_INVOICE_PAID")).toBe(true);
    expect(isAllowed(staleOverride, "CASHIER", "MARK_INVOICE_PAID")).toBe(false);
  });

  it("lets an override widen a permission", () => {
    const override = { ...DEFAULT_PERMISSIONS, DELETE_INVOICE: ["ADMIN", "MANAGER"] };
    expect(isAllowed(override, "MANAGER", "DELETE_INVOICE")).toBe(true);
  });

  it("lets an override narrow a permission", () => {
    const override = { ...DEFAULT_PERMISSIONS, CREATE_INVOICE: ["ADMIN"] };
    expect(isAllowed(override, "CASHIER", "CREATE_INVOICE")).toBe(false);
  });

  it("survives a malformed entry instead of throwing", () => {
    expect(isAllowed({ VOID_INVOICE: "ADMIN" } as never, "ADMIN", "VOID_INVOICE")).toBe(false);
  });
});

describe("the default matrix", () => {
  it("exposes the same keys in both forms", () => {
    expect(Object.keys(DEFAULT_PERMISSIONS).sort()).toEqual(Object.keys(PERMISSIONS).sort());
  });

  it("grants SUPER_ADMIN every permission outright", () => {
    for (const [key, roles] of Object.entries(DEFAULT_PERMISSIONS)) {
      expect(roles, key).toContain("SUPER_ADMIN");
    }
  });

  it("names no role that is not a real role", () => {
    const valid = new Set(["SUPER_ADMIN", "ADMIN", "MANAGER", "CASHIER", "ACCOUNTANT"]);
    for (const [key, roles] of Object.entries(DEFAULT_PERMISSIONS)) {
      for (const role of roles) expect(valid.has(role), `${key}: ${role}`).toBe(true);
    }
  });

  it("carries every key the Phase 7/8 work added", () => {
    for (const key of [
      "VOID_INVOICE", "APPLY_STORE_CREDIT", "MARK_INVOICE_PAID", "MARK_INVOICE_UNPAID",
      "CHANGE_INVOICE_CUSTOMER", "COLLECT_INSTALLMENT",
    ]) {
      expect(DEFAULT_PERMISSIONS[key], key).toBeDefined();
    }
  });

  // The single MANAGE_ACCOUNTS key was split into these when bank accounts
  // moved out of Settings onto their own page.
  it("carries the per-action bank account keys", () => {
    for (const key of [
      "VIEW_ACCOUNTS", "VIEW_ACCOUNT_LEDGER", "CREATE_ACCOUNT",
      "EDIT_ACCOUNT", "DELETE_ACCOUNT", "TRANSFER_FUNDS",
    ]) {
      expect(DEFAULT_PERMISSIONS[key], key).toBeDefined();
    }
    expect(DEFAULT_PERMISSIONS.MANAGE_ACCOUNTS).toBeUndefined();
  });

  it("keeps reading an account looser than changing one", () => {
    const readers = DEFAULT_PERMISSIONS.VIEW_ACCOUNTS;
    for (const key of ["CREATE_ACCOUNT", "EDIT_ACCOUNT", "DELETE_ACCOUNT"]) {
      const writers = DEFAULT_PERMISSIONS[key];
      expect(writers.length, key).toBeLessThan(readers.length);
      for (const role of writers) expect(readers, `${key}: ${role}`).toContain(role);
    }
  });

  it("keeps destructive actions tighter than reversible ones", () => {
    const voiders = DEFAULT_PERMISSIONS.VOID_INVOICE;
    const deleters = DEFAULT_PERMISSIONS.DELETE_INVOICE;
    expect(deleters.length).toBeLessThan(voiders.length);
    for (const role of deleters) expect(voiders).toContain(role);
  });

  it("keeps reversing a payment tighter than taking one", () => {
    const takers = DEFAULT_PERMISSIONS.MARK_INVOICE_PAID;
    const reversers = DEFAULT_PERMISSIONS.MARK_INVOICE_UNPAID;
    expect(reversers.length).toBeLessThan(takers.length);
    for (const role of reversers) expect(takers).toContain(role);
  });

  it("agrees with the typed helper", () => {
    expect(hasPermission("CASHIER", "CREATE_INVOICE")).toBe(true);
    expect(hasPermission("CASHIER", "DELETE_INVOICE")).toBe(false);
  });
});
