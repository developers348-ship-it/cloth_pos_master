"use client";

import { useCallback, useEffect, useState } from "react";
import type { PlanSummary } from "@/lib/installments";

/**
 * One party in full, as `GET /api/parties/:id/detail` returns it.
 *
 * Shared by the detail page and the tab bodies in `PartyDetailTables.tsx`, so
 * the two can't drift on what a field means — in particular that the `lifetime`
 * block is never narrowed by the date filter while everything under `window`
 * is, and that `balance` keeps the app-wide sign convention (**> 0 the party
 * owes the store, < 0 the store owes the party**).
 */

export type PaymentStatus = "PAID" | "PARTIAL" | "UNPAID";

export type PartyInvoiceRow = {
  id: string;
  invoiceNo: number;
  date: string;
  recordStatus: "SAVED" | "HELD" | "VOIDED";
  cashier: string;
  itemCount: number;
  partyOption: string;
  paymentMethod: string;
  notes: string | null;
  grossSale: number;
  packageDiscount: number;
  returnAmount: number;
  netBill: number;
  settled: number;
  outstanding: number;
  paymentStatus: PaymentStatus;
  plan: PlanSummary | null;
  refundOfInvoiceNo: number | null;
  refundedByInvoiceNo: number | null;
};

export type PartyGrnRow = {
  id: string;
  grnNo: number;
  date: string;
  billNo: string | null;
  remarks: string | null;
  receivedBy: string;
  itemCount: number;
  paymentMethod: string;
  billAmount: number;
  returnAmount: number;
  netBill: number;
  settled: number;
  outstanding: number;
  paymentStatus: PaymentStatus;
  plan: PlanSummary | null;
};

export type PartyLedgerRow = {
  id: string;
  date: string;
  type: string;
  reference: string | null;
  notes: string | null;
  /** The document behind the line, when there is one — see the route's comment. */
  invoiceId: string | null;
  grnId: string | null;
  debit: number;
  credit: number;
  balance: number;
};

export type PartySettlementRow = {
  id: string;
  /** RECOVERY is money in from the party; PAYMENT is money out to them. */
  kind: "RECOVERY" | "PAYMENT";
  date: string;
  amount: number;
  paymentMethod: string;
  accountName: string | null;
  notes: string | null;
  invoiceId: string | null;
  invoiceNo: number | null;
  grnId: string | null;
  grnNo: number | null;
};

export type PartyPlanRow = {
  id: string;
  kind: string;
  periods: number;
  principal: number;
  startDate: string;
  invoiceId: string | null;
  invoiceNo: number | null;
  grnId: string | null;
  grnNo: number | null;
  installments: {
    id: string;
    seq: number;
    dueDate: string;
    amount: number;
    paidAmount: number;
    status: string;
    paidAt: string | null;
  }[];
  summary: PlanSummary;
};

export type PartyDetail = {
  party: {
    id: string;
    accountId: number;
    name: string;
    address: string | null;
    city: string | null;
    phone: string | null;
    mobile: string | null;
    type: string;
    notes: string | null;
    previousBalance: number;
    creditLimit: number;
    promiseDays: number | null;
    isDefault: boolean;
    isActive: boolean;
    createdAt: string;
  };
  /** Live and lifetime. Null only if the party vanished between the two reads. */
  balance: {
    openingBalance: number;
    totalDebit: number;
    totalCredit: number;
    balance: number;
    availableCredit: number;
    creditEligible: boolean;
  } | null;
  /** The whole relationship — deliberately not narrowed by the date filter. */
  lifetime: {
    invoiceCount: number;
    salesGross: number;
    salesNet: number;
    salesReturns: number;
    salesDiscount: number;
    salesOutstanding: number;
    openInvoiceCount: number;
    grnCount: number;
    purchaseGross: number;
    purchaseNet: number;
    purchaseReturns: number;
    purchaseOutstanding: number;
    openGrnCount: number;
    recoveryCount: number;
    recoveryTotal: number;
    paymentCount: number;
    paymentTotal: number;
    firstActivity: string | null;
    lastActivity: string | null;
  };
  window: { from: string | null; to: string | null };
  invoices: PartyInvoiceRow[];
  grns: PartyGrnRow[];
  ledger: {
    openingBalance: number;
    entries: PartyLedgerRow[];
    totals: { totalDebit: number; totalCredit: number; closingBalance: number };
  };
  settlements: PartySettlementRow[];
  /** Every plan this party has, at any date — a schedule is not a period thing. */
  plans: PartyPlanRow[];
  windowTotals: {
    salesNet: number;
    salesOutstanding: number;
    purchaseNet: number;
    purchaseOutstanding: number;
    received: number;
    paidOut: number;
  };
};

/**
 * Fetches one party's detail for a branch and date window.
 *
 * `fallbackError` is what to report when the request itself fails — the caller
 * owns the translated string, so this stays free of the i18n context.
 *
 * `loading` stays false on the *first* pass until a branch is known: the page
 * reads `branchId` out of the session, which is undefined for a tick after
 * mount, and flashing "not found" in that tick is worse than a blank frame.
 */
export function usePartyDetail(params: {
  partyId: string;
  branchId: string | undefined;
  from: string;
  to: string;
  fallbackError: string;
}) {
  const { partyId, branchId, from, to, fallbackError } = params;
  const [detail, setDetail] = useState<PartyDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({ branchId });
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      const res = await fetch(`/api/parties/${partyId}/detail?${qs}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || fallbackError);
        setDetail(null);
        return;
      }
      setError(null);
      setDetail(data);
    } catch {
      setError(fallbackError);
    } finally {
      setLoading(false);
    }
  }, [partyId, branchId, from, to, fallbackError]);

  // Debounced, so typing into a date field doesn't fire a request per keystroke
  // — the same shape as the account statement's loader.
  useEffect(() => {
    const id = setTimeout(load, 300);
    return () => clearTimeout(id);
  }, [load]);

  return { detail, error, loading, reload: load };
}
