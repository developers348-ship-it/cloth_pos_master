import { prisma } from "@/lib/prisma";
import { shopDayWindow } from "@/lib/utils";
import { grnOutstanding, grnPaymentStatus, grnSettledAmount } from "@/lib/grn-settlement";
import { summarizePlan } from "@/lib/installments";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/reports/purchases?branchId=&from=&to=&partyId=&paymentStatus=
 *
 * Every GRN in the range with its vendor, its line items and its money side —
 * what the **GRN Records** list renders (Purchases → GRN Records, and
 * Reports → Purchases, which mount the same component).
 *
 * `paymentStatus` (PAID|PARTIAL|UNPAID) filters on the *computed* status from
 * lib/grn-settlement.ts, so it can only be applied after the rows are built —
 * exactly as GET /api/reports/sales does it.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const branchId = searchParams.get("branchId");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const partyId = searchParams.get("partyId");
  const paymentStatus = searchParams.get("paymentStatus");

  if (!branchId) {
    return NextResponse.json({ error: "branchId is required" }, { status: 400 });
  }

  const where: any = { branchId };
  if (partyId) where.partyId = partyId;
  // Inclusive whole days as the shop counts them — see `shopDayWindow`.
  const dateWindow = shopDayWindow(from, to);
  if (dateWindow) where.date = dateWindow;

  const grns = await prisma.gRN.findMany({
    where,
    include: {
      party: { select: { id: true, name: true, accountId: true } },
      user: { select: { name: true } },
      bankAccount: { select: { name: true } },
      items: {
        select: {
          qty: true, type: true, costRate: true, amount: true,
          item: { select: { name: true, unit: true } },
        },
      },
      // What has been paid to the vendor against this bill since it was
      // received. `paidAmount` on the plan's installments is the only per-GRN
      // attribution there is — see the note in lib/grn-settlement.ts.
      // The plan's own fields too, so the row can show the repayment kind and
      // next due date rather than only a "has a plan" flag.
      installmentPlan: {
        select: {
          id: true, kind: true, periods: true,
          installments: { select: { seq: true, dueDate: true, amount: true, paidAmount: true, status: true } },
        },
      },
      // Ledger-page payments booked against this specific bill. Before
      // `Payment.grnId` existed these were invisible here, so a GRN paid off
      // from the Ledger page still showed its full amount outstanding.
      payments: { select: { amount: true } },
    },
    orderBy: { date: "desc" },
    take: 1000,
  });

  const rows = grns.map((g) => {
    const netBill = Number(g.netBill);
    const cashPaid = Number(g.cashAmount);
    const bankPaid = Number(g.bankAmount);
    const collected = (g.installmentPlan?.installments ?? [])
      .reduce((s, i) => s + Number(i.paidAmount), 0);
    const paid = g.payments.reduce((s, p) => s + Number(p.amount), 0);
    const settlement = { netBill, cashPaid, bankPaid, collected, paid };

    return {
      id: g.id,
      grnNo: g.grnNo,
      date: g.date,
      vendorId: g.party.id,
      vendorName: g.party.name,
      accountId: g.party.accountId,
      billNo: g.billNo ?? "",
      remarks: g.remarks ?? "",
      receivedBy: g.user?.name ?? "",

      itemCount: g.items.length,
      purchaseItemCount: g.items.filter((i) => i.type === "PURCHASE").length,
      returnItemCount: g.items.filter((i) => i.type === "RETURN").length,
      // The expander's line list. Kept to the five figures it shows — a GRN
      // document that needs the per-line discount is a lookup by id.
      items: g.items.map((i) => ({
        name: i.item.name,
        unit: i.item.unit,
        qty: Number(i.qty),
        rate: Number(i.costRate),
        amount: Number(i.amount),
        isReturn: i.type === "RETURN",
      })),

      saleAmount: Number(g.saleAmount),
      billAmount: Number(g.billAmount),
      returnAmount: Number(g.returnAmount),
      discountPct: Number(g.discountPct),
      adjustment: Number(g.adjustment),
      netBill,
      totalPurchaseQty: Number(g.totalPurchaseQty),
      totalReturnQty: Number(g.totalReturnQty),

      paymentMethod: g.paymentMethod,
      cashPaid,
      bankPaid,
      bankAccountName: g.bankAccount?.name ?? null,
      collected,
      /** Paid against this bill from the Ledger page's Payment tab. */
      paid,
      settled: grnSettledAmount(settlement),
      outstanding: grnOutstanding(settlement),
      paymentStatus: grnPaymentStatus(settlement),
      hasPlan: g.installmentPlan !== null,
      /** Kind, next due date and remaining, or null when there is no plan. */
      plan: g.installmentPlan
        ? summarizePlan({
            kind: g.installmentPlan.kind,
            periods: g.installmentPlan.periods,
            installments: g.installmentPlan.installments.map((i) => ({
              seq: i.seq, dueDate: i.dueDate,
              amount: Number(i.amount), paidAmount: Number(i.paidAmount),
              status: i.status,
            })),
          })
        : null,
    };
  });

  const filtered = paymentStatus
    ? rows.filter((r) => r.paymentStatus === paymentStatus)
    : rows;

  const totals = {
    grnCount: filtered.length,
    saleAmount: filtered.reduce((s, r) => s + r.saleAmount, 0),
    returnAmount: filtered.reduce((s, r) => s + r.returnAmount, 0),
    netBill: filtered.reduce((s, r) => s + r.netBill, 0),
    // Signed by `netBill` for the same reason the sales report signs its cash
    // total: on a net-return GRN `cashAmount`/`bankAmount` are money coming
    // back *from* the vendor, so summing them raw would report a refund as a
    // payment made.
    paid: filtered.reduce((s, r) => s + (r.netBill < 0 ? -r.settled : r.settled), 0),
    outstanding: filtered.reduce((s, r) => s + r.outstanding, 0),
    totalPurchaseQty: filtered.reduce((s, r) => s + r.totalPurchaseQty, 0),
    totalReturnQty: filtered.reduce((s, r) => s + r.totalReturnQty, 0),
  };

  return NextResponse.json({ grns: filtered, totals });
}
