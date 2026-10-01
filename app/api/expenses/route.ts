import { prisma } from "@/lib/prisma";
import { shopDayWindow } from "@/lib/utils";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authz";
import {
  buildExpenseAccountEntryOps,
  getExpenseTotals,
  resolveExpensePayment,
} from "@/lib/expenses";

/**
 * Cost management: operating expenses, salaries, owner drawings.
 *
 * Money out of the shop's own pocket, as opposed to money out to a vendor
 * (which is a `Payment` against a party ledger — see `/api/ledger/payment`).
 * Nothing here touches a party balance: an expense has no counterparty inside
 * the books, only a category and, when paid, an account.
 */

const KINDS = ["EXPENSE", "PROFIT_WITHDRAWAL", "CAPITAL_INJECTION"] as const;

/**
 * GET /api/expenses?branchId=&from=&to=&kind=&categoryId=&status=&accountId=&q=
 *
 * The list behind the Cost Management page, plus the same range's totals so the
 * summary tiles don't need a second request.
 *
 * Gated on `VIEW_EXPENSES` — the deliberate exception to this app's read-open
 * stance on list endpoints (see the header comment in lib/authz.ts). Staff
 * salaries and owner drawings are exactly the figures a shop wants off the
 * shared counter terminal.
 */
export async function GET(req: NextRequest) {
  const gate = await requirePermission("VIEW_EXPENSES");
  if (!gate.ok) return gate.response;

  const { searchParams } = new URL(req.url);
  const branchId = searchParams.get("branchId");
  if (!branchId) {
    return NextResponse.json({ error: "branchId is required" }, { status: 400 });
  }

  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const kind = searchParams.get("kind");
  const categoryId = searchParams.get("categoryId");
  const status = searchParams.get("status");
  const accountId = searchParams.get("accountId");
  const q = searchParams.get("q")?.trim();
  // `all=true` is for the CSV export button: it needs every row matching the
  // filter, not just the page on screen, and that's a deliberate one-off click
  // rather than the default list load — unlike the ordinary GET, paying for an
  // unbounded fetch there is expected.
  const all = searchParams.get("all") === "true";
  const pageSize = Math.min(200, Math.max(1, Number(searchParams.get("pageSize") ?? "50")));
  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));

  // Inclusive whole days as the shop counts them — see `shopDayWindow`.
  const dateWindow = shopDayWindow(from, to);

  const where: Record<string, unknown> = { branchId };
  if (dateWindow) where.date = dateWindow;
  if (kind && (KINDS as readonly string[]).includes(kind)) where.kind = kind;
  if (categoryId) where.categoryId = categoryId;
  if (status === "PAID" || status === "UNPAID") where.status = status;
  if (accountId) where.accountId = accountId;
  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { payeeName: { contains: q, mode: "insensitive" } },
      { reference: { contains: q, mode: "insensitive" } },
      { notes: { contains: q, mode: "insensitive" } },
    ];
  }

  const [expenses, total, filteredAmount, totals] = await Promise.all([
    prisma.expense.findMany({
      where,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      include: {
        category: { select: { id: true, name: true } },
        account: { select: { id: true, name: true, type: true } },
        payeeUser: { select: { id: true, name: true } },
        recordedBy: { select: { id: true, name: true } },
      },
      ...(all ? {} : { skip: (page - 1) * pageSize, take: pageSize }),
    }),
    prisma.expense.count({ where }),
    // Sum of `amount` across every row matching the *full* filter (kind,
    // category, status, search included) — the table foot's "Range Total"
    // reads this instead of summing the page's own rows, which would silently
    // become a per-page figure once the list was paginated.
    prisma.expense.aggregate({ where, _sum: { amount: true } }),
    // Totals come from the same date range but ignore the kind/status/search
    // filters on purpose: the tiles are the period's summary, and a tile that
    // changed when you typed in the search box would stop being one.
    getExpenseTotals(branchId, dateWindow?.gte ?? null, dateWindow?.lte ?? null),
  ]);

  return NextResponse.json({
    expenses: expenses.map((e) => ({
      ...e,
      amount: Number(e.amount),
    })),
    total, page, pageSize,
    filteredAmount: Number(filteredAmount._sum.amount ?? 0),
    totals,
  });
}

