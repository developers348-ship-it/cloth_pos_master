import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SHOP_UTC_OFFSET_MINUTES,
  formatDate,
  formatTime,
  getDateRangeForPreset,
  shopDateKey,
  shopDayWindow,
  shopMonthKey,
  shopMonthStart,
  shopStartOfToday,
  shopToday,
} from "@/lib/utils";
import { generateInstallmentSchedule } from "@/lib/installments";

/**
 * The bug these guard against: a sale rung up at 02:00 in Pakistan is stored as
 * 21:00 UTC the *previous* day. Every date-filtered report built its window from
 * `new Date("2026-09-15")` (UTC midnight) and `setHours(23, 59, 59, 999)`
 * (server-local hours) — two different clocks — which on a UTC server produced
 * `00:00Z .. 18:59Z`. That both missed the shop's first five hours and leaked
 * the next day's first five in, so an early-morning sale appeared in no date
 * range at all.
 */

afterEach(() => {
  vi.useRealTimers();
});

/** Pin the clock to a real instant so "today" is deterministic. */
function at(iso: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
}

describe("SHOP_UTC_OFFSET_MINUTES", () => {
  it("is Pakistan, UTC+5", () => {
    expect(SHOP_UTC_OFFSET_MINUTES).toBe(300);
  });
});

describe("shopDayWindow", () => {
  it("spans the shop's day, not the server's", () => {
    const w = shopDayWindow("2026-09-15", "2026-09-15")!;
    // Shop midnight is 19:00 UTC the day before.
    expect(w.gte!.toISOString()).toBe("2026-09-14T19:00:00.000Z");
    expect(w.lte!.toISOString()).toBe("2026-09-15T18:59:59.999Z");
  });

  it("covers exactly 24 hours", () => {
    const w = shopDayWindow("2026-09-15", "2026-09-15")!;
    expect(w.lte!.getTime() - w.gte!.getTime()).toBe(24 * 60 * 60 * 1000 - 1);
  });

  it("catches the 2am sale that used to vanish", () => {
    // Invoice #26: rung up 02:02 on 15 Sep in the shop, stored as 21:02Z on the
    // 14th. The old window (00:00Z..18:59Z on the 15th) excluded it, and so did
    // the 14th's.
    const sale = new Date("2026-09-14T21:02:27.506Z");
    const w = shopDayWindow("2026-09-15", "2026-09-15")!;
    expect(sale >= w.gte!).toBe(true);
    expect(sale <= w.lte!).toBe(true);
  });

  it("does not also claim that sale for the previous day", () => {
    const sale = new Date("2026-09-14T21:02:27.506Z");
    const w = shopDayWindow("2026-09-14", "2026-09-14")!;
    expect(sale <= w.lte!).toBe(false);
  });

  it("leaves no gap between consecutive days", () => {
    const first = shopDayWindow("2026-09-14", "2026-09-14")!;
    const second = shopDayWindow("2026-09-15", "2026-09-15")!;
    expect(second.gte!.getTime() - first.lte!.getTime()).toBe(1);
  });

  it("handles a multi-day range from one end to the other", () => {
    const w = shopDayWindow("2026-09-01", "2026-09-30")!;
    expect(w.gte!.toISOString()).toBe("2026-08-31T19:00:00.000Z");
    expect(w.lte!.toISOString()).toBe("2026-09-30T18:59:59.999Z");
  });

  it("returns undefined when neither end is given, so callers can skip the filter", () => {
    expect(shopDayWindow()).toBeUndefined();
    expect(shopDayWindow("", "")).toBeUndefined();
  });

  it("takes one open end", () => {
    expect(shopDayWindow("2026-09-15")!.lte).toBeUndefined();
    expect(shopDayWindow(undefined, "2026-09-15")!.gte).toBeUndefined();
  });

  it("passes a precise instant through untouched", () => {
    // A caller that already holds a timestamp is not asking for a day.
    const w = shopDayWindow("2026-09-15T08:30:00.000Z", undefined)!;
    expect(w.gte!.toISOString()).toBe("2026-09-15T08:30:00.000Z");
  });
});

