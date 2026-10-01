import { prisma } from "@/lib/prisma";
import { buildGrnAccountEntryOps, validateGrnPayment } from "@/lib/accounts";
import { buildPlanOps, validateRepaymentPlan } from "@/lib/repayment-plan";
import { computePurchaseLedgerSplit, shopDayWindow } from "@/lib/utils";
import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requirePermission } from "@/lib/authz";
import { getUnitConfig } from "@/lib/unit-settings";
import {
  UnitConversionError,
  resolveGrnLine,
  restatedStock,
  type GrnLineInput,
  type ResolvedGrnLine,
} from "@/lib/units";

/**
 * GET /api/purchases?branchId=&partyId=&from=&to=&limit=
 *
 * The GRN picker list down the left of the Purchases screen. `from`/`to` back
 * its date-range dropdown; both are inclusive whole days, matching the report
 * routes (`to` is pushed to 23:59:59.999 so a same-day range isn't empty).
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const branchId = searchParams.get("branchId");
  const partyId = searchParams.get("partyId");
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const limit = Number(searchParams.get("limit") ?? "80");

  const where: any = {};
  if (branchId) where.branchId = branchId;
  if (partyId) where.partyId = partyId;
  // Inclusive whole days as the shop counts them — see `shopDayWindow`.
  const dateWindow = shopDayWindow(from, to);
  if (dateWindow) where.date = dateWindow;

  const grns = await prisma.gRN.findMany({
    where,
    include: {
      party: { select: { name: true, accountId: true } },
      items: {
        include: { item: { select: { name: true, unit: true, purchaseUnit: true, piecesPerBundle: true, barcode: true, systemBarcode: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json({ grns });
}

export async function POST(req: NextRequest) {
  const gate = await requirePermission("CREATE_GRN");
  if (!gate.ok) return gate.response;

  const body = await req.json();

  const {
    branchId, userId, partyId, billNo, remarks, date,
    lines,
    saleAmount, billAmount, returnAmount, discountPct,
    adjustment, netBill,
    totalPurchaseQty, totalReturnQty,
    paymentMethod, cashAmount, bankAmount, bankAccountId,
    repaymentType, installmentPeriods, promiseDays,
    isReturn,
  } = body;

  const payment = validateGrnPayment({
    paymentMethod, cashAmount, bankAmount, bankAccountId, netBill: netBill ?? 0,
  });
  if (!payment.ok) {
    return NextResponse.json({ error: payment.error }, { status: 400 });
  }

  const planCheck = validateRepaymentPlan({ repaymentType, installmentPeriods, promiseDays });
  if (!planCheck.ok) {
    return NextResponse.json({ error: planCheck.error }, { status: 400 });
  }

  const paidNow = payment.cashAmount + payment.bankAmount;

  // ── Unit conversion ────────────────────────────────────────────────────────
  // Goods can arrive in one unit and be sold in another (24 gaz in, sold by the
  // metre; 5 bundles in, sold by the piece). This is the one place in the
  // application that conversion happens: stock lands in the SELL unit and the
  // item's purchase price is restated per that unit at the same moment, so
  // every downstream reader — sales, ledger, valuation, the dashboard's profit
  // figure — sees a quantity and a price that are already in step and needs to
  // know nothing about any of it. See lib/units.ts.
  // `GrnLineInput` is the unit half; the rest is the money the vendor billed,
  // which lib/units.ts has no business knowing about.
  type GrnPayloadLine = GrnLineInput & { disPct?: number; amount?: number };
  const grnLines: GrnPayloadLine[] = Array.isArray(lines) ? lines : [];
  const lineItems = await prisma.item.findMany({
    where: { id: { in: grnLines.map((l) => l.itemId).filter(Boolean) } },
    select: { id: true, unit: true, purchaseUnit: true, piecesPerBundle: true },
  });
  const itemById = new Map(lineItems.map((i) => [i.id, i]));
  const unitCfg = await getUnitConfig();

  let resolvedLines: ResolvedGrnLine[];
  try {
    resolvedLines = grnLines.map((l) => {
      const item = itemById.get(l.itemId);
      if (!item) throw new UnitConversionError(`Unknown item on a GRN line`);
      return resolveGrnLine(l, item, unitCfg);
    });
  } catch (e) {
    // A line that cannot be converted (cloth into pieces, a bundle with no
    // size) must not be half-written — refuse the whole receipt.
    if (e instanceof UnitConversionError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }

  // Get next GRN number
  const last = await prisma.gRN.findFirst({
    where: { branchId },
    orderBy: { grnNo: "desc" },
    select: { grnNo: true },
  });
  const grnNo = (last?.grnNo ?? 0) + 1;

  const grnId = randomUUID();

  // Sequential-array $transaction — see note in app/api/sales/route.ts for why
  // the interactive callback form isn't used (breaks against Supabase's pooler).
  const ops: any[] = [
    prisma.gRN.create({
      data: {
        id: grnId,
        grnNo,
        branchId,
        partyId,
        userId,
        date: date ? new Date(date) : new Date(),
        billNo: billNo || null,
        remarks: remarks || null,
        saleAmount: saleAmount ?? 0,
        billAmount: billAmount ?? netBill ?? 0,
        returnAmount: returnAmount ?? 0,
        discountPct: discountPct ?? 0,
        adjustment: adjustment ?? 0,
        netBill: netBill ?? 0,
        totalPurchaseQty: totalPurchaseQty ?? 0,
        totalReturnQty: totalReturnQty ?? 0,
        paymentMethod: payment.paymentMethod,
        cashAmount: payment.cashAmount,
        bankAmount: payment.bankAmount,
        bankAccountId: payment.bankAccountId,
        promiseDays: promiseDays || null,
        repaymentType: planCheck.repaymentType,
        installmentPeriods: planCheck.periods,
        isReturn: !!isReturn,
        // See the matching note in app/api/sales/route.ts — this write is
        // already durably saved in the real database, so it's synced now.
        syncStatus: "SYNCED",
        items: {
          create: grnLines.map((l, i) => ({
            itemId: l.itemId,
            type: l.isReturn ? "RETURN" : "PURCHASE",
            // qty/costRate/amount stay as the vendor billed them, in buyUnit —
            // the GRN has to reconcile against the bill in the vendor's own
            // terms. stockQty is the converted figure that moved stock.
            qty: resolvedLines[i].qty,
            buyUnit: resolvedLines[i].buyUnit,
            stockQty: resolvedLines[i].stockQty,
            costRate: resolvedLines[i].costRate,
            saleRate: resolvedLines[i].saleRate,
            disPct: l.disPct ?? 0,
            amount: l.amount ?? 0,
          })),
        },
      },
    }),
  ];

  // Re-denominating stock, before anything is added to it.
  //
  // A line whose sell unit differs from the item's current one changes what
  // `ItemStock.qty` *means*, so the quantity already on the shelf has to move
  // with it: an item sitting on 21.6 MTR that starts being sold by the gaz
  // holds 24 GAZ, not 24 MTR. Without this the figure is silently wrong from
  // the moment the unit changes.
  //
  // `multiply` rather than read-modify-write so it stays atomic, and
  // `updateMany` across every branch because `Item.unit` is global — leaving
  // another branch's rows in the old unit would be the same bug one step away.
  // Done once per item (a GRN may carry several lines for one item) and before
  // the increments below, which are already in the new unit.
  const flipped = new Set<string>();
  for (const line of resolvedLines) {
    const item = itemById.get(line.itemId);
    if (!item || flipped.has(line.itemId)) continue;
    if (line.sellUnit === item.unit) continue;
    flipped.add(line.itemId);

    const factor = restatedStock(1, item.unit, line.sellUnit, {
      ...unitCfg,
      piecesPerBundle: line.piecesPerBundle,
    });
    if (factor !== null) {
      ops.push(prisma.itemStock.updateMany({
        where: { itemId: line.itemId },
        data: { qty: { multiply: factor } },
      }));
    }
  }

  // Update stock levels + item prices
  for (const line of resolvedLines) {
    const isPurchase = !line.isReturn;
    const delta = isPurchase ? line.stockQty : -line.stockQty;

    ops.push(prisma.itemStock.upsert({
      where: { itemId_branchId: { itemId: line.itemId, branchId } },
      update: { qty: { increment: delta } },
      create: { itemId: line.itemId, branchId, qty: Math.max(0, delta) },
    }));

    // Latest-GRN pricing, all of it per the SELL unit. `costPerSellUnit` is the
    // conversion that matters most: writing the raw per-gaz cost against
    // per-metre stock understates cost of goods by 10% on every subsequent
    // sale, straight into the dashboard's profit figure.
    ops.push(prisma.item.update({
      where: { id: line.itemId },
      data: {
        unit: line.sellUnit,
        purchaseUnit: line.buyUnit,
        ...(line.piecesPerBundle ? { piecesPerBundle: line.piecesPerBundle } : {}),
        ...(isPurchase && line.costRate > 0
          ? { purchasePrice: line.costPerSellUnit }
          : {}),
        ...(isPurchase && line.saleRate > 0 ? { salePrice: line.saleRate } : {}),
      },
    }));
  }

  // Vendor ledger entry. The old `> 0` test meant a net-return GRN (more
  // returned than received) wrote no entry at all and the payable silently
  // never moved; `!== 0` plus computePurchaseLedgerSplit now books that as
  // PURCHASE_RETURN. The `paidNow > 0` arm covers the odd case of a zero-value
  // GRN that still moved money.
  if ((netBill ?? 0) !== 0 || paidNow > 0) {
    ops.push(prisma.ledgerEntry.create({
      data: {
        branchId,
        partyId,
        ...computePurchaseLedgerSplit(netBill ?? 0, paidNow),
        reference: `GRN-${grnNo}`,
        grnId,
        notes: `${isReturn ? "Purchase Return" : "Purchase"} GRN #${grnNo}${billNo ? ` - Bill: ${billNo}` : ""}`,
      },
    }));
  }

  ops.push(...await buildGrnAccountEntryOps({
    branchId, grnId, grnNo, partyId, netBill: netBill ?? 0,
    cashAmount: payment.cashAmount, bankAmount: payment.bankAmount,
    bankAccountId: payment.bankAccountId,
  }));

  // Vendor-side installment plan over whatever is left on credit after the
  // payment at receipt time. Same generator and same collect endpoint as the
  // customer side (see lib/repayment-plan.ts).
  ops.push(...buildPlanOps({
    branchId, partyId, grnId,
    repaymentType: planCheck.repaymentType,
    periods: planCheck.periods,
    promiseDays,
    netBill: netBill ?? 0,
    paidNow,
  }));

  const [grn] = await prisma.$transaction(ops);

  return NextResponse.json({ grnNo: grn.grnNo, id: grn.id }, { status: 201 });
}
