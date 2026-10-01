"use client";

import { useEffect, useState } from "react";

/**
 * One invoice in full, as `GET /api/sales/:id` returns it.
 *
 * Shared by the invoice detail page, the A4/A5 document and the 80mm receipt so
 * the three can't drift on what a field means — in particular that
 * `cashReceived`/`bankAmount` on a net-return invoice are money paid *out*, and
 * that the party balances are as at this invoice rather than as of today.
 */

export type InvoiceDetailItem = {
  id: string;
  name: string; unit: string; barcode: string | null;
  isReturn: boolean;
  qty: number; pcs: number; gaz: number; mtr: number;
  rate: number; disRS: number; disPct: number; amount: number;
};

export type InvoiceDetailRecovery = {
  id: string; date: string; amount: number; paymentMethod: string;
  accountName: string | null; notes: string | null; isMarkPaid: boolean;
};

export type InvoiceDetail = {
  id: string;
  invoiceNo: number; date: string; status: "SAVED" | "HELD" | "VOIDED";
  partyOption: string; paymentMethod: string; printUrdu: boolean;
  notes: string | null; cashier: string | null; bankAccountName: string | null;
  party: {
    id: string; accountId: number; name: string; type: string;
    phone: string | null; mobile: string | null;
    address: string | null; city: string | null;
    creditLimit: number;
    /** As at this invoice, not as of today — see the route's replay comment. */
    balanceBefore: number; balanceAfter: number;
  };
  items: InvoiceDetailItem[];
  totals: {
    grossSale: number; packageDiscount: number; saleAmount: number;
    returnAmount: number; adjustment: number; adjustType: string;
    slipAmount: number; courierCharges: number; netBill: number;
    soldPcs: number; soldGaz: number; soldMtr: number;
    returnPcs: number; returnGaz: number; returnMtr: number;
  };
  payment: {
    cashReceived: number; cardAmount: number; bankAmount: number;
    creditApplied: number; change: number; recovered: number;
    settled: number; outstanding: number; refundable: number;
    status: "PAID" | "PARTIAL" | "UNPAID";
  };
  recoveries: InvoiceDetailRecovery[];
  plan: {
    id: string; kind: string; principal: number; periods: number; startDate: string;
    installments: {
      seq: number; dueDate: string; amount: number;
      paidAmount: number; status: "PENDING" | "PARTIAL" | "PAID"; paidAt: string | null;
    }[];
  } | null;
  repaymentType: string;
  installmentPeriods: number | null;
  refundOf: { id: string; invoiceNo: number } | null;
  refundedBy: { id: string; invoiceNo: number } | null;
};

/**
 * Fetches one invoice. `fallbackError` is what to report when the request
 * itself fails — the caller owns the translated string, so this stays free of
 * the i18n context and can be used from anywhere.
 */
export function useInvoiceDetail(invoiceId: string, fallbackError: string) {
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  // No state reset on `invoiceId` change: every caller mounts a fresh instance
  // per invoice (the detail page is its own route, and the report's receipt
  // trigger is unmounted between prints), so there is never stale data to
  // clear. `cancelled` is what keeps a slow response from overwriting a newer
  // one if that ever stops being true.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/sales/${invoiceId}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) setError(data.error || fallbackError);
        else setDetail(data.invoice);
      } catch {
        if (!cancelled) setError(fallbackError);
      }
    })();
    return () => { cancelled = true; };
  }, [invoiceId, fallbackError]);

  return { detail, error };
}

/**
 * Rupees taken off one line by its own discount. Read back from the stored
 * `amount` rather than re-derived from `disRS`/`disPct`, so it is whatever the
 * invoice actually charged — a percentage discount is shown in rupees too.
 */
export function lineDiscount(li: Pick<InvoiceDetailItem, "qty" | "rate" | "amount">): number {
  const d = li.rate * li.qty - li.amount;
  return d > 0.005 ? d : 0;
}

/**
 * The discount breakdown every printout shows. `grossSale` is stored *after*
 * line discounts, so without this the per-item discount vanished from the
 * totals entirely: `subtotal` is the sold lines at full rate, `itemDiscount`
 * what their own discounts took off, and `totalDiscount` adds the package
 * (whole-bill) discount on top.
 */
export function invoiceDiscounts(detail: Pick<InvoiceDetail, "items" | "totals">) {
  const itemDiscount = detail.items
    .filter((li) => !li.isReturn)
    .reduce((s, li) => s + lineDiscount(li), 0);
  return {
    subtotal: detail.totals.grossSale + itemDiscount,
    itemDiscount,
    packageDiscount: detail.totals.packageDiscount,
    totalDiscount: itemDiscount + detail.totals.packageDiscount,
  };
}
