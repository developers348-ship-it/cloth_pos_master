import { prisma } from "@/lib/prisma";
import { isOverdue } from "@/lib/installments";
import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/ledger/installments?branchId=&status=open|overdue|all&partyId=&side=sales|purchase|all
 *
 * Flat list of installments across every plan in a branch, newest due first,
 * for the Ledger page's Installments tab. `status=open` (the default) means
 * anything still owing (PENDING or PARTIAL); `overdue` narrows that to rows
 * whose due date has already passed.
 *
 * `side` distinguishes customer plans (attached to a SaleInvoice, collected as
 * a Recovery) from vendor plans (attached to a GRN, settled as a Payment).
 * Vendor plans only start being generated in Phase 6, but the filter is here
 * so the same endpoint serves both.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const branchId = searchParams.get("branchId");
  const status = searchParams.get("status") ?? "open";
  const partyId = searchParams.get("partyId");
  const side = searchParams.get("side") ?? "all";

  if (!branchId) {
    return NextResponse.json({ error: "branchId is required" }, { status: 400 });
  }

  const planWhere: any = { branchId };
  if (partyId) planWhere.partyId = partyId;
  if (side === "sales") planWhere.invoiceId = { not: null };
  else if (side === "purchase") planWhere.grnId = { not: null };

  const where: any = { plan: planWhere };
  if (status !== "all") where.status = { in: ["PENDING", "PARTIAL"] };

  const installments = await prisma.installment.findMany({
    where,
    include: {
      plan: {
        include: {
          party: { select: { id: true, name: true, accountId: true, type: true } },
          invoice: { select: { invoiceNo: true } },
          grn: { select: { grnNo: true } },
        },
      },
    },
    orderBy: [{ dueDate: "asc" }, { seq: "asc" }],
    take: 500,
  });

  const rows = installments.map((i) => {
    const amount = Number(i.amount);
    const paidAmount = Number(i.paidAmount);
    return {
      id: i.id,
      seq: i.seq,
      dueDate: i.dueDate,
      amount,
      paidAmount,
      remaining: Math.round((amount - paidAmount) * 100) / 100,
      status: i.status,
      paidAt: i.paidAt,
      isOverdue: isOverdue(i.dueDate, i.status),
      plan: {
        id: i.plan.id,
        kind: i.plan.kind,
        periods: i.plan.periods,
        principal: Number(i.plan.principal),
        startDate: i.plan.startDate,
        // Which side of the business this plan belongs to, and so whether
        // collecting on it books a Recovery or a Payment.
        side: i.plan.invoiceId ? "sales" : "purchase",
        // Both the id and the number: the number is the label the tab prints,
        // the id is what its link to the document's detail page is built from.
        invoiceId: i.plan.invoiceId,
        grnId: i.plan.grnId,
        invoiceNo: i.plan.invoice?.invoiceNo ?? null,
        grnNo: i.plan.grn?.grnNo ?? null,
      },
      party: {
        id: i.plan.party.id,
        name: i.plan.party.name,
        accountId: i.plan.party.accountId,
        type: i.plan.party.type,
      },
    };
  });

  const filtered = status === "overdue" ? rows.filter((r) => r.isOverdue) : rows;

  return NextResponse.json({
    installments: filtered,
    summary: {
      count: filtered.length,
      totalRemaining: Math.round(filtered.reduce((s, r) => s + r.remaining, 0) * 100) / 100,
      overdueCount: filtered.filter((r) => r.isOverdue).length,
      overdueRemaining:
        Math.round(filtered.filter((r) => r.isOverdue).reduce((s, r) => s + r.remaining, 0) * 100) / 100,
    },
  });
}
