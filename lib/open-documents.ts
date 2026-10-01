import { prisma } from "@/lib/prisma";
import { grnOutstanding, grnSettledAmount } from "@/lib/grn-settlement";
import { invoiceOutstanding, invoiceSettledAmount } from "@/lib/invoice-settlement";
import type { OpenDocument } from "@/lib/settlement-allocation";

/**
 * A party's still-unsettled bills, with live outstanding figures.
 *
 * Shared by GET /api/ledger/open-documents (the list the Recovery/Payment form
 * shows) and by the POST handlers that validate an allocation against it — the
 * cap on how much may be collected has to be re-read from the database, so a
 * stale screen can't authorise collecting more than a party owes, and it has
 * to be the *same* figure the cashier was shown.
 *
 * Outstanding comes from the pure settlement functions the reports use
 * (`invoiceOutstanding` / `grnOutstanding`), so this and the payment-status
 * badges in Reports cannot disagree.
 */

/** Sub-paisa balances are noise, not debt. */
const EPSILON = 0.005;

/**
 * A customer's unsettled invoices, oldest first. Only `SAVED` rows count —
 * VOIDED ones owe nothing and HELD ones are parked drafts that were never rung
 * up. Matches `recordStatus=ACTIVE` in GET /api/reports/sales.
 */
export async function getOpenInvoices(branchId: string, partyId: string): Promise<OpenDocument[]> {
  const invoices = await prisma.saleInvoice.findMany({
    where: { branchId, partyId, status: "SAVED" },
    select: {
      id: true, invoiceNo: true, date: true, netBill: true,
      creditApplied: true, cashReceived: true, cardAmount: true, bankAmount: true,
    },
    orderBy: { date: "asc" },
    take: 500,
  });
  if (invoices.length === 0) return [];

  // Everything collected against these invoices since the sale — Mark Paid and
  // installment collections both carry the invoice's id. One query for the
  // whole list rather than a lookup per row.
  const recoveries = await prisma.recovery.findMany({
    where: { invoiceId: { in: invoices.map((i) => i.id) } },
    select: { invoiceId: true, amount: true },
  });
  const recoveredByInvoice = new Map<string, number>();
  for (const rec of recoveries) {
    if (!rec.invoiceId) continue;
    recoveredByInvoice.set(
      rec.invoiceId,
      (recoveredByInvoice.get(rec.invoiceId) ?? 0) + Number(rec.amount)
    );
  }

  return invoices
    .map((inv) => {
      const settlement = {
        netBill: Number(inv.netBill),
        creditApplied: Number(inv.creditApplied),
        cashReceived: Number(inv.cashReceived),
        cardAmount: Number(inv.cardAmount),
        bankAmount: Number(inv.bankAmount),
        recovered: recoveredByInvoice.get(inv.id) ?? 0,
      };
      return {
        id: inv.id,
        no: inv.invoiceNo,
        date: inv.date,
        netBill: settlement.netBill,
        settled: invoiceSettledAmount(settlement),
        outstanding: invoiceOutstanding(settlement),
      };
    })
    .filter((d) => d.outstanding > EPSILON);
}

/** A vendor's unsettled GRNs, oldest first. */
export async function getOpenGrns(branchId: string, partyId: string): Promise<OpenDocument[]> {
  const grns = await prisma.gRN.findMany({
    where: { branchId, partyId },
    select: {
      id: true, grnNo: true, date: true, netBill: true,
      cashAmount: true, bankAmount: true,
      installmentPlan: { select: { installments: { select: { paidAmount: true } } } },
      // Ledger-page payments booked against this specific bill.
      payments: { select: { amount: true } },
    },
    orderBy: { date: "asc" },
    take: 500,
  });

  return grns
    .map((g) => {
      const settlement = {
        netBill: Number(g.netBill),
        cashPaid: Number(g.cashAmount),
        bankPaid: Number(g.bankAmount),
        collected: (g.installmentPlan?.installments ?? [])
          .reduce((s, i) => s + Number(i.paidAmount), 0),
        paid: g.payments.reduce((s, p) => s + Number(p.amount), 0),
      };
      return {
        id: g.id,
        no: g.grnNo,
        date: g.date,
        netBill: settlement.netBill,
        settled: grnSettledAmount(settlement),
        outstanding: grnOutstanding(settlement),
      };
    })
    .filter((d) => d.outstanding > EPSILON);
}
