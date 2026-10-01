import { describe, expect, it } from "vitest";
import {
  allocateFifo, allocationErrorMessage, validateAllocations,
  type OpenDocument,
} from "@/lib/settlement-allocation";

/**
 * A recovery used to move the party's balance while attaching to no bill, so a
 * customer's ledger came back to zero while every invoice still read UNPAID.
 * These rules decide which bills a collection lands on and cap it at what is
 * actually owed, so they are what stands between the shop and money recorded
 * against the wrong invoice.
 */

const doc = (over: Partial<OpenDocument> & { no: number }): OpenDocument => ({
  id: `inv-${over.no}`,
  date: `2026-09-0${over.no}`,
  netBill: 1000,
  settled: 0,
  outstanding: 1000,
  ...over,
});

describe("allocateFifo", () => {
  it("fills the oldest bill first", () => {
    const { allocations, unallocated } = allocateFifo([doc({ no: 1 }), doc({ no: 2 })], 600);
    expect(allocations).toEqual([{ id: "inv-1", amount: 600 }]);
    expect(unallocated).toBe(0);
  });

  it("cascades onto the next bill once the first is covered", () => {
    const { allocations } = allocateFifo([doc({ no: 1 }), doc({ no: 2 })], 1500);
    expect(allocations).toEqual([
      { id: "inv-1", amount: 1000 },
      { id: "inv-2", amount: 500 },
    ]);
  });

  it("sorts by date itself, so a reordered list can't change the split", () => {
    const { allocations } = allocateFifo([doc({ no: 3 }), doc({ no: 1 }), doc({ no: 2 })], 1200);
    expect(allocations.map((a) => a.id)).toEqual(["inv-1", "inv-2"]);
  });

  it("breaks a same-day tie by document number", () => {
    const same = "2026-09-01";
    const { allocations } = allocateFifo(
      [doc({ no: 9, date: same }), doc({ no: 4, date: same })],
      500
    );
    expect(allocations[0].id).toBe("inv-4");
  });

  it("reports what it could not place", () => {
    const { allocations, unallocated } = allocateFifo([doc({ no: 1 })], 2500);
    expect(allocations).toEqual([{ id: "inv-1", amount: 1000 }]);
    expect(unallocated).toBe(1500);
  });

  it("respects a partly settled bill's remaining balance", () => {
    const { allocations } = allocateFifo(
      [doc({ no: 1, settled: 700, outstanding: 300 }), doc({ no: 2 })],
      800
    );
    expect(allocations).toEqual([
      { id: "inv-1", amount: 300 },
      { id: "inv-2", amount: 500 },
    ]);
  });

  it("skips fully settled bills", () => {
    const { allocations } = allocateFifo(
      [doc({ no: 1, settled: 1000, outstanding: 0 }), doc({ no: 2 })],
      400
    );
    expect(allocations).toEqual([{ id: "inv-2", amount: 400 }]);
  });

  it("allocates nothing when there is nothing open", () => {
    expect(allocateFifo([], 500)).toEqual({ allocations: [], unallocated: 500 });
  });
});

describe("validateAllocations", () => {
  const documents = [doc({ no: 1 }), doc({ no: 2, outstanding: 400, settled: 600 })];

  it("accepts a split that adds up and fits", () => {
    expect(validateAllocations({
      documents,
      allocations: [{ id: "inv-1", amount: 1000 }, { id: "inv-2", amount: 400 }],
      amount: 1400,
    })).toBeNull();
  });

  it("refuses collecting more than the party owes", () => {
    // The rule the shop asked for: no recovering more than the actual amount.
    const err = validateAllocations({
      documents,
      allocations: [{ id: "inv-1", amount: 1000 }],
      amount: 5000,
    });
    expect(err?.code).toBe("OVER_OUTSTANDING");
    expect(allocationErrorMessage(err!)).toContain("1400.00");
  });

  it("refuses more than one bill's own outstanding", () => {
    const err = validateAllocations({
      documents,
      allocations: [{ id: "inv-2", amount: 900 }],
      amount: 900,
    });
    expect(err?.code).toBe("OVER_DOCUMENT");
    expect(allocationErrorMessage(err!)).toContain("#2");
  });

  it("refuses a split larger than the amount collected", () => {
    expect(validateAllocations({
      documents,
      allocations: [{ id: "inv-1", amount: 1000 }, { id: "inv-2", amount: 400 }],
      amount: 500,
    })?.code).toBe("OVER_TOTAL");
  });

  it("allows a split smaller than the amount collected", () => {
    // Under-allocating is legitimate: part of the money can sit on account.
    expect(validateAllocations({
      documents,
      allocations: [{ id: "inv-1", amount: 300 }],
      amount: 500,
    })).toBeNull();
  });

  it("refuses a bill that isn't this party's", () => {
    expect(validateAllocations({
      documents,
      allocations: [{ id: "inv-99", amount: 100 }],
      amount: 100,
    })?.code).toBe("UNKNOWN_DOCUMENT");
  });

  it("refuses the same bill twice", () => {
    expect(validateAllocations({
      documents,
      allocations: [{ id: "inv-1", amount: 100 }, { id: "inv-1", amount: 100 }],
      amount: 200,
    })?.code).toBe("DUPLICATE_DOCUMENT");
  });

  it("refuses a zero or negative allocation", () => {
    expect(validateAllocations({
      documents, allocations: [{ id: "inv-1", amount: 0 }], amount: 100,
    })?.code).toBe("NOT_POSITIVE");
    expect(validateAllocations({
      documents, allocations: [{ id: "inv-1", amount: -50 }], amount: 100,
    })?.code).toBe("NOT_POSITIVE");
  });

  it("tolerates sub-paisa rounding on an exact settlement", () => {
    expect(validateAllocations({
      documents: [doc({ no: 1, outstanding: 333.33 })],
      allocations: [{ id: "inv-1", amount: 333.334 }],
      amount: 333.334,
    })).toBeNull();
  });

  it("refuses any collection at all when nothing is open", () => {
    expect(validateAllocations({ documents: [], allocations: [], amount: 100 })?.code)
      .toBe("OVER_OUTSTANDING");
  });
});
