import { prisma } from "@/lib/prisma";

/**
 * Finds the branch's default Cash account, creating it if this is the first
 * time any money-moving route has needed it for this branch. Cash accounts
 * are never user-creatable — only this lazy find-or-create path makes one,
 * mirroring the GRN/invoice-numbering "find latest, else start fresh" idiom
 * already used elsewhere in this app.
 */
export async function getOrCreateCashAccount(branchId: string) {
  const existing = await prisma.account.findFirst({
    where: { branchId, type: "CASH", isDefaultCash: true },
  });
  if (existing) return existing;

  return prisma.account.create({
    data: {
      branchId,
      type: "CASH",
      name: "Cash in Hand",
      isDefaultCash: true,
      openingBalance: 0,
    },
  });
}

/**
 * The branch's single Card Machine account, created on first need exactly like
 * the Cash one. Money taken on the card machine sits here until the processor
 * deposits it, at which point a TRANSFER moves it into a bank account — so this
 * balance answers "how much have we taken on card that hasn't reached the bank
 * yet". Like Cash, it is never user-creatable.
 */
export async function getOrCreateCardAccount(branchId: string) {
  const existing = await prisma.account.findFirst({
    where: { branchId, type: "CARD" },
  });
  if (existing) return existing;

  return prisma.account.create({
    data: { branchId, type: "CARD", name: "Card Machine", openingBalance: 0 },
  });
}

/**
 * Live-computed balance for a single account: opening balance + sum of all
 * AccountEntry debits (money in) minus credits (money out). Deliberately not
 * a maintained running counter — this mirrors how Party balances are already
 * computed in this app (see app/api/ledger/outstanding/route.ts) so there is
 * no new denormalized total that can drift out of sync with the entries.
 */
export async function getAccountBalance(accountId: string): Promise<number> {
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) return 0;

  const agg = await prisma.accountEntry.aggregate({
    where: { accountId },
    _sum: { debit: true, credit: true },
  });

  const debit = Number(agg._sum.debit ?? 0);
  const credit = Number(agg._sum.credit ?? 0);
  return Number(account.openingBalance) + debit - credit;
}

/**
 * Builds the (unresolved) AccountEntry.create() ops for a sale's receipt — one
 * entry per non-zero payment channel. Returns SALE_RECEIPT entries for a normal
 * sale or SALE_REFUND entries (credit instead of debit) when netBill is
 * negative (a net-return invoice), based on the same signed netBill already
 * used to decide the party ledger's debit/credit split.
 *
 * Card payments post to the branch's Card Machine account rather than to cash
 * or a bank: the money is real and earned, but it is with the processor until
 * they deposit it, and pretending it is already in the bank would leave that
 * account permanently ahead of the real statement.
 *
 * Returned ops are meant to be pushed into the caller's `ops` array and run
 * inside the same prisma.$transaction([...]) as the invoice/ledger writes —
 * mirrors the pattern in app/api/sales/route.ts.
 */
export async function buildSaleAccountEntryOps(params: {
  branchId: string;
  invoiceId: string;
  invoiceNo: number;
  partyId: string;
  netBill: number;
  cashReceived: number;
  bankAmount: number;
  bankAccountId?: string | null;
  cardAmount?: number;
}) {
  const { branchId, invoiceId, invoiceNo, partyId, netBill, cashReceived, bankAmount, bankAccountId } = params;
  const cardAmount = params.cardAmount ?? 0;
  const isRefund = netBill < 0;
  const type = isRefund ? "SALE_REFUND" : "SALE_RECEIPT";
  const reference = `INV-${invoiceNo}`;
  const ops = [];

  if (cashReceived > 0) {
    const cash = await getOrCreateCashAccount(branchId);
    ops.push(prisma.accountEntry.create({
      data: {
        branchId, accountId: cash.id, partyId, invoiceId, type, reference,
        debit: isRefund ? 0 : cashReceived,
        credit: isRefund ? cashReceived : 0,
      },
    }));
  }

  if (bankAmount > 0 && bankAccountId) {
    ops.push(prisma.accountEntry.create({
      data: {
        branchId, accountId: bankAccountId, partyId, invoiceId, type, reference,
        debit: isRefund ? 0 : bankAmount,
        credit: isRefund ? bankAmount : 0,
      },
    }));
  }

  if (cardAmount > 0) {
    const card = await getOrCreateCardAccount(branchId);
    ops.push(prisma.accountEntry.create({
      data: {
        branchId, accountId: card.id, partyId, invoiceId, type, reference,
        debit: isRefund ? 0 : cardAmount,
        credit: isRefund ? cardAmount : 0,
      },
    }));
  }

  return ops;
}

/**
 * Moves money between two of the store's own accounts — the card machine's
 * balance into the bank when the processor deposits it, or cash into the bank
 * on a deposit run. Two mirrored entries, so every account balance stays a
 * plain sum of its own rows and the pair can be traced by its reference.
 */