describe("getDateRangeForPreset", () => {
  it("names the shop's today during the hours that used to name yesterday", () => {
    // 02:02 on 15 Sep in the shop. The UTC date is still the 14th, which is
    // what the old `toISOString().slice(0, 10)` returned.
    at("2026-09-14T21:02:00.000Z");
    expect(getDateRangeForPreset("today")).toEqual({
      from: "2026-09-15",
      to: "2026-09-15",
    });
  });

  it("still names it correctly in the middle of the shop's day", () => {
    at("2026-09-15T09:00:00.000Z"); // 14:00 in the shop
    expect(getDateRangeForPreset("today").from).toBe("2026-09-15");
  });

  it("does not roll over early — 23:59 shop time is still the same day", () => {
    at("2026-09-15T18:59:00.000Z"); // 23:59 in the shop
    expect(getDateRangeForPreset("today").from).toBe("2026-09-15");
  });

  it("rolls over exactly at the shop's midnight", () => {
    at("2026-09-15T19:00:00.000Z"); // 00:00 on the 16th in the shop
    expect(getDateRangeForPreset("today").from).toBe("2026-09-16");
  });

  it("yesterday follows the same clock", () => {
    at("2026-09-14T21:02:00.000Z");
    expect(getDateRangeForPreset("yesterday")).toEqual({
      from: "2026-09-14",
      to: "2026-09-14",
    });
  });

  it("last7days spans seven days inclusive", () => {
    at("2026-09-14T21:02:00.000Z"); // shop: 15 Sep
    expect(getDateRangeForPreset("last7days")).toEqual({
      from: "2026-09-09",
      to: "2026-09-15",
    });
  });

  it("thisMonth and lastMonth land on real month boundaries", () => {
    at("2026-09-14T21:02:00.000Z");
    expect(getDateRangeForPreset("thisMonth")).toEqual({
      from: "2026-09-01",
      to: "2026-09-15",
    });
    expect(getDateRangeForPreset("lastMonth")).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
    });
  });

  it("crosses a month boundary in shop time, not UTC", () => {
    // 01 Oct 01:00 in the shop is still 30 Sep in UTC.
    at("2026-09-30T20:00:00.000Z");
    expect(getDateRangeForPreset("today").from).toBe("2026-10-01");
    expect(getDateRangeForPreset("thisMonth").from).toBe("2026-10-01");
    expect(getDateRangeForPreset("lastMonth")).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
    });
  });

  it("crosses a year boundary the same way", () => {
    at("2026-12-31T20:00:00.000Z"); // 01 Jan 2027, 01:00 in the shop
    expect(getDateRangeForPreset("today").from).toBe("2027-01-01");
    expect(getDateRangeForPreset("thisYear").from).toBe("2027-01-01");
    expect(getDateRangeForPreset("lastYear")).toEqual({
      from: "2026-01-01",
      to: "2026-12-31",
    });
  });

  it("returns blanks for 'all', so the caller drops the filter entirely", () => {
    expect(getDateRangeForPreset("all")).toEqual({ from: "", to: "" });
  });

  it("agrees with shopDayWindow — the preset and the filter share one clock", () => {
    at("2026-09-14T21:02:00.000Z");
    const { from, to } = getDateRangeForPreset("today");
    const w = shopDayWindow(from, to)!;
    const sale = new Date("2026-09-14T21:02:27.506Z");
    expect(sale >= w.gte! && sale <= w.lte!).toBe(true);
  });
});

describe("shopStartOfToday", () => {
  it("is the shop's midnight", () => {
    at("2026-09-14T21:02:00.000Z");
    expect(shopStartOfToday().toISOString()).toBe("2026-09-14T19:00:00.000Z");
  });

  it("is already past when the early-morning sale happens", () => {
    // The Dashboard's "Today's Sales" tile counts from here.
    at("2026-09-14T21:02:00.000Z");
    expect(new Date("2026-09-14T21:02:27.506Z") >= shopStartOfToday()).toBe(true);
  });
});

describe("day keys and display — an early-morning sale belongs to the shop's day", () => {
  // 02:00 on 1 Oct in Pakistan is still 30 Sep in UTC.
  const earlySale = new Date("2026-09-30T21:00:00Z");

  it("files it under the shop day and month, not the UTC ones", () => {
    expect(shopDateKey(earlySale)).toBe("2026-10-01");
    expect(shopMonthKey(earlySale)).toBe("2026-10");
  });

  it("prints its shop date and time", () => {
    expect(formatDate(earlySale)).toBe("01/10/2026");
    expect(formatTime(earlySale)).toBe("02:00:00");
  });

  it("still prints a plain YYYY-MM-DD as that same day", () => {
    expect(formatDate(new Date("2026-09-15"))).toBe("15/09/2026");
    expect(formatDate("2026-09-15")).toBe("15/09/2026");
  });

  it("names the shop's today and month start before 05:00", () => {
    at("2026-09-30T21:00:00Z");
    expect(shopToday()).toBe("2026-10-01");
    // Was 2026-09-30: local midnight on the 1st, printed in UTC.
    expect(shopMonthStart()).toBe("2026-10-01");
  });

  it("dates an installment plan from the shop day the sale fell on", () => {
    // Monthly from 02:00 on 31 Jan (shop) — still 30 Jan in UTC — is 28 Feb.
    const rows = generateInstallmentSchedule({
      principal: 100, kind: "MONTHLY", periods: 1, startDate: new Date("2026-01-30T21:00:00Z"),
    });
    expect(shopDateKey(rows[0].dueDate)).toBe("2026-02-28");
  });
});