/**
 * POST /api/expenses
 * Body: { branchId, kind?, categoryId?, title, amount, date?, status?,
 *         paymentMethod?, accountId?, payeeUserId?, payeeName?, reference?, notes? }
 *
 * Writes the Expense and — when it is `PAID` — the single AccountEntry that
 * takes the money out of cash or the chosen bank account, in one transaction.
 * An `UNPAID` row posts nothing to any account until `POST /api/expenses/[id]/pay`.
 *
 * A drawing or injection needs `WITHDRAW_PROFIT` rather than `CREATE_EXPENSE`:
 * the two are separate keys so a manager can pay the electricity bill without
 * being able to take the owner's earnings out of the till.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const kind = (KINDS as readonly string[]).includes(body.kind) ? body.kind : "EXPENSE";

  const gate = await requirePermission(kind === "EXPENSE" ? "CREATE_EXPENSE" : "WITHDRAW_PROFIT");
  if (!gate.ok) return gate.response;

  const { branchId, title, categoryId, payeeUserId, payeeName, reference, notes } = body;

  if (!branchId || !title?.trim()) {
    return NextResponse.json({ error: "branchId and title are required" }, { status: 400 });
  }

  const amount = Number(body.amount);
  if (!(amount > 0)) {
    return NextResponse.json({ error: "Amount must be greater than 0" }, { status: 400 });
  }

  // A cost has to land under a heading or the reports can't group it. Drawings
  // and injections never do — they aren't a category of running cost.
  if (kind === "EXPENSE" && !categoryId) {
    return NextResponse.json({ error: "Select a category" }, { status: 400 });
  }
  if (categoryId && kind === "EXPENSE") {
    const category = await prisma.expenseCategory.findUnique({ where: { id: categoryId } });
    if (!category || category.branchId !== branchId) {
      return NextResponse.json({ error: "Category not found in this branch" }, { status: 404 });
    }
  }

  const payment = await resolveExpensePayment({
    branchId,
    status: body.status,
    paymentMethod: body.paymentMethod,
    accountId: body.accountId,
  });
  if (!payment.ok) return NextResponse.json({ error: payment.error }, { status: 400 });

  // A linked staff member's name is copied onto the row as well as referenced,
  // so the entry still reads correctly if that user is later deleted.
  const resolvedPayee = await resolvePayee(branchId, payeeUserId, payeeName);
  if ("error" in resolvedPayee) {
    return NextResponse.json({ error: resolvedPayee.error }, { status: 400 });
  }

  const date = body.date ? new Date(body.date) : new Date();
  const id = crypto.randomUUID();

  // `any[]` matches the existing money-moving routes (see app/api/purchases/route.ts):
  // the array holds heterogeneous unresolved Prisma promises, which the
  // sequential-array $transaction overload can't infer from a wider type.
  const ops: any[] = [
    prisma.expense.create({
      data: {
        id,
        branchId,
        date,
        kind: kind as "EXPENSE" | "PROFIT_WITHDRAWAL" | "CAPITAL_INJECTION",
        categoryId: kind === "EXPENSE" ? categoryId : null,
        title: title.trim(),
        amount,
        status: payment.status,
        paymentMethod: payment.paymentMethod,
        accountId: payment.accountId,
        paidAt: payment.status === "PAID" ? date : null,
        payeeUserId: resolvedPayee.payeeUserId,
        payeeName: resolvedPayee.payeeName,
        reference: reference?.trim() || null,
        notes: notes?.trim() || null,
        recordedById: gate.userId || null,
      },
    }),
  ];

  if (payment.status === "PAID") {
    ops.push(
      ...buildExpenseAccountEntryOps({
        branchId,
        expenseId: id,
        accountId: payment.accountId,
        kind,
        amount,
        date,
        reference: reference?.trim() || null,
        notes: notes?.trim() || title.trim(),
      })
    );
  }

  // Sequential-array $transaction — see the note in app/api/sales/route.ts for
  // why the interactive callback form isn't used against Supabase's pooler.
  await prisma.$transaction(ops);

  const expense = await prisma.expense.findUnique({
    where: { id },
    include: {
      category: { select: { id: true, name: true } },
      account: { select: { id: true, name: true, type: true } },
      payeeUser: { select: { id: true, name: true } },
      recordedBy: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json(
    { expense: expense && { ...expense, amount: Number(expense.amount) } },
    { status: 201 }
  );
}

/**
 * The payee can be a staff member with a login, a name typed by hand, or
 * neither (rent isn't paid to a person on the payroll). When a user is picked,
 * their name is snapshotted into `payeeName` too — a deleted user nulls the
 * relation (`ON DELETE SET NULL`) and without the snapshot the row would lose
 * who was actually paid.
 */
async function resolvePayee(
  branchId: string,
  payeeUserId?: string | null,
  payeeName?: string | null
): Promise<{ payeeUserId: string | null; payeeName: string | null } | { error: string }> {
  const typed = payeeName?.trim() || null;
  if (!payeeUserId) return { payeeUserId: null, payeeName: typed };

  const user = await prisma.user.findFirst({
    where: { id: payeeUserId, branches: { some: { branchId } } },
    select: { id: true, name: true },
  });
  if (!user) return { error: "Selected staff member is not in this branch" };

  return { payeeUserId: user.id, payeeName: typed || user.name };
}
