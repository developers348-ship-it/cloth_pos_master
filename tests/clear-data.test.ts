import { describe, expect, it } from "vitest";
import { ALL_GROUP_IDS, CLEAR_GROUPS, isClearConfirmed, resolveGroupSelection } from "@/lib/clear-data";

/**
 * `resolveGroupSelection` is what stands between a Settings -> Clear Data
 * click and a foreign-key violation: it expands whatever the UI selected
 * into every group that selection depends on, in the one order that is
 * always safe to delete in. Getting a `requires` edge wrong here either
 * clears too much (silently, the real risk) or trips a DB constraint (loud,
 * self-correcting) — these tests pin the "too much" direction, since the
 * loud one already protects itself.
 */

describe("resolveGroupSelection", () => {
  it("returns an empty selection unchanged", () => {
    expect(resolveGroupSelection([])).toEqual([]);
  });

  it("drops unknown ids instead of throwing", () => {
    expect(resolveGroupSelection(["not-a-real-group"])).toEqual([]);
  });

  it("pulls in a group's requirements", () => {
    // sales requires ledgerMoney (LedgerEntry/Recovery/AccountEntry/
    // InstallmentPlan all reference SaleInvoice).
    expect(resolveGroupSelection(["sales"])).toEqual(["ledgerMoney", "sales"]);
  });

  it("expands transitively", () => {
    // catalog requires stockAdjustments, sales and purchases; sales and
    // purchases each require ledgerMoney.
    const resolved = resolveGroupSelection(["catalog"]);
    expect(resolved).toContain("ledgerMoney");
    expect(resolved).toContain("stockAdjustments");
    expect(resolved).toContain("sales");
    expect(resolved).toContain("purchases");
    expect(resolved).toContain("catalog");
  });

  it("keeps the fixed delete order regardless of selection order", () => {
    const a = resolveGroupSelection(["parties", "sales", "ledgerMoney"]);
    const b = resolveGroupSelection(["ledgerMoney", "sales", "parties"]);
    expect(a).toEqual(b);
    // ledgerMoney (a requirement of both) must come before the groups that need it.
    expect(a.indexOf("ledgerMoney")).toBeLessThan(a.indexOf("sales"));
    expect(a.indexOf("sales")).toBeLessThan(a.indexOf("parties"));
  });

  it("deduplicates a group required by more than one selection", () => {
    const resolved = resolveGroupSelection(["sales", "purchases", "expenses"]);
    expect(resolved.filter((id) => id === "ledgerMoney")).toHaveLength(1);
  });

  it("selecting everything resolves to every group, once each", () => {
    const resolved = resolveGroupSelection(ALL_GROUP_IDS);
    expect(resolved).toHaveLength(CLEAR_GROUPS.length);
    expect(new Set(resolved).size).toBe(CLEAR_GROUPS.length);
  });

  it("every declared requirement is itself a real group id", () => {
    const ids = new Set(CLEAR_GROUPS.map((g) => g.id));
    for (const group of CLEAR_GROUPS) {
      for (const req of group.requires) {
        expect(ids.has(req)).toBe(true);
      }
    }
  });
});

describe("isClearConfirmed", () => {
  it("requires the exact phrase", () => {
    expect(isClearConfirmed("CLEAR")).toBe(true);
  });

  it("rejects anything else, including a near miss", () => {
    expect(isClearConfirmed("clear")).toBe(false);
    expect(isClearConfirmed("Clear")).toBe(false);
    expect(isClearConfirmed(" CLEAR ")).toBe(false);
    expect(isClearConfirmed("")).toBe(false);
    expect(isClearConfirmed(undefined)).toBe(false);
    expect(isClearConfirmed(null)).toBe(false);
  });
});
