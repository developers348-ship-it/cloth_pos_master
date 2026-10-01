"use client";

import { useEffect, useState } from "react";
import type { PaymentStatus } from "@/lib/grn-settlement";

/**
 * One GRN in full, as `GET /api/purchases/:id` returns it.
 *
 * Shared by the GRN detail page and the printed A4/A5 document so the two can't
 * drift on what a field means — in particular that `cashPaid`/`bankPaid` on a
 * net-return GRN are money coming back *from* the vendor, and that the vendor
 * balances are as at this GRN rather than as of today.
 *
 * The route also spreads the GRN's raw columns at the top level for the GRN
 * form's own loader; only the blocks below are typed, because those columns
 * arrive as Prisma `Decimal` strings and the numeric blocks are the converted
 * ones a document should read.
 */

export type GRNDetailLine = {
  id: string;
  itemId: string;
  name: string; unit: string; barcode: string | null;
  isReturn: boolean;
  qty: number; costRate: number; saleRate: number; disPct: number; amount: number;
};

/** A payment made to the vendor against this GRN's repayment plan. */
export type GRNDetailPayment = {
  id: string; date: string; amount: number; paymentMethod: string;
  accountName: string | null; notes: string | null;
};

export type GRNDetail = {
  id: string;
  grnNo: number;
  date: string;
  billNo: string | null;
  remarks: string | null;
  receivedBy: string | null;
  bankAccountName: string | null;
  paymentMethod: string;
  repaymentType: string;
  installmentPeriods: number | null;
  promiseDays: number | null;
  vendor: {
    id: string; accountId: number; name: string; type: string;
    phone: string | null; mobile: string | null;
    address: string | null; city: string | null;
    /** As at this GRN, not as of today — see the route's replay comment. */
    balanceBefore: number; balanceAfter: number;
  };
  lines: GRNDetailLine[];
  totals: {
    saleAmount: number; billAmount: number; returnAmount: number;
    discountPct: number; adjustment: number; netBill: number;
    totalPurchaseQty: number; totalReturnQty: number;
  };
  payment: {
    method: string;
    cashPaid: number; bankPaid: number; collected: number;
    settled: number; outstanding: number;
    status: PaymentStatus;
  };
  payments: GRNDetailPayment[];
  plan: {
    id: string; kind: string; principal: number; periods: number; startDate: string;
    installments: {
      seq: number; dueDate: string; amount: number;
      paidAmount: number; status: "PENDING" | "PARTIAL" | "PAID"; paidAt: string | null;
    }[];
  } | null;
};

/**
 * Fetches one GRN. `fallbackError` is what to report when the request itself
 * fails — the caller owns the translated string, so this stays free of the i18n
 * context and can be used from anywhere. Mirrors `useInvoiceDetail`.
 */
export function useGrnDetail(grnId: string, fallbackError: string) {
  const [detail, setDetail] = useState<GRNDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/purchases/${grnId}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) setError(data.error || fallbackError);
        else setDetail(data.grn);
      } catch {
        if (!cancelled) setError(fallbackError);
      }
    })();
    return () => { cancelled = true; };
  }, [grnId, fallbackError]);

  return { detail, error };
}