export async function buildTransferOps(params: {
  branchId: string;
  fromAccountId: string;
  toAccountId: string;
  amount: number;
  date: Date;
  notes?: string | null;
}) {
  const { branchId, fromAccountId, toAccountId, amount, date, notes } = params;
  const reference = `TRF-${date.getTime().toString(36).toUpperCase()}`;

  return {
    reference,
    ops: [
      prisma.accountEntry.create({
        data: {
          branchId, accountId: fromAccountId, date, type: "TRANSFER",
          debit: 0, credit: amount, reference, notes: notes || null,
        },
      }),
      prisma.accountEntry.create({
        data: {
          branchId, accountId: toAccountId, date, type: "TRANSFER",
          debit: amount, credit: 0, reference, notes: notes || null,
        },
      }),
    ],
  };
}

/**
 * Balances for every active account in a branch, in one query per table
 * (not N+1) — same groupBy-aggregate shape as the party outstanding-balance
 * endpoint.
 *
 * `includeInactive` is for the Accounts management page, which has to list a
 * deactivated account in order to offer reactivating it. Every payment
 * dropdown calls this without the flag and so can never offer one.
 */
export async function listAccountsWithBalances(
  branchId: string,
  opts: { includeInactive?: boolean } = {}
) {
  const accounts = await prisma.account.findMany({
    where: { branchId, ...(opts.includeInactive ? {} : { isActive: true }) },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });

  if (accounts.length === 0) return [];

  const agg = await prisma.accountEntry.groupBy({
    by: ["accountId"],
    where: { accountId: { in: accounts.map((a) => a.id) } },
    _sum: { debit: true, credit: true },
  });

  const aggMap = new Map(
    agg.map((a) => [a.accountId, { debit: Number(a._sum.debit ?? 0), credit: Number(a._sum.credit ?? 0) }])
  );

  return accounts.map((a) => {
    const movement = aggMap.get(a.id) ?? { debit: 0, credit: 0 };
    return {
      ...a,
      openingBalance: Number(a.openingBalance),
      balance: Number(a.openingBalance) + movement.debit - movement.credit,
    };
  });
}

/**
 * Resolves which Account a recovery/payment/installment collection moves money
 * through. CASH always means the branch's single lazily-provisioned cash
 * account (any accountId sent alongside it is ignored); BANK requires a real,
 * active bank account belonging to this branch.
 */
export async function resolveSettlementAccount(
  branchId: string,
  paymentMethod: string,
  accountId?: string | null
): Promise<{ accountId: string } | { error: string }> {
  if (paymentMethod !== "BANK") {
    const cash = await getOrCreateCashAccount(branchId);
    return { accountId: cash.id };
  }

  if (!accountId) return { error: "accountId is required when paymentMethod is BANK" };

  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account || account.branchId !== branchId) {
    return { error: "Bank account not found in this branch" };
  }
  if (account.type !== "BANK") return { error: "Selected account is not a bank account" };
  if (!account.isActive) return { error: "Selected bank account is inactive" };

  return { accountId: account.id };
}

/**
 * Builds every op for settling part of a party balance in cash or bank: the
 * Recovery (money in from a customer) or Payment (money out to a vendor) row,
 * the party LedgerEntry that moves their balance, and the AccountEntry that
 * moves the cash/bank balance.
 *
 * Shared by POST /api/ledger/recovery, POST /api/ledger/payment and
 * POST /api/ledger/installments/collect so a plain recovery and an installment
 * collection can't drift apart in what they post — before this existed, the
 * first two moved the party ledger but left the cash/bank balances untouched.
 *
 * Pass `installmentId` when the money is settling a scheduled installment; it
 * only re-types the AccountEntry (INSTALLMENT_COLLECTION rather than
 * RECOVERY/PAYMENT) and links it back to the row.
 *
 * Pass `invoiceId` when the money was collected against one specific sale
 * invoice (the sales list's Mark Paid action, and installment collections on an
 * invoice plan). It lands on the `Recovery` row only — deliberately **not** on
 * the LedgerEntry or the AccountEntry, because the invoice void/restore/delete
 * paths clear those two tables by `invoiceId` and would otherwise wipe the
 * party-ledger and cash effects of a collection that really happened. The
 * ledger row is instead tied back through `recoveryId`/`paymentId`, which is
 * what Mark Unpaid reverses by.
 */
export function buildSettlementOps(params: {
  kind: "recovery" | "payment";
  id: string; // pre-generated so the ops can reference it without awaiting
  branchId: string;
  partyId: string;
  date: Date;
  amount: number;
  paymentMethod: string;
  accountId: string; // already resolved via resolveSettlementAccount
  notes?: string | null;
  installmentId?: string | null;
  invoiceId?: string | null;
  /** Vendor-payment counterpart of `invoiceId` — the GRN this settles. */
  grnId?: string | null;
}) {
  const {
    kind, id, branchId, partyId, date, amount,
    paymentMethod, accountId, notes, installmentId, invoiceId, grnId,
  } = params;

  const isRecovery = kind === "recovery";
  const reference = `${isRecovery ? "REC" : "PAY"}-${id.slice(-6).toUpperCase()}`;
  const defaultNote = isRecovery
    ? `Cash recovery — ${paymentMethod}`
    : `Payment to vendor — ${paymentMethod}`;

  const settlementData = {
    id, branchId, partyId, date, amount,
    paymentMethod, accountId,
    notes: notes || null,
  };

  const ops: any[] = [
    isRecovery
      ? prisma.recovery.create({ data: { ...settlementData, invoiceId: invoiceId || null } })
      : prisma.payment.create({ data: { ...settlementData, grnId: grnId || null } }),
    prisma.ledgerEntry.create({
      data: {
        branchId,
        partyId,
        date,
        // Money in from a customer credits (reduces) what they owe; money out
        // to a vendor debits (reduces) what we owe them.
        type: isRecovery ? "RECEIPT" : "PAYMENT",
        debit: isRecovery ? 0 : amount,
        credit: isRecovery ? amount : 0,
        reference,
        recoveryId: isRecovery ? id : null,
        paymentId: isRecovery ? null : id,
        notes: notes || defaultNote,
      },
    }),
    prisma.accountEntry.create({
      data: {
        branchId,
        accountId,
        date,
        type: installmentId ? "INSTALLMENT_COLLECTION" : (isRecovery ? "RECOVERY" : "PAYMENT"),
        // Debit = money into the account (customer paying us), credit = money
        // out of it (us paying a vendor).
        debit: isRecovery ? amount : 0,
        credit: isRecovery ? 0 : amount,
        reference,
        partyId,
        recoveryId: isRecovery ? id : null,
        paymentId: isRecovery ? null : id,
        installmentId: installmentId || null,
        notes: notes || defaultNote,
      },
    }),
  ];

  return { ops, reference };
}

/**
 * Builds the (unresolved) AccountEntry.create() ops for a GRN's payment at
 * receipt time — the purchase-side mirror of buildSaleAccountEntryOps.
 *
 * A normal purchase pays money OUT (credit) as PURCHASE_PAYMENT; a net-return
 * GRN takes money back IN (debit) as PURCHASE_REFUND, decided by the same
 * signed netBill the vendor-ledger split uses. A `LEND` GRN passes zero
 * amounts and so produces no entries at all — nothing left the till.
 *
 * Returned ops are meant to be pushed into the caller's `ops` array and run
 * inside the same prisma.$transaction([...]) as the GRN/ledger writes.
 */
export async function buildGrnAccountEntryOps(params: {
  branchId: string;
  grnId: string;
  grnNo: number;
  partyId: string;
  netBill: number;
  cashAmount: number;
  bankAmount: number;
  bankAccountId?: string | null;
}) {
  const { branchId, grnId, grnNo, partyId, netBill, cashAmount, bankAmount, bankAccountId } = params;
  const isRefund = netBill < 0;
  const type = isRefund ? "PURCHASE_REFUND" : "PURCHASE_PAYMENT";
  const reference = `GRN-${grnNo}`;
  const ops = [];

  if (cashAmount > 0) {
    const cash = await getOrCreateCashAccount(branchId);
    ops.push(prisma.accountEntry.create({
      data: {
        branchId, accountId: cash.id, partyId, grnId, type, reference,
        debit: isRefund ? cashAmount : 0,
        credit: isRefund ? 0 : cashAmount,
      },
    }));
  }

  if (bankAmount > 0 && bankAccountId) {
    ops.push(prisma.accountEntry.create({
      data: {
        branchId, accountId: bankAccountId, partyId, grnId, type, reference,
        debit: isRefund ? bankAmount : 0,
        credit: isRefund ? 0 : bankAmount,
      },
    }));
  }

  return ops;
}

/**
 * Normalises and checks the payment fields coming off the GRN form.
 *
 * `LEND` means the whole bill goes on vendor credit, so both amounts are
 * forced to zero rather than trusted — a stale amount left in a hidden field
 * must not silently leave the till. A bank amount with no account selected is
 * rejected outright: the GRN would otherwise record money as paid that never
 * appears in any account balance.
 */
export function validateGrnPayment(params: {
  paymentMethod?: string | null;
  cashAmount?: number | null;
  bankAmount?: number | null;
  bankAccountId?: string | null;
  netBill: number;
}):
  | { ok: true; paymentMethod: string; cashAmount: number; bankAmount: number; bankAccountId: string | null }
  | { ok: false; error: string } {
  const method = params.paymentMethod || "LEND";
  if (!["CASH", "BANK", "CASH_AND_BANK", "LEND"].includes(method)) {
    return { ok: false, error: `Unknown paymentMethod "${method}"` };
  }

  const lend = method === "LEND";
  const cashAmount = lend || method === "BANK" ? 0 : Math.max(0, Number(params.cashAmount ?? 0));
  const bankAmount = lend || method === "CASH" ? 0 : Math.max(0, Number(params.bankAmount ?? 0));
  const bankAccountId = bankAmount > 0 ? (params.bankAccountId || null) : null;

  if (bankAmount > 0 && !bankAccountId) {
    return { ok: false, error: "Select a bank account for the bank amount" };
  }
  if (cashAmount + bankAmount - Math.abs(params.netBill) > 0.005) {
    return { ok: false, error: "Amount paid cannot exceed the net bill" };
  }

  return { ok: true, paymentMethod: method, cashAmount, bankAmount, bankAccountId };
}
