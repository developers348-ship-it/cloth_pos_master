"use client";

import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useStore } from "@/lib/store-context";
import { useI18n } from "@/lib/i18n";
import NumberInput from "@/components/ui/NumberInput";
import { usePermissions } from "@/lib/permissions-client";
import toast from "react-hot-toast";
import {
  Plus, Trash2, Save, Printer, PauseCircle, PlayCircle,
  Search, UserPlus, PackagePlus, X, Edit2, CheckCircle2, MessageCircle, Copy,
  Banknote, AlertTriangle,
} from "lucide-react";
import { formatCurrency, formatDate, formatTime, calculateInvoiceTotals, cn, isBelowCost, netUnitPrice, computeSaleLedgerSplit } from "@/lib/utils";
import {
  invoiceSettledAmount, invoiceOutstanding, invoiceRefundable, invoicePaymentStatus,
} from "@/lib/invoice-settlement";
import { formatQty, formatStock, suitQty } from "@/lib/units";
import { useUnitConfig } from "@/lib/use-unit-config";
import { validateSalePayment, type SaleValidationCode } from "@/lib/sale-validation";
import type { TranslationKey } from "@/lib/translations";
import { generateInstallmentSchedule, type RepaymentType } from "@/lib/installments";
import ItemFormModal from "@/components/items/ItemFormModal";
import BarcodeScanner, { matchesBarcode, type ScannedItem, type BarcodeScannerHandle } from "@/components/items/BarcodeScanner";
import { useRowScanFlow } from "@/lib/use-row-scan-flow";
import PartyFormModal from "@/components/parties/PartyFormModal";
import InvoiceReceipt from "@/components/sales/InvoiceReceipt";
import { invoiceDiscounts, lineDiscount, type InvoiceDetail } from "@/components/sales/invoice-detail";


// ─── Types ────────────────────────────────────────────────────────────────────

type Party = {
  id: string; accountId: number; name: string; address?: string;
  city?: string; phone?: string; mobile?: string; type: string;
  previousBalance: number; creditLimit: number; isDefault?: boolean;
};

type Item = {
  id: string; name: string; unit: string; barcode?: string; systemBarcode?: string;
  purchaseUnit?: string | null; piecesPerBundle?: number | null;
  clothType?: string | null;
  purchasePrice?: number; salePrice: number; altSalePrice?: number;
  discountRS: number; discountPct: number; currentStock: number;
};

type InvoiceLine = {
  id: string; itemId: string; itemName: string; unit: string;
  qty: number; rate: number; disRS: number; disPct: number;
  amount: number; isReturn: boolean;
  // Catalog prices at the time the item was picked, kept alongside `rate` so
  // switching Party Option can re-price the row automatically — but only for
  // rows still on a catalog price, never overriding a manually-typed rate.
  salePrice: number; altSalePrice?: number;
  // Cost at the time the item was picked. Only used to warn when a discount
  // or a typed rate takes the line under it. Absent on drafts held before
  // this existed, which reads as 0 and never warns.
  purchasePrice?: number;
  // On-hand quantity as of the moment the item was picked, in `unit` — stock
  // is always held in the unit an item is sold in, so no conversion is needed
  // here (that happened once, at the GRN; see lib/units.ts). Drives the
  // "Available" line under the quantity box and the cap on what can be typed.
  stock: number;
  purchaseUnit?: string | null; piecesPerBundle?: number | null;
  clothType?: string | null;
};

type Account = {
  id: string; type: "CASH" | "BANK"; name: string;
  bankName: string | null; isActive: boolean;
};

// Shape returned by GET /api/parties/[id]/balance - the customer's *live*
// balance, unlike Party.previousBalance which is only their opening balance.
type PartyBalanceInfo = {
  balance: number;          // signed: > 0 they owe us, < 0 we owe them
  availableCredit: number;  // the < 0 side as a positive spendable amount
  creditEligible: boolean;
};

const DEFAULT_ROWS = 6;
const EMPTY_ROW = (): InvoiceLine => ({
  id: `row_${Date.now()}_${Math.random()}`,
  itemId: "", itemName: "", unit: "GAZ",
  qty: 0, rate: 0, disRS: 0, disPct: 0, amount: 0, isReturn: false,
  salePrice: 0, altSalePrice: undefined,
  stock: 0, purchaseUnit: null, piecesPerBundle: null, clothType: null,
});

// Which price applies for a given Payment Option: CASH uses the normal sale
// price, CC (Credit Customer) uses the alt price when the item has one set,
// falling back to the normal price otherwise.
function priceForPartyOption(
  partyOption: "CASH" | "CC",
  salePrice: number,
  altSalePrice?: number
) {
  return partyOption !== "CASH" && altSalePrice ? altSalePrice : salePrice;
}

/**
 * The items on a held invoice, as one line: "2 x Lawn Suit, (R) 1 x Silk Dupatta".
 *
 * The Resume dialog used to show only a line *count*, which never told two held
 * bills apart — the cashier had to resume one to find out what was on it, and
 * resuming clears the form. `holdInvoice()` already stores whole `InvoiceLine`s
 * (so invoices held before this change list their names too); nothing new is
 * persisted for this.
 */
function heldItemSummary(held: { lines?: InvoiceLine[] }): string {
  const lines = held.lines ?? [];
  return lines
    .map((l) => `${l.isReturn ? "(R) " : ""}${l.qty} x ${l.itemName || "—"}`)
    .join(", ");
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Translated toast for a blocking payment problem. `CREDIT_SALE_FULLY_PAID`
 * is deliberately absent: it opens the re-price dialog instead of a toast,
 * because resolving it changes what the customer is charged.
 */
const VALIDATION_MESSAGE_KEYS: Record<
  Exclude<SaleValidationCode, "CREDIT_SALE_FULLY_PAID">,
  TranslationKey
> = {
  BANK_ACCOUNT_REQUIRED: "sales_valBankAccountRequired",
  BANK_AMOUNT_REQUIRED: "sales_valBankAmountRequired",
  CASH_AMOUNT_REQUIRED: "sales_valCashAmountRequired",
  CASH_SALE_NOT_SETTLED: "sales_valCashSaleNotSettled",
  CREDIT_NEEDS_NAMED_PARTY: "sales_valCreditNeedsParty",
};

export default function SalesPage() {
  const { data: session } = useSession();
  const { can: canDo } = usePermissions();
  const { store } = useStore();
  const { t, isUrdu } = useI18n();
  const unitCfg = useUnitConfig();
  const branchId = (session?.user as any)?.branchId;
  const userId = (session?.user as any)?.id;

  // Invoice state
  const [lines, setLines] = useState<InvoiceLine[]>(() =>
    Array.from({ length: DEFAULT_ROWS }, EMPTY_ROW)
  );
  const [selectedParty, setSelectedParty] = useState<Party | null>(null);
  const [partyOption, setPartyOption] = useState<"CASH" | "CC">("CASH");
  const [packageDiscount, setPackageDiscount] = useState(0);
  const [adjustment, setAdjustment] = useState(0);
  const [adjustType, setAdjustType] = useState<"add" | "sub">("sub");
  const [courierCharges, setCourierCharges] = useState(0);
  const [cardAmount, setCardAmount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "BANK" | "CASH_AND_BANK">("CASH");
  const [cashReceived, setCashReceived] = useState(0);
  const [bankAmount, setBankAmount] = useState(0);
  const [bankAccountId, setBankAccountId] = useState<string>("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [partyBalance, setPartyBalance] = useState<PartyBalanceInfo | null>(null);
  const [creditApplied, setCreditApplied] = useState(0);
  const [repaymentType, setRepaymentType] = useState<RepaymentType>("NONE");
  const [installmentPeriods, setInstallmentPeriods] = useState<number | "">("");
  const [promiseDays, setPromiseDays] = useState<number | "">("");
  const [remarks, setRemarks] = useState("");
  const [invoiceNo, setInvoiceNo] = useState<number>(0);
  const [invoiceDate, setInvoiceDate] = useState(new Date());
  const [saving, setSaving] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Post-save "what next" modal (print / send via WhatsApp)
  const [savedInvoice, setSavedInvoice] = useState<InvoiceDetail | null>(null);
  const [waNumber, setWaNumber] = useState("");


  // Inline item search popup state
  const [searchRowId, setSearchRowId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Item[]>([]);
  const [searchPopupPos, setSearchPopupPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);

  // Search popups
  const [showPartySearch, setShowPartySearch] = useState(false);
  const [parties, setParties] = useState<Party[]>([]);
  const [partyQuery, setPartyQuery] = useState("");
  const [activePartyIndex, setActivePartyIndex] = useState(0);

  // Held invoices
  const [heldInvoices, setHeldInvoices] = useState<any[]>([]);
  const [showHeld, setShowHeld] = useState(false);

  // Quick "Add Item" (F11)
  const [showAddItem, setShowAddItem] = useState(false);

  // Quick "Add Account" (F12)
  const [showAddParty, setShowAddParty] = useState(false);

  // Edit current party's details from the sale bar
  const [showEditParty, setShowEditParty] = useState(false);

  // "New" confirmation — asks whether to hold the in-progress invoice first
  const [showNewConfirm, setShowNewConfirm] = useState(false);
  const [showSwitchToCash, setShowSwitchToCash] = useState(false);
  const [showBelowCost, setShowBelowCost] = useState(false);

  const tableRef = useRef<HTMLDivElement>(null);
  const scannerRef = useRef<BarcodeScannerHandle>(null);

  // Scan detection in a row's item box + walking the cursor to the next row.
  // Shared with the GRN screen — see lib/use-row-scan-flow.ts.
  const { setInputRef, forgetRow, focusRowAfter, noteRowKey, wasRowScan } =
    useRowScanFlow({ rows: lines, setRows: setLines, makeEmptyRow: EMPTY_ROW });
  // Which customer the credit amount on screen belongs to, so switching
  // customers can clear it without also clearing it on first hydration.
  const lastPartyIdRef = useRef<string | null>(null);

  // ─── Load initial data (or restore an in-progress invoice) ────────────────

  useEffect(() => {
    if (!branchId) return;
    const draftKey = `sales_draft_${branchId}`;
    let restored = false;
    const raw = localStorage.getItem(draftKey);
    if (raw) {
      try {
        const draft = JSON.parse(raw);
        if (Array.isArray(draft.lines) && draft.lines.some((l: InvoiceLine) => l.itemId !== "")) {
          setLines(draft.lines);
          setSelectedParty(draft.party ?? null);
          setPartyOption(draft.partyOption ?? "CASH");
          setPackageDiscount(draft.packageDiscount ?? 0);
          setAdjustment(draft.adjustment ?? 0);
          setAdjustType(draft.adjustType ?? "sub");
          setCourierCharges(draft.courierCharges ?? 0);
          setCardAmount(draft.cardAmount ?? 0);
          setPaymentMethod(draft.paymentMethod ?? "CASH");
          setCashReceived(draft.cashReceived ?? 0);
          setBankAmount(draft.bankAmount ?? 0);
          setBankAccountId(draft.bankAccountId ?? "");
          setCreditApplied(draft.creditApplied ?? 0);
          setRepaymentType(draft.repaymentType ?? "NONE");
          setInstallmentPeriods(draft.installmentPeriods ?? "");
          setPromiseDays(draft.promiseDays ?? "");
          setRemarks(draft.remarks ?? "");
          setInvoiceNo(draft.invoiceNo ?? 0);
          restored = true;
        }
      } catch { /* corrupt draft, ignore */ }
    }
    if (!restored) {
      loadNextInvoiceNo();
      loadWalkingCustomer();
    }
    loadHeldInvoices();
    loadAccounts();
    setHydrated(true);
    // Tick clock
    const interval = setInterval(() => setInvoiceDate(new Date()), 1000);
    return () => clearInterval(interval);
  }, [branchId]);

  // Persist the in-progress invoice so switching pages or reloading doesn't lose it.
  // Only kicks in once there's at least one real item on the invoice.
  useEffect(() => {
    if (!branchId || !hydrated) return;
    const draftKey = `sales_draft_${branchId}`;
    if (!lines.some((l) => l.itemId !== "")) {
      localStorage.removeItem(draftKey);
      return;
    }
    const draft = {
      invoiceNo, party: selectedParty, partyOption, lines,
      packageDiscount, adjustment, adjustType, courierCharges,
      cardAmount, paymentMethod, cashReceived, bankAmount, bankAccountId, creditApplied,
      repaymentType, installmentPeriods, promiseDays, remarks,
    };
    localStorage.setItem(draftKey, JSON.stringify(draft));
  }, [
    branchId, hydrated, invoiceNo, selectedParty, partyOption, lines,
    packageDiscount, adjustment, adjustType, courierCharges,
    cardAmount, paymentMethod, cashReceived, bankAmount, bankAccountId, creditApplied,
    repaymentType, installmentPeriods, promiseDays, remarks,
  ]);

  // Reload the selected customer's live balance whenever the customer changes
  // (and after a save, since the sale just moved it). The number is advisory
  // in the UI only - POST /api/sales re-derives it before honouring any credit.
  useEffect(() => {
    if (!branchId || !selectedParty) { setPartyBalance(null); return; }
    // A credit amount typed for one customer must not ride along onto the next
    // one's bill. Skipped on the very first run so a restored draft's credit
    // survives hydration.
    if (lastPartyIdRef.current !== null && lastPartyIdRef.current !== selectedParty.id) {
      setCreditApplied(0);
    }
    lastPartyIdRef.current = selectedParty.id;
    loadPartyBalance(selectedParty.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, selectedParty?.id]);

  async function loadPartyBalance(partyId: string) {
    try {
      const res = await fetch(`/api/parties/${partyId}/balance?branchId=${branchId}`);
      // A restored draft or held invoice can name a party that no longer
      // exists (data cleared/restored, or a different database). Saving would
      // fail with "Party not found", so fall back to the walking customer.
      if (res.status === 404) { loadWalkingCustomer(); return; }
      if (!res.ok) return;
      setPartyBalance(await res.json());
    } catch { /* advisory only - the server re-checks credit on save */ }
  }

  async function loadAccounts() {
    if (!branchId) return;
    const res = await fetch(`/api/accounts?branchId=${branchId}`);
    const data = await res.json();
    setAccounts((data.accounts ?? []).filter((a: Account) => a.isActive));
  }

  async function loadNextInvoiceNo() {
    const res = await fetch(`/api/sales/next-invoice-no?branchId=${branchId}`);
    const data = await res.json();
    setInvoiceNo(data.invoiceNo);
  }

  async function loadWalkingCustomer() {
    const res = await fetch("/api/parties?isDefault=true");
    const data = await res.json();
    if (data.parties?.length) setSelectedParty(data.parties[0]);
  }

  function loadHeldInvoices() {
    const stored = localStorage.getItem(`held_invoices_${branchId}`);
    if (stored) setHeldInvoices(JSON.parse(stored));
  }

  // ─── Party search — shows 5 recent customers until you start typing ───────

  // Keep the highlighted row in range whenever the result set changes
  useEffect(() => {
    setActivePartyIndex(0);
  }, [parties]);

  useEffect(() => {
    if (!showPartySearch) return;
    const timer = setTimeout(async () => {
      const url = partyQuery
        ? `/api/parties?q=${encodeURIComponent(partyQuery)}&limit=15`
        : `/api/parties?recent=true&limit=5`;
      const res = await fetch(url);
      const data = await res.json();
      setParties(data.parties ?? []);
    }, partyQuery ? 300 : 0);
    return () => clearTimeout(timer);
  }, [partyQuery, showPartySearch]);

  function selectParty(p: Party) {
    setSelectedParty(p);
    setShowPartySearch(false);
    setPartyQuery("");
  }

  // ─── Inline item search ───────────────────────────────────────────────────

  // Keep the highlighted row in range whenever the result set changes
  useEffect(() => {
    setActiveSearchIndex(0);
  }, [searchResults]);

  useEffect(() => {
    if (!searchQuery || !searchRowId) { setSearchResults([]); return; }
    const timer = setTimeout(async () => {
      const res = await fetch(
        `/api/items?q=${encodeURIComponent(searchQuery)}&branchId=${branchId}&limit=15`
      );
      const data = await res.json();
      setSearchResults(data.items ?? []);
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery, searchRowId]);

  function openRowSearch(rowId: string, query: string, inputEl: HTMLInputElement) {
    setSearchRowId(rowId);
    setSearchQuery(query);
    const rect = inputEl.getBoundingClientRect();
    setSearchPopupPos({
      top: rect.bottom + window.scrollY,
      left: rect.left + window.scrollX,
      width: Math.max(320, rect.width),
    });
  }

  function closeSearch() {
    setSearchRowId(null);
    setSearchQuery("");
    setSearchResults([]);
    setSearchPopupPos(null);
  }

  /**
   * What is still sellable on this row.
   *
   * `line.stock` is the item's on-hand as of the moment it was picked, in the
   * item's own unit — stock is always held in the unit an item is sold in, so
   * nothing needs converting here. The subtraction matters when the same item
   * appears on two rows: without it each row would independently believe the
   * whole shelf was available and the invoice could sell twice what exists.
   *
   * Return rows are goods coming *back* in, so they are not capped.
   */
  function availableFor(line: InvoiceLine, all: InvoiceLine[]): number {
    if (!line.itemId) return 0;
    const onOtherRows = all.reduce(
      (sum, other) =>
        other.id !== line.id && other.itemId === line.itemId && !other.isReturn
          ? sum + other.qty
          : sum,
      0
    );
    return Math.max(0, line.stock - onOtherRows);
  }

  /**
   * The cap the quantity box enforces. Passed to `NumberInput`'s `transform`,
   * which snaps the box to the clamped figure immediately — so the screen can
   * never show a quantity that is not the one in effect.
   */
  function capQty(line: InvoiceLine, next: number): number {
    if (line.isReturn) return next;
    return Math.min(next, availableFor(line, lines));
  }

  function pickItemForRow(rowId: string, item: Item) {
    setLines(prev => prev.map(l => {
      if (l.id !== rowId) return l;
      const qty = l.qty > 0 ? l.qty : 1;
      const rate = priceForPartyOption(partyOption, item.salePrice, item.altSalePrice);
      const discount = item.discountRS > 0 ? item.discountRS : (rate * qty * item.discountPct) / 100;
      return {
        ...l, itemId: item.id, itemName: item.name,
        unit: item.unit as any, rate,
        salePrice: item.salePrice, altSalePrice: item.altSalePrice,
        purchasePrice: item.purchasePrice ?? 0,
        disRS: item.discountRS, disPct: item.discountPct,
        stock: item.currentStock,
        purchaseUnit: item.purchaseUnit ?? null,
        piecesPerBundle: item.piecesPerBundle ?? null,
        clothType: item.clothType ?? null,
        qty, amount: rate * qty - discount,
      };
    }));
    closeSearch();
    focusRowAfter(rowId);
  }

  // Switch Payment Method, clearing whichever amount field(s) fall out of
  // scope so a stale amount from a previous selection can't silently ride
  // along into the totals or the saved invoice.
  function changePaymentMethod(next: "CASH" | "BANK" | "CASH_AND_BANK") {
    setPaymentMethod(next);
    if (next === "CASH") { setBankAmount(0); setBankAccountId(""); }
    else if (next === "BANK") { setCashReceived(0); }
  }

  // Re-price rows when Party Option changes (e.g. CASH -> CR), but only rows
  // still sitting on one of the item's two catalog prices — a manually typed
  // rate is left alone.
  useEffect(() => {
    setLines(prev => prev.map(l => {
      if (l.itemId === "") return l;
      const onCatalogPrice = l.rate === l.salePrice || (l.altSalePrice != null && l.rate === l.altSalePrice);
      if (!onCatalogPrice) return l;
      const rate = priceForPartyOption(partyOption, l.salePrice, l.altSalePrice);
      if (rate === l.rate) return l;
      const discount = l.disRS > 0 ? l.disRS : (rate * l.qty * l.disPct) / 100;
      return { ...l, rate, amount: rate * l.qty - discount };
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partyOption]);

  // ─── Row mutation helpers ─────────────────────────────────────────────────

  function updateRow(id: string, patch: Partial<InvoiceLine>) {
    setLines(prev => prev.map(l => {
      if (l.id !== id) return l;
      const updated = { ...l, ...patch };
      const discount = updated.disRS > 0
        ? updated.disRS
        : (updated.rate * updated.qty * updated.disPct) / 100;
      updated.amount = updated.rate * updated.qty - discount;
      return updated;
    }));
  }

  function addRow() {
    setLines(prev => [...prev, EMPTY_ROW()]);
  }

  function removeRow(id: string) {
    forgetRow(id);
    setLines(prev => {
      const filtered = prev.filter(l => l.id !== id);
      return filtered.length < DEFAULT_ROWS
        ? [...filtered, ...Array.from({ length: DEFAULT_ROWS - filtered.length }, EMPTY_ROW)]
        : filtered;
    });
  }

  // Only filled lines count for totals/save
  const filledLines = lines.filter(l => l.itemId !== "");

  // Sold lines whose discount (or typed rate) puts them under purchase price.
  // Flagged on the row as it happens; saving them needs a confirm.
  const lineBelowCost = (l: InvoiceLine) =>
    !l.isReturn && l.itemId !== "" && isBelowCost(netUnitPrice(l.rate, l.qty, l.disRS, l.disPct), l.purchasePrice);
  const belowCostLines = filledLines.filter(lineBelowCost);

  // ─── Totals ──────────────────────────────────────────────────────────────

  const totals = calculateInvoiceTotals({
    items: filledLines.map((l) => ({
      qty: l.qty, rate: l.rate, disRS: l.disRS, disPct: l.disPct,
      isReturn: l.isReturn, unit: l.unit,
    })),
    packageDiscount, adjustment, adjustType, courierCharges, cardAmount, cashReceived, bankAmount,
    creditApplied,
  });

  // What can actually be put on this bill: never more credit than the customer
  // holds, and never more than the bill itself.
  const maxCreditApplicable = Math.min(partyBalance?.availableCredit ?? 0, Math.max(0, totals.netBill));
  // Writing off part of a bill against store credit moves value with no cash
  // behind it, so it carries its own permission (POST /api/sales checks the
  // same key whenever creditApplied > 0).
  const canApplyCredit = canDo("APPLY_STORE_CREDIT")
    && !totals.isRefund && (partyBalance?.creditEligible ?? false) && maxCreditApplicable > 0;

  // What the customer still owes once credit and counter payments are counted
  // - the amount an installment plan would finance.
  const outstandingAfterPayment = totals.isRefund
    ? 0
    : Math.max(0, Math.round((totals.netBill - totals.creditApplied - (cardAmount + cashReceived + bankAmount)) * 100) / 100);

  // A repayment type only means anything while something is left owing. Pinned
  // to NONE otherwise so a selection made before the customer decided to pay in
  // full can't be posted (and rejected) with no schedule to build.
  const effectiveRepaymentType: RepaymentType = outstandingAfterPayment > 0 ? repaymentType : "NONE";
  const needsPromiseDays = effectiveRepaymentType === "PROMISE_DAY" && !(Number(promiseDays) > 0);

  // Client-side preview of the schedule the server will generate, from the very
  // same pure function - so what the cashier reads out to the customer is what
  // gets written.
  const schedulePreview = effectiveRepaymentType === "NONE" || needsPromiseDays
    ? []
    : generateInstallmentSchedule({
        principal: outstandingAfterPayment,
        kind: effectiveRepaymentType,
        periods: effectiveRepaymentType === "PROMISE_DAY" ? 1 : Number(installmentPeriods || 1),
        startDate: invoiceDate,
        promiseDays: Number(promiseDays) || null,
      });

  // Selecting Weekly/Monthly with no period count yet is a dead end, so seed a
  // sensible default the cashier can overwrite.
  function changeRepaymentType(next: RepaymentType) {
    setRepaymentType(next);
    if ((next === "WEEKLY" || next === "MONTHLY") && !installmentPeriods) setInstallmentPeriods(3);
  }

  /**
   * The invoice on screen in the shape `GET /api/sales/:id` returns, so the
   * Sales page prints the very same `InvoiceReceipt` the sales report and the
   * invoice page re-print — one slip everywhere, discounts and all.
   *
   * Money figures are what the store *kept* (tender minus change), exactly as
   * POST /api/sales stores them, so the slip handed over at the counter and a
   * later re-print agree to the rupee. `invoiceNoOverride` is the number the
   * server actually assigned, once the sale is saved.
   */
  function buildReceiptDetail(invoiceNoOverride?: number, idOverride?: string): InvoiceDetail {
    // The customer's balance *before* this sale. Falls back to the opening
    // balance only while the live figure is still loading.
    const balanceBefore = partyBalance?.balance ?? Number(selectedParty?.previousBalance ?? 0);
    const split = computeSaleLedgerSplit(totals.netBill, totals.totalKept);
    const settlement = {
      netBill: totals.netBill, creditApplied: totals.creditApplied,
      cashReceived: totals.cashKept, cardAmount: totals.cardKept, bankAmount: totals.bankKept,
      recovered: 0,
    };
    return {
      id: idOverride ?? "",
      invoiceNo: invoiceNoOverride ?? invoiceNo,
      date: invoiceDate.toISOString(),
      status: "SAVED",
      partyOption, paymentMethod, printUrdu: false,
      notes: remarks || null,
      cashier: session?.user?.name ?? null,
      bankAccountName: accounts.find((a) => a.id === bankAccountId)?.name ?? null,
      party: {
        id: selectedParty?.id ?? "",
        accountId: selectedParty?.accountId ?? 0,
        name: selectedParty?.name ?? t("sales_walkingCustomer"),
        type: selectedParty?.type ?? "",
        phone: selectedParty?.phone ?? null,
        mobile: selectedParty?.mobile ?? null,
        address: selectedParty?.address ?? null,
        city: selectedParty?.city ?? null,
        creditLimit: Number(selectedParty?.creditLimit ?? 0),
        balanceBefore,
        balanceAfter: balanceBefore + split.debit - split.credit,
      },
      items: filledLines.map((l) => ({
        id: l.id, name: l.itemName, unit: l.unit, barcode: null,
        isReturn: l.isReturn,
        qty: l.qty,
        pcs: l.unit === "PCS" ? l.qty : 0,
        gaz: l.unit === "GAZ" ? l.qty : 0,
        mtr: l.unit === "MTR" ? l.qty : 0,
        rate: l.rate, disRS: l.disRS, disPct: l.disPct, amount: l.amount,
      })),
      totals: {
        grossSale: totals.grossSale, packageDiscount, saleAmount: totals.saleAmount,
        returnAmount: totals.returnAmount, adjustment, adjustType,
        slipAmount: totals.slipAmount, courierCharges, netBill: totals.netBill,
        soldPcs: totals.soldPcs, soldGaz: totals.soldGaz, soldMtr: totals.soldMtr,
        returnPcs: totals.returnPcs, returnGaz: totals.returnGaz, returnMtr: totals.returnMtr,
      },
      payment: {
        cashReceived: totals.cashKept, cardAmount: totals.cardKept, bankAmount: totals.bankKept,
        creditApplied: totals.creditApplied, change: totals.change, recovered: 0,
        settled: invoiceSettledAmount(settlement),
        outstanding: invoiceOutstanding(settlement),
        refundable: invoiceRefundable(settlement),
        status: invoicePaymentStatus(settlement),
      },
      recoveries: [],
      // The same schedule the server generates from these figures.
      plan: schedulePreview.length > 0 ? {
        id: "", kind: effectiveRepaymentType, principal: outstandingAfterPayment,
        periods: schedulePreview.length, startDate: invoiceDate.toISOString(),
        installments: schedulePreview.map((r) => ({
          seq: r.seq, dueDate: new Date(r.dueDate).toISOString(), amount: r.amount,
          paidAmount: 0, status: "PENDING" as const, paidAt: null,
        })),
      } : null,
      repaymentType: effectiveRepaymentType,
      installmentPeriods: installmentPeriods ? Number(installmentPeriods) : null,
      refundOf: null,
      refundedBy: null,
    };
  }

  // What the printed receipt shows: the just-saved invoice when the post-save
  // modal is open, otherwise the invoice still being edited.
  const receiptDetail = savedInvoice ?? buildReceiptDetail();

  // ─── Hold / Resume ───────────────────────────────────────────────────────

  function holdInvoice() {
    if (!canDo("HOLD_INVOICE")) { toast.error(t("sales_noHoldPermission")); return; }
    if (filledLines.length === 0) { toast.error(t("sales_noItemsToHold")); return; }
    const held = {
      id: `hold_${Date.now()}`,
      invoiceNo, party: selectedParty, partyOption,
      lines: filledLines, packageDiscount, adjustment, adjustType,
      courierCharges, cardAmount, paymentMethod, cashReceived, bankAmount, bankAccountId,
      creditApplied: totals.creditApplied, repaymentType, installmentPeriods, promiseDays, remarks,
      heldAt: new Date().toISOString(),
    };
    const existing = JSON.parse(localStorage.getItem(`held_invoices_${branchId}`) ?? "[]");
    existing.push(held);
    localStorage.setItem(`held_invoices_${branchId}`, JSON.stringify(existing));
    setHeldInvoices(existing);
    clearForm();
    toast.success(`${t("sales_invoiceHeld")} (F7) ✓`);
  }

  function recallInvoice(held: any) {
    setSelectedParty(held.party);
    setPartyOption(held.partyOption);
    const recalled = held.lines as InvoiceLine[];
    const extra = recalled.length < DEFAULT_ROWS
      ? Array.from({ length: DEFAULT_ROWS - recalled.length }, EMPTY_ROW)
      : [];
    setLines([...recalled, ...extra]);
    setPackageDiscount(held.packageDiscount ?? 0);
    setAdjustment(held.adjustment ?? 0);
    setAdjustType(held.adjustType ?? "sub");
    setCourierCharges(held.courierCharges ?? 0);
    setCardAmount(held.cardAmount ?? 0);
    setPaymentMethod(held.paymentMethod ?? "CASH");
    setCashReceived(held.cashReceived ?? 0);
    setBankAmount(held.bankAmount ?? 0);
    setBankAccountId(held.bankAccountId ?? "");
    setCreditApplied(held.creditApplied ?? 0);
    setRepaymentType(held.repaymentType ?? "NONE");
    setInstallmentPeriods(held.installmentPeriods ?? "");
    setPromiseDays(held.promiseDays ?? "");
    setRemarks(held.remarks ?? "");
    const remaining = heldInvoices.filter((h) => h.id !== held.id);
    setHeldInvoices(remaining);
    localStorage.setItem(`held_invoices_${branchId}`, JSON.stringify(remaining));
    setShowHeld(false);
    toast.success(`${t("sales_invoiceResumed")} ✓`);
  }

  function deleteHeldInvoice(held: any) {
    if (!confirm(t("sales_confirmDeleteHeld"))) return;
    const remaining = heldInvoices.filter((h) => h.id !== held.id);
    setHeldInvoices(remaining);
    localStorage.setItem(`held_invoices_${branchId}`, JSON.stringify(remaining));
    toast.success(t("sales_heldInvoiceDeleted"));
  }

  function clearForm() {
    if (branchId) localStorage.removeItem(`sales_draft_${branchId}`);
    setLines(Array.from({ length: DEFAULT_ROWS }, EMPTY_ROW));
    setPackageDiscount(0); setAdjustment(0); setAdjustType("sub");
    setCourierCharges(0); setCardAmount(0);
    setPaymentMethod("CASH"); setCashReceived(0); setBankAmount(0); setBankAccountId("");
    setCreditApplied(0);
    setRepaymentType("NONE"); setInstallmentPeriods("");
    setPromiseDays("");
    setRemarks("");
    loadNextInvoiceNo(); loadWalkingCustomer();
  }

  // "New" button / Ctrl+I — asks first if the current invoice has items,
  // so it's never lost by accident. Confirming holds it (same as F7).
  function handleNewClick() {
    if (filledLines.length > 0) {
      setShowNewConfirm(true);
    } else {
      clearForm();
    }
  }

  function confirmHoldAndNew() {
    setShowNewConfirm(false);
    holdInvoice();
  }

  // Discards the current invoice outright — no hold, no save.
  function confirmDiscardAndNew() {
    setShowNewConfirm(false);
    clearForm();
  }

  // ─── Barcode scanning ──────────────────────────────────────────────────────

  /**
   * Where a resolved scan lands. An item already on the invoice as a sale line
   * bumps its quantity rather than opening a second row for the same thing;
   * anything else fills the first empty row. The lookup, the unknown-code
   * chooser and the create-item form live in `BarcodeScanner`, shared with the
   * GRN screen.
   */
  function addScannedItem(item: ScannedItem, originRowId?: string) {
    setLines(prev => {
      const existing = prev.find(l => l.itemId === item.id && !l.isReturn);
      if (existing) {
        toast.success(`${item.name} +1`);
        return prev.map(l => {
          if (l.id !== existing.id) return l;
          // A repeated scan is still a sale — it has to stop at the shelf the
          // same way a typed quantity does.
          const qty = Math.min(l.qty + 1, availableFor(l, prev));
          const discount = l.disRS > 0 ? l.disRS : (l.rate * qty * l.disPct) / 100;
          return { ...l, qty, amount: l.rate * qty - discount };
        });
      }
      const rate = priceForPartyOption(partyOption, item.salePrice, item.altSalePrice);
      const discount = item.discountRS > 0 ? item.discountRS : (rate * item.discountPct) / 100;
      const filled: InvoiceLine = {
        id: `row_${Date.now()}_${Math.random()}`,
        itemId: item.id, itemName: item.name, unit: item.unit,
        qty: 1, rate, disRS: item.discountRS, disPct: item.discountPct,
        amount: rate - discount, isReturn: false,
        salePrice: item.salePrice, altSalePrice: item.altSalePrice,
        purchasePrice: item.purchasePrice,
        stock: item.currentStock,
        purchaseUnit: item.purchaseUnit ?? null,
        piecesPerBundle: item.piecesPerBundle ?? null,
        clothType: item.clothType ?? null,
      };
      toast.success(item.name);
      const blank = prev.findIndex(l => l.itemId === "");
      if (blank === -1) return [...prev, filled];
      return prev.map((l, i) => (i === blank ? { ...filled, id: l.id } : l));
    });

    // Only when the code was typed into a row's item box. A scan made in the
    // dedicated field reports no origin and leaves the cursor there, so the
    // next one can follow immediately.
    if (originRowId) focusRowAfter(originRowId);
  }

  // ─── Quick "Add Item" (F11) ────────────────────────────────────────────────

  function openAddItem() {
    setShowAddItem(true);
  }

  function handleItemCreated(created: any) {
    // Drop the freshly-created item straight into the first empty row
    const targetRow = lines.find((l) => l.itemId === "");
    if (targetRow) {
      pickItemForRow(targetRow.id, {
        id: created.id,
        name: created.name,
        unit: created.unit,
        purchaseUnit: created.purchaseUnit ?? null,
        piecesPerBundle: created.piecesPerBundle ?? null,
        clothType: created.clothType ?? null,
        purchasePrice: Number(created.purchasePrice ?? 0),
        salePrice: Number(created.salePrice),
        discountRS: Number(created.discountRS),
        discountPct: Number(created.discountPct),
        currentStock: Number(created.openingStock ?? 0),
      });
    }
  }

  // ─── Quick "Add Account" (F12) ──────────────────────────────────────────────

  function openAddParty() {
    setShowAddParty(true);
  }

  function handlePartySaved(saved: any) {
    // Whether just created (F12) or edited in place, it becomes/stays this invoice's party
    setSelectedParty({
      id: saved.id, accountId: saved.accountId, name: saved.name,
      address: saved.address, city: saved.city, phone: saved.phone,
      mobile: saved.mobile, type: saved.type,
      previousBalance: Number(saved.previousBalance ?? 0),
      creditLimit: Number(saved.creditLimit ?? 0),
      isDefault: Boolean(saved.isDefault),
    });
  }

  // ─── Keyboard shortcuts ───────────────────────────────────────────────────

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const ctrlOrCmd = e.ctrlKey || e.metaKey;
      if (ctrlOrCmd && e.key.toLowerCase() === "s") { e.preventDefault(); saveInvoice(); return; }
      // Ctrl+I, not Ctrl+N: Chrome and Edge reserve Ctrl+N for a new browser
      // window at a level a page cannot preventDefault, so the old binding
      // could never have fired. Ctrl+S and Ctrl+P below *are* cancellable.
      if (ctrlOrCmd && e.key.toLowerCase() === "i") { e.preventDefault(); handleNewClick(); return; }
      if (e.key === "F7") { e.preventDefault(); holdInvoice(); }
      if (e.key === "F8") { e.preventDefault(); setShowHeld(true); }
      if (e.key === "F11") { e.preventDefault(); openAddItem(); }
      if (e.key === "F12") { e.preventDefault(); openAddParty(); }
      if (e.key === "Escape") closeSearch();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [
    filledLines, selectedParty, partyOption, packageDiscount, adjustment, adjustType,
    courierCharges, cardAmount, paymentMethod, cashReceived, bankAmount, bankAccountId,
    creditApplied, repaymentType, installmentPeriods, promiseDays, remarks, invoiceNo, branchId, userId,
  ]);

  // ─── Save Invoice ─────────────────────────────────────────────────────────

  /** Flips the price tier to Cash and leaves the invoice unsaved for review. */
  function confirmSwitchToCash() {
    setShowSwitchToCash(false);
    setPartyOption("CASH");
    toast.success(t("sales_switchToCashDone"));
  }

  async function saveInvoice(allowBelowCost = false) {
    if (!selectedParty) { toast.error(t("sales_selectPartyError")); return; }
    if (filledLines.length === 0) { toast.error(t("sales_addAtLeastOneItem")); return; }
    if (needsPromiseDays) { toast.error(t("sales_promiseDaysRequired")); return; }

    // Same rules the server re-checks in POST /api/sales, from one shared
    // module — see lib/sale-validation.ts for why the price tier takes part.
    const issue = validateSalePayment({
      partyOption,
      paymentMethod,
      netBill: totals.netBill,
      outstanding: outstandingAfterPayment,
      cashReceived,
      bankAmount,
      bankAccountId,
      isWalkingCustomer: Boolean(selectedParty.isDefault),
      isRefund: totals.isRefund,
    });
    if (issue) {
      // CREDIT_SALE_FULLY_PAID isn't a toast: resolving it re-prices every
      // line, so it opens a dialog and hands the invoice back for review.
      if (issue.code === "CREDIT_SALE_FULLY_PAID") { setShowSwitchToCash(true); return; }
      const messageKey = VALIDATION_MESSAGE_KEYS[issue.code];
      toast.error(
        issue.code === "CASH_SALE_NOT_SETTLED"
          ? `${t(messageKey)} Rs. ${formatCurrency(issue.outstanding ?? 0)}`
          : t(messageKey)
      );
      return;
    }

    // Selling under cost is allowed, but only on purpose.
    if (belowCostLines.length > 0 && !allowBelowCost) { setShowBelowCost(true); return; }
    setShowBelowCost(false);

    setSaving(true);
    try {
      const payload = {
        branchId, userId, partyId: selectedParty.id,
        partyOption, promiseDays,
        lines: filledLines, packageDiscount, adjustment, adjustType,
        courierCharges, cardAmount, paymentMethod, cashReceived, bankAmount,
        bankAccountId: bankAccountId || null,
        repaymentType: effectiveRepaymentType,
        installmentPeriods: installmentPeriods || null,
        notes: remarks || null,
        ...totals,
      };
      const res = await fetch("/api/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const mobile = selectedParty.mobile;
      const savedPartyId = selectedParty.id;
      // Built before clearForm: it reads the invoice still on screen.
      const saved = buildReceiptDetail(data.invoiceNo, data.id);
      setWaNumber(mobile ?? "");
      clearForm();
      setSavedInvoice(saved);
      // This sale moved the customer's balance (and consumed any credit
      // applied), so the figure the next invoice starts from must be re-read.
      loadPartyBalance(savedPartyId);

    } catch (err: any) {
      toast.error(t("sales_saveFailedPrefix") + err.message);
    } finally {
      setSaving(false);
    }
  }

  function printReceipt() {
    if (!canDo("PRINT_RECEIPT")) { toast.error(t("sales_noPrintPermission")); return; }
    window.print();
  }

  // ─── Post-save: WhatsApp / copy message ────────────────────────────────────

  function buildInvoiceMessage(inv: InvoiceDetail) {
    const rs = (n: number) => `Rs. ${Math.abs(n).toFixed(2)}`;
    const disc = invoiceDiscounts(inv);
    const itemLines = inv.items
      .map((l) => {
        const d = lineDiscount(l);
        return `${l.isReturn ? "(R) " : ""}${l.name} x${l.qty}${l.unit} @ ${l.rate.toFixed(0)}`
          + `${d > 0 ? ` - disc ${d.toFixed(0)}` : ""} = Rs. ${l.amount.toFixed(0)}`;
      })
      .join("\n");
    const parts = [
      store?.name ?? "Invoice",
      `Invoice #${inv.invoiceNo} — ${formatDate(new Date(inv.date))}`,
      `Customer: ${inv.party.name}`,
      "",
      itemLines,
      "",
    ];
    if (disc.itemDiscount > 0.005) {
      parts.push(`Subtotal: ${rs(disc.subtotal)}`);
      parts.push(`Item Discount: -${rs(disc.itemDiscount)}`);
    }
    parts.push(`Gross Sale: ${rs(inv.totals.grossSale)}`);
    if (disc.packageDiscount > 0.005) parts.push(`Package Discount: -${rs(disc.packageDiscount)}`);
    if (disc.itemDiscount > 0.005 && disc.packageDiscount > 0.005) parts.push(`Total Discount: ${rs(disc.totalDiscount)}`);
    if (inv.totals.returnAmount > 0.005) parts.push(`Returns: -${rs(inv.totals.returnAmount)}`);
    if (inv.totals.adjustment > 0.005) {
      parts.push(`Adjustment: ${inv.totals.adjustType === "add" ? "+" : "-"}${rs(inv.totals.adjustment)}`);
    }
    if (inv.totals.courierCharges > 0.005) parts.push(`Courier: ${rs(inv.totals.courierCharges)}`);
    parts.push(`${inv.totals.netBill < 0 ? "Refund" : "Net Bill"}: ${rs(inv.totals.netBill)}`);
    if (inv.payment.creditApplied > 0) {
      parts.push(`Store Credit Used: ${rs(inv.payment.creditApplied)}`);
      parts.push(`Amount Due: ${rs(inv.totals.netBill - inv.payment.creditApplied)}`);
    }
    if (inv.payment.outstanding > 0.005) parts.push(`Outstanding: ${rs(inv.payment.outstanding)}`);
    if (inv.partyOption !== "CASH") {
      parts.push(`Previous Balance: ${rs(inv.party.balanceBefore)}`);
    }
    if (inv.notes?.trim()) {
      parts.push(`Remarks: ${inv.notes.trim()}`);
    }
    parts.push("", t("sales_thankYouMessage"));
    return parts.join("\n");
  }

  // Best-effort local-number -> international conversion (Pakistan default: 0xxx -> 92xxx)
  function toWhatsappDigits(raw: string) {
    const digits = raw.replace(/[^0-9]/g, "");
    if (!digits) return "";
    if (digits.startsWith("0")) return "92" + digits.slice(1);
    return digits;
  }

  function sendInvoiceWhatsApp() {
    if (!savedInvoice) return;
    const digits = toWhatsappDigits(waNumber);
    if (!digits) { toast.error(t("sales_enterWhatsappNumber")); return; }
    const text = buildInvoiceMessage(savedInvoice);
    window.open(`https://wa.me/${digits}?text=${encodeURIComponent(text)}`, "_blank");
  }

  async function copyInvoiceMessage() {
    if (!savedInvoice) return;
    try {
      await navigator.clipboard.writeText(buildInvoiceMessage(savedInvoice));
      toast.success(t("sales_messageCopied"));
    } catch {
      toast.error(t("sales_copyFailed"));
    }
  }

  // ─── UI ──────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col bg-gray-100" onClick={() => { if (searchRowId) closeSearch(); }}>

      {/* Top Bar */}
      <div className="bg-teal-700 text-white px-3 sm:px-4 py-2 sm:py-3 flex items-center justify-between gap-2 gap-y-1 flex-wrap shadow-md shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-bold text-lg sm:text-2xl truncate">{store?.name ?? "POS"}</span>
          <span className={cn("text-teal-300 text-sm sm:text-base hidden sm:inline", isUrdu && "urdu-text")}>— {t("sales_title")}</span>
        </div>
        <div className="flex items-center gap-3 sm:gap-5">
          <span className="text-teal-200 text-sm sm:text-base">
            <span className={isUrdu ? "urdu-text" : undefined}>{t("sales_billNo")}</span> <span className="text-white font-bold text-base sm:text-xl">{invoiceNo || "—"}</span>
          </span>
          <span className="text-teal-200 text-xs sm:text-base">{hydrated ? formatDate(invoiceDate) + " " + formatTime(invoiceDate) : ""}</span>
        </div>
      </div>

      {/* Main Content — side-by-side from lg up; below that the totals panel
          stacks under the item table and the whole area scrolls as one column */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-y-auto lg:overflow-hidden">

        {/* Left: Party + Items */}
        <div className="flex flex-col min-h-0 lg:flex-1 lg:overflow-hidden">

          {/* Party Section — single row to save vertical space */}
          <div className="bg-white border-b border-gray-200 px-3 sm:px-4 py-2 flex items-center gap-2 sm:gap-3 gap-y-1.5 flex-wrap shrink-0">
            <div
              className="w-14 border border-gray-300 rounded px-1.5 py-1.5 cursor-pointer hover:border-teal-400 bg-gray-50 text-sm flex items-center justify-between shrink-0"
              onClick={() => setShowPartySearch(true)}
              title={t("sales_account")}
            >
              <span className="truncate">{selectedParty?.accountId ?? "—"}</span>
              <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
            </div>
            <div className="flex items-center gap-1.5 min-w-0">
              <div
                className={cn("min-w-0 max-w-[260px] border border-teal-400 rounded px-2 py-1.5 cursor-pointer hover:border-teal-600 bg-teal-50 text-base font-semibold text-teal-800 truncate", isUrdu && !selectedParty?.name && "urdu-text")}
                onClick={() => setShowPartySearch(true)}
              >
                {selectedParty?.name ?? t("sales_walkingCustomer")}
              </div>
              {selectedParty && !selectedParty.isDefault && (
                <button
                  type="button"
                  onClick={() => setShowEditParty(true)}
                  className="shrink-0 p-1.5 text-teal-600 hover:text-teal-800 hover:bg-teal-50 rounded"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <label className={cn("text-gray-500 text-base font-medium", isUrdu && "urdu-text")}>{t("sales_prevBalance")}</label>
              {/* The customer's live balance, not the static opening balance on
                  the Party row — with store credit now spendable at checkout,
                  showing a stale figure next to an "available credit" panel
                  would be actively misleading. Negative means the store owes
                  them (credit), shown green and tagged CR. */}
              <span className={cn(
                "text-base font-bold px-2.5 py-1 rounded",
                (partyBalance?.balance ?? 0) < -0.005
                  ? "text-green-700 bg-green-50"
                  : "text-red-600 bg-red-50"
              )}>
                Rs. {formatCurrency(Math.abs(partyBalance?.balance ?? Number(selectedParty?.previousBalance ?? 0)))}
                {(partyBalance?.balance ?? 0) < -0.005 && " CR"}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <label className={cn("text-gray-500 text-base font-medium", isUrdu && "urdu-text")}>{t("sales_mobile")}</label>
              <span className="text-base text-gray-700">{selectedParty?.mobile ?? "—"}</span>
            </div>
            <input
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder={t("sales_remarksPlaceholder")}
              className={cn("min-w-[120px] flex-1 border border-gray-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-teal-400", isUrdu && "urdu-text")}
            />
          </div>

          <PartyFormModal
            open={showEditParty}
            onClose={() => setShowEditParty(false)}
            editParty={selectedParty}
            onSaved={handlePartySaved}
          />

          {/* Line Items Table — scrollable center, scrollbar hidden */}
          {/* min-w keeps the ten columns readable on a phone; the wrapper scrolls
              sideways instead of crushing them */}
          <div className="lg:flex-1 overflow-y-auto overflow-x-auto no-scrollbar" ref={tableRef}>
            <table className="w-full min-w-[46rem] text-base border-collapse">
              <thead className="bg-gradient-to-b from-gray-100 to-gray-200 border-b-2 border-gray-300 sticky top-0 z-10">
                <tr>
                  <th className="px-2 py-2.5 text-center text-gray-500 font-semibold text-xs uppercase tracking-wider w-8">#</th>
                  <th className={cn("px-2 py-2.5 text-left text-gray-600 font-semibold text-xs uppercase tracking-wider", isUrdu && "urdu-text")}>{t("sales_itemName")}</th>
                  <th className={cn("px-2 py-2.5 text-center text-gray-600 font-semibold text-xs uppercase tracking-wider w-24", isUrdu && "urdu-text")}>{t("sales_unit")}</th>
                  <th className={cn("px-2 py-2.5 text-center text-gray-600 font-semibold text-xs uppercase tracking-wider w-20", isUrdu && "urdu-text")}>{t("sales_qty")}</th>
                  <th className={cn("px-2 py-2.5 text-center text-gray-600 font-semibold text-xs uppercase tracking-wider w-24", isUrdu && "urdu-text")}>{t("sales_rate")}</th>
                  <th className={cn("px-2 py-2.5 text-center text-gray-600 font-semibold text-xs uppercase tracking-wider w-22", isUrdu && "urdu-text")}>{t("sales_disRs")}</th>
                  <th className={cn("px-2 py-2.5 text-center text-gray-600 font-semibold text-xs uppercase tracking-wider w-20", isUrdu && "urdu-text")}>{t("sales_disPct")}</th>
                  <th className={cn("px-2 py-2.5 text-right pr-3 text-gray-600 font-semibold text-xs uppercase tracking-wider w-24", isUrdu && "urdu-text")}>{t("amount")}</th>
                  <th className={cn("px-2 py-2.5 text-center text-gray-600 font-semibold text-xs uppercase tracking-wider w-20", isUrdu && "urdu-text")}>{t("type")}</th>
                  <th className={cn("px-2 py-2.5 text-center text-gray-600 font-semibold text-xs uppercase tracking-wider w-12", isUrdu && "urdu-text")}>{t("sales_del")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {lines.map((line, idx) => {
                  const isEmpty = line.itemId === "";
                  const rowBg = line.isReturn ? "bg-red-50/70" : isEmpty
                    ? (idx % 2 === 0 ? "bg-white" : "bg-gray-50/60")
                    : (idx % 2 === 0 ? "bg-white" : "bg-gray-50");
                  return (
                    <tr key={line.id} className={`${rowBg} transition-colors hover:bg-teal-50/60`} onClick={(e) => e.stopPropagation()}>
                      {/* A left accent bar makes a return row unmistakable at a glance */}
                      <td className={`px-2 py-1.5 text-sm text-center border-l-[3px] ${
                        line.isReturn ? "border-l-red-500 text-red-500 font-semibold" : "border-l-transparent text-gray-400"
                      }`}>{idx + 1}</td>

                      {/* Item Name — triggers search popup */}
                      <td className="px-1 py-1.5">
                        <input
                          type="text"
                          ref={(el) => setInputRef(line.id, el)}
                          value={line.itemName}
                          placeholder={t("sales_searchItemPlaceholder")}
                          onChange={(e) => {
                            updateRow(line.id, { itemName: e.target.value, itemId: "" });
                            openRowSearch(line.id, e.target.value, e.target as HTMLInputElement);
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (line.itemName) openRowSearch(line.id, line.itemName, e.target as HTMLInputElement);
                          }}
                          onKeyDown={(e) => {
                            if (e.key.length === 1) noteRowKey(line.id, e.key);
                            const hasResults = searchRowId === line.id && searchResults.length > 0;
                            if (e.key === "ArrowDown" && hasResults) {
                              e.preventDefault();
                              setActiveSearchIndex((i) => Math.min(i + 1, searchResults.length - 1));
                              return;
                            }
                            if (e.key === "ArrowUp" && hasResults) {
                              e.preventDefault();
                              setActiveSearchIndex((i) => Math.max(i - 1, 0));
                              return;
                            }
                            // Most scanners send Enter after the code; some send Tab.
                            if (e.key !== "Enter" && e.key !== "Tab") return;
                            const typed = e.currentTarget.value.trim();
                            const isScan = typed.length > 0 && wasRowScan(line.id, typed);
                            // Tab is only intercepted when a scanner sent it — otherwise
                            // it has to keep moving focus the way the operator expects.
                            if (e.key === "Tab" && !isScan) return;
                            e.preventDefault();
                            // An exact barcode among the loaded results wins outright —
                            // never let a partial name match stand in for the code in
                            // the operator's hand.
                            const exact = hasResults
                              ? searchResults.find((r) => matchesBarcode(r, typed))
                              : undefined;
                            if (exact) { pickItemForRow(line.id, exact); return; }
                            // A scanner beats the 250ms debounce every time, so there are
                            // usually no results yet. Hand the code to the scanner, which
                            // also owns the "not recognised" flow.
                            if (isScan) {
                              updateRow(line.id, { itemName: "", itemId: "" });
                              closeSearch();
                              scannerRef.current?.scan(typed, line.id);
                              return;
                            }
                            if (hasResults) pickItemForRow(line.id, searchResults[activeSearchIndex]);
                          }}
                          className={`w-full border rounded px-2 py-1.5 text-base focus:outline-none focus:ring-1 focus:ring-teal-400 ${
                            searchRowId === line.id ? "border-teal-400 bg-teal-50" : "border-transparent bg-transparent hover:border-gray-200 focus:border-teal-400 focus:bg-white"
                          } ${!isEmpty ? "font-medium text-gray-800" : "text-gray-400"}`}
                        />
                      </td>

                      {/* Unit — fixed, not chosen.
                          It used to be a free PCS/GAZ/MTR dropdown that changed
                          nothing: the rate stayed the catalog rate and stock
                          moved by the raw quantity, so picking MTR on a GAZ
                          item charged the gaz price and took a gaz off the
                          shelf. The unit is settled once, at the GRN, where the
                          goods are converted into the unit they will be sold in
                          (see lib/units.ts) — by the time an item reaches the
                          till there is nothing left to decide. */}
                      <td className="px-1 py-1.5">
                        <div className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1.5 text-center text-sm font-semibold tracking-wide text-gray-600">
                          {isEmpty ? "—" : line.unit}
                        </div>
                      </td>

                      {/* Qty */}
                      <td className="px-1 py-1.5">
                        {/* step=1 so the spinner arrows count 1, 2, 3. A fractional
                            qty (2.5 gaz) is still typed in freely — `step` governs the
                            arrows and HTML validity, never what may be entered, and
                            these fields sit outside any <form> so validity is inert.
                            `transform` is the real limit: it caps at what is on the
                            shelf and snaps the box, so a quantity that cannot be
                            sold can never sit in the field looking accepted. */}
                        <NumberInput value={line.qty} placeholder="0" blankZero
                          min={0} step={1}
                          transform={(v) => capQty(line, v)}
                          onChange={(v) => updateRow(line.id, { qty: v })}
                          className="w-full border border-transparent hover:border-gray-200 focus:border-teal-400 rounded px-2 py-1.5 text-base text-center bg-transparent focus:outline-none focus:bg-white"
                        />
                        {/* One suit of this cloth (4.5 m cotton, 4 m wash & wear,
                            converted if the item is sold by the gaz). The first
                            click sets the quantity to one suit; while it still
                            holds whole suits, each further click adds another. */}
                        {!isEmpty && (() => {
                          const suit = suitQty(line.clothType, line.unit, unitCfg);
                          if (!suit) return null;
                          return (
                            <button type="button" tabIndex={-1}
                              title={`${t("sales_suit")} = ${formatQty(suit)} ${line.unit}`}
                              onClick={() => {
                                const n = line.qty / suit;
                                const wholeSuits = line.qty > 0 && Math.abs(n - Math.round(n)) < 1e-6;
                                const next = wholeSuits ? line.qty + suit : suit;
                                updateRow(line.id, { qty: capQty(line, Number(next.toFixed(4))) });
                              }}
                              className={cn("mx-auto mt-0.5 block rounded border border-teal-300 bg-teal-50 px-2 py-0.5 text-[10px] font-semibold leading-tight text-teal-700 hover:bg-teal-100", isUrdu && "urdu-text")}
                            >
                              {t("sales_suit")} {formatQty(suit)}
                            </button>
                          );
                        })()}
                        {/* Turns red at the cap, which is why no toast is needed:
                            the box stops moving and the reason is right under it. */}
                        {!isEmpty && !line.isReturn && (() => {
                          const avail = availableFor(line, lines);
                          const atCap = line.qty >= avail;
                          return (
                            <div className={cn(
                              "mt-0.5 text-center text-[10px] leading-tight",
                              atCap ? "font-semibold text-red-500" : "text-gray-400",
                              isUrdu && "urdu-text"
                            )}>
                              {t("sales_available")}: {formatQty(avail)} {line.unit}
                            </div>
                          );
                        })()}
                      </td>

                      {/* Rate */}
                      <td className="px-1 py-1.5">
                        <NumberInput value={line.rate} placeholder="0" blankZero
                          step={1}
                          onChange={(v) => updateRow(line.id, { rate: v })}
                          disabled={!canDo("OVERRIDE_SALE_PRICE")}
                          className="w-full border border-transparent hover:border-gray-200 focus:border-teal-400 rounded px-2 py-1.5 text-base text-right bg-transparent focus:outline-none focus:bg-white disabled:bg-gray-50 disabled:text-gray-500"
                        />
                      </td>

                      {/* Dis RS */}
                      <td className="px-1 py-1.5">
                        <NumberInput value={line.disRS} placeholder="0" blankZero
                          step={1}
                          onChange={(v) => updateRow(line.id, { disRS: v })}
                          disabled={!canDo("APPLY_ITEM_DISCOUNT")}
                          className="w-full border border-transparent hover:border-gray-200 focus:border-teal-400 rounded px-2 py-1.5 text-base text-right bg-transparent focus:outline-none focus:bg-white disabled:bg-gray-50 disabled:text-gray-500"
                        />
                      </td>

                      {/* Dis % */}
                      <td className="px-1 py-1.5">
                        <NumberInput value={line.disPct} placeholder="0" blankZero
                          step={1}
                          onChange={(v) => updateRow(line.id, { disPct: v })}
                          disabled={!canDo("APPLY_ITEM_DISCOUNT")}
                          className="w-full border border-transparent hover:border-gray-200 focus:border-teal-400 rounded px-2 py-1.5 text-base text-right bg-transparent focus:outline-none focus:bg-white disabled:bg-gray-50 disabled:text-gray-500"
                        />
                      </td>

                      {/* Amount (read-only) */}
                      <td className="px-1 py-1.5 text-right">
                        <span className={`px-2 text-base font-semibold ${isEmpty ? "text-gray-300" : lineBelowCost(line) ? "text-red-600" : "text-gray-800"}`}>
                          {isEmpty ? "" : formatCurrency(line.amount)}
                        </span>
                        {lineBelowCost(line) && (
                          <div className={cn("mt-0.5 flex items-center justify-end gap-0.5 px-2 text-[10px] font-semibold leading-tight text-red-500", isUrdu && "urdu-text")}>
                            <AlertTriangle className="w-3 h-3" /> {t("sales_belowCost")}
                          </div>
                        )}
                      </td>

                      {/* Type — a two-state segmented pill reads faster than a stacked
                          radio pair and takes one row instead of two */}
                      <td className="px-1 py-1.5">
                        <div className="mx-auto flex w-fit overflow-hidden rounded-md border border-gray-200 bg-gray-100">
                          <button type="button"
                            onClick={() => updateRow(line.id, { isReturn: false })}
                            title={t("sales_typeSale")}
                            aria-pressed={!line.isReturn}
                            className={`w-7 py-1 text-xs font-bold transition-colors ${
                              !line.isReturn ? "bg-green-600 text-white shadow-sm" : "text-gray-400 hover:bg-white hover:text-green-600"
                            }`}>S</button>
                          <button type="button"
                            onClick={() => updateRow(line.id, { isReturn: true })}
                            title={t("sales_typeReturn")}
                            aria-pressed={line.isReturn}
                            className={`w-7 py-1 text-xs font-bold transition-colors border-l border-gray-200 ${
                              line.isReturn ? "bg-red-600 text-white shadow-sm" : "text-gray-400 hover:bg-white hover:text-red-600"
                            }`}>R</button>
                        </div>
                      </td>

                      {/* Delete */}
                      <td className="px-1 py-1.5 text-center">
                        <button onClick={() => removeRow(line.id)}
                          title={t("sales_delete")}
                          className="mx-auto flex h-7 w-7 items-center justify-center rounded-md text-gray-300 transition-colors hover:bg-red-50 hover:text-red-600">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Add Row + scan target */}
            <div className="px-3 py-2.5 bg-gray-50 border-t border-gray-100 flex items-center gap-3 flex-wrap">
              <button onClick={addRow}
                className="text-base bg-gray-200 hover:bg-gray-300 text-gray-700 font-medium px-4 py-2 rounded flex items-center gap-1.5">
                <Plus className="w-5 h-5" /> <span className={isUrdu ? "urdu-text" : undefined}>{t("sales_addRow")}</span>
              </button>
              <BarcodeScanner
                ref={scannerRef}
                branchId={branchId}
                onItem={addScannedItem}
                defaultUnit="GAZ"
                globalCapture
                className="ml-auto"
                inputClassName="w-64 text-sm py-1.5"
              />
            </div>
          </div>

          {/* Bottom Action Buttons */}
          <div className="bg-white border-t border-gray-200 px-2 py-1.5 flex items-center gap-1.5 shrink-0 flex-nowrap overflow-x-auto no-scrollbar">
            <button onClick={handleNewClick} title={`${t("sales_new")} (Ctrl+I)`}
              className="bg-blue-500 hover:bg-blue-600 text-white text-xs px-2.5 py-1.5 rounded-md flex items-center gap-1 font-semibold whitespace-nowrap shrink-0">
              <Plus className="w-4 h-4" /> <span className={isUrdu ? "urdu-text" : undefined}>{t("sales_new")}</span> <Kbd>^I</Kbd>
            </button>
            <button onClick={() => saveInvoice()} disabled={saving} title={`${t("sales_checkout")} (Ctrl+S)`}
              className="bg-green-600 hover:bg-green-700 text-white text-xs px-2.5 py-1.5 rounded-md flex items-center gap-1 font-semibold whitespace-nowrap shrink-0 disabled:opacity-60">
              <Save className="w-4 h-4" /> <span className={isUrdu ? "urdu-text" : undefined}>{saving ? t("sales_saving") : t("sales_checkout")}</span> <Kbd>^S</Kbd>
            </button>
            <button onClick={printReceipt} title={`${t("sales_print")} (Ctrl+P)`}
              className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-2.5 py-1.5 rounded-md flex items-center gap-1 font-semibold whitespace-nowrap shrink-0">
              <Printer className="w-4 h-4" /> <span className={isUrdu ? "urdu-text" : undefined}>{t("sales_print")}</span> <Kbd>^P</Kbd>
            </button>
            <button onClick={() => setShowHeld(true)} title={`${t("sales_resume")} (F8)`}
              className="bg-yellow-500 hover:bg-yellow-600 text-white text-xs px-2.5 py-1.5 rounded-md flex items-center gap-1 font-semibold whitespace-nowrap shrink-0">
              <PlayCircle className="w-4 h-4" /> <span className={isUrdu ? "urdu-text" : undefined}>{t("sales_resume")}</span>
              {heldInvoices.length > 0 && (
                <span className="rounded-full bg-white/90 px-1.5 text-[10px] font-bold leading-tight text-yellow-700">{heldInvoices.length}</span>
              )}
              <Kbd>F8</Kbd>
            </button>
            <div className="flex gap-1.5 ml-auto shrink-0">
              <button onClick={openAddItem} title={`${t("sales_addItem")} (F11)`}
                className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-2.5 py-1.5 rounded-md flex items-center gap-1 font-semibold whitespace-nowrap">
                <PackagePlus className="w-4 h-4" /> <span className={isUrdu ? "urdu-text" : undefined}>{t("sales_addItem")}</span> <Kbd>F11</Kbd>
              </button>
              <button onClick={openAddParty} title={`${t("sales_addCustomer")} (F12)`}
                className="text-xs bg-cyan-600 hover:bg-cyan-700 text-white px-2.5 py-1.5 rounded-md flex items-center gap-1 font-semibold whitespace-nowrap">
                <UserPlus className="w-4 h-4" /> <span className={isUrdu ? "urdu-text" : undefined}>{t("sales_addCustomer")}</span> <Kbd>F12</Kbd>
              </button>
            </div>
            <div className="text-orange-600 text-sm font-bold shrink-0 pl-1">{invoiceNo || "—"}</div>
          </div>
        </div>

        {/* Right: Totals Panel — dark theme, wider, no inner scrollbar */}
        <div className="w-full lg:w-[28rem] bg-gray-900 border-t lg:border-t-0 lg:border-l border-gray-800 text-gray-200 flex flex-col shrink-0">
          {/* Unit sold + Returns — combined into one compact block, columns aligned via shared grid template */}
          <div className="bg-gray-800 px-4 py-2 border-b border-gray-700">
            <div className="grid grid-cols-[3.5rem_1fr_1fr_1fr] gap-1">
              <span></span>
              <span className="text-teal-400/70 text-xs font-semibold tracking-wide text-center">PCS</span>
              <span className="text-teal-400/70 text-xs font-semibold tracking-wide text-center">GAZ</span>
              <span className="text-teal-400/70 text-xs font-semibold tracking-wide text-center">MTR</span>
            </div>
            <div className="grid grid-cols-[3.5rem_1fr_1fr_1fr] gap-1">
              <span></span>
              <span className="text-teal-400 font-bold text-lg text-center">{totals.soldPcs.toFixed(2)}</span>
              <span className="text-teal-400 font-bold text-lg text-center">{totals.soldGaz.toFixed(2)}</span>
              <span className="text-teal-400 font-bold text-lg text-center">{totals.soldMtr.toFixed(2)}</span>
            </div>
            <div className="grid grid-cols-[3.5rem_1fr_1fr_1fr] gap-1 items-center mt-1 pt-1 border-t border-gray-700">
              <span className={cn("text-gray-400 text-[11px] font-semibold tracking-wide", isUrdu && "urdu-text")}>{t("sales_returns")}</span>
              <span className="text-red-400 font-semibold text-sm text-center">{totals.returnPcs.toFixed(2)}</span>
              <span className="text-red-400 font-semibold text-sm text-center">{totals.returnGaz.toFixed(2)}</span>
              <span className="text-red-400 font-semibold text-sm text-center">{totals.returnMtr.toFixed(2)}</span>
            </div>
          </div>

          {/* Payment Option (Cash / CC — pricing tier) */}
          <div className="bg-gray-800 px-4 py-2 border-b border-gray-700 flex items-center gap-5 flex-wrap">
            <span className={cn("font-semibold text-gray-300 text-sm", isUrdu && "urdu-text")}>{t("sales_partyOptionLabel")}</span>
            {(["CASH", "CC"] as const).map((opt) => (
              <label key={opt} className="flex items-center gap-1.5 cursor-pointer text-gray-300 text-sm font-medium">
                <input type="radio" name="partyOption" checked={partyOption === opt}
                  onChange={() => setPartyOption(opt)} className="accent-teal-600 w-4 h-4" />
                {opt === "CASH" ? t("sales_paymentOptionCash") : t("sales_paymentOptionCC")}
              </label>
            ))}
          </div>

          {/* Financial totals */}
          <div className="flex-1 px-4 py-2 space-y-1.5 overflow-y-auto no-scrollbar">
            <TotalRow label={t("sales_grossSale")} value={totals.grossSale} isUrdu={isUrdu} />

            <div className="flex items-center justify-between">
              <span className={cn("text-gray-400 text-base", isUrdu && "urdu-text")}>{t("sales_packageDis")}</span>
              <NumberInput value={packageDiscount}
                onChange={setPackageDiscount}
                disabled={!canDo("APPLY_PACKAGE_DISCOUNT")}
                className="w-28 bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-right text-teal-400 text-base font-medium focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-teal-400 disabled:opacity-50" />
            </div>

            <TotalRow label={t("sales_sale")} value={totals.saleAmount} isUrdu={isUrdu} />
            <TotalRow label={t("sales_return")} value={totals.returnAmount} className="text-red-400" isUrdu={isUrdu} />

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={cn("text-gray-400 text-base", isUrdu && "urdu-text")}>{t("sales_adjust")}</span>
                <button onClick={() => setAdjustType((prev) => (prev === "add" ? "sub" : "add"))}
                  className={cn(`text-sm px-2 py-0.5 rounded font-bold ${adjustType === "add" ? "bg-green-900/40 text-green-400" : "bg-red-900/40 text-red-400"}`, isUrdu && "urdu-text")}>
                  {adjustType === "add" ? t("sales_add") : t("sales_sub")}
                </button>
              </div>
              <NumberInput value={adjustment}
                onChange={setAdjustment}
                className="w-28 bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-right text-teal-400 text-base font-medium focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-teal-400" />
            </div>

            <TotalRow label={t("sales_slipAmount")} value={totals.slipAmount} highlight isUrdu={isUrdu} />

            <div className="flex items-center justify-between">
              <span className={cn("text-gray-400 text-base", isUrdu && "urdu-text")}>{t("sales_courier")}</span>
              <NumberInput value={courierCharges}
                onChange={setCourierCharges}
                className="w-28 bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-right text-teal-400 text-base font-medium focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-teal-400" />
            </div>

            {/* Net Bill — the number everyone looks at, made unmistakably prominent.
                A net-return invoice (more returned than sold) flips this to a red
                "Refund Due" callout showing the amount the store owes the customer. */}
            <div className={cn(
              "border-2 rounded-xl px-3 py-2 mt-1 flex items-center justify-between shadow-sm",
              totals.isRefund ? "bg-red-600 border-red-700" : "bg-teal-600 border-teal-700"
            )}>
              <span className={cn("text-teal-50 text-lg font-bold", isUrdu && "urdu-text")}>
                {totals.isRefund ? t("sales_refundDue") : t("sales_netBill")}
              </span>
              <span className="text-white text-3xl font-extrabold tracking-tight">
                Rs. {formatCurrency(Math.abs(totals.netBill))}
              </span>
            </div>

            {/* Store credit — only for an identified customer who is actually
                holding credit (a negative live balance), and only against a
                bill there is something to reduce. The amount typed is clamped
                by calculateInvoiceTotals and re-checked server-side on save. */}
            {canApplyCredit && (
              <div className="border border-purple-700 bg-purple-900/25 rounded-lg px-3 py-2 mt-1 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className={cn("text-purple-200 text-sm font-medium", isUrdu && "urdu-text")}>{t("sales_creditAvailable")}</span>
                  <span className="text-purple-300 text-base font-bold">
                    Rs. {formatCurrency(partyBalance?.availableCredit ?? 0)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className={cn("text-gray-200 text-base font-semibold", isUrdu && "urdu-text")}>{t("sales_creditApplied")}</span>
                  <div className="flex items-center gap-1.5">
                    <button type="button" onClick={() => setCreditApplied(maxCreditApplicable)}
                      className={cn("text-xs px-2 py-1 rounded font-bold bg-purple-800 text-purple-100 hover:bg-purple-700", isUrdu && "urdu-text")}>
                      {t("sales_creditUseMax")}
                    </button>
                    {/* Clamped to what the customer holds so a doomed amount
                        can't be typed at all; calculateInvoiceTotals clamps the
                        remaining case (credit above the bill itself), and the
                        server guard stays the actual defence either way. */}
                    <NumberInput value={creditApplied}
                      transform={(v) => Math.min(Math.max(0, v), partyBalance?.availableCredit ?? 0)}
                      onChange={setCreditApplied}
                      className="w-24 bg-gray-800 border-2 border-purple-500 rounded-md px-2 py-1.5 text-right text-purple-300 text-lg font-bold focus:outline-none focus:ring-2 focus:ring-purple-400" />
                  </div>
                </div>
                {creditApplied > maxCreditApplicable && (
                  <p className={cn("text-amber-400 text-xs", isUrdu && "urdu-text")}>
                    {t("sales_creditCappedAt")} Rs. {formatCurrency(maxCreditApplicable)}
                  </p>
                )}
                <div className="flex items-center justify-between border-t border-purple-800 pt-1.5">
                  <span className={cn("text-gray-200 text-base font-bold", isUrdu && "urdu-text")}>{t("sales_amountDue")}</span>
                  <span className="text-white text-xl font-extrabold">Rs. {formatCurrency(totals.amountDue)}</span>
                </div>
              </div>
            )}

            <div className="border-t border-gray-700 pt-2 mt-1 space-y-1.5">
              {/* Payment Method — decides which of Cash Amt / Bank Amt appear below */}
              <div className="flex items-center gap-4 flex-wrap py-1">
                <span className={cn("text-gray-400 text-sm font-medium", isUrdu && "urdu-text")}>{t("sales_paymentMethodLabel")}</span>
                {([
                  ["CASH", "sales_paymentMethodCash"],
                  ["BANK", "sales_paymentMethodBank"],
                  ["CASH_AND_BANK", "sales_paymentMethodBoth"],
                ] as const).map(([opt, key]) => (
                  <label key={opt} className="flex items-center gap-1.5 cursor-pointer text-gray-300 text-sm font-medium">
                    <input type="radio" name="paymentMethod" checked={paymentMethod === opt}
                      onChange={() => changePaymentMethod(opt)} className="accent-teal-600 w-4 h-4" />
                    {t(key)}
                  </label>
                ))}
              </div>

              <div className="flex items-center justify-between">
                <span className={cn("text-gray-400 text-base", isUrdu && "urdu-text")}>{t("sales_cardAmt")}</span>
                <NumberInput value={cardAmount}
                  onChange={setCardAmount}
                  className="w-28 bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-right text-teal-400 text-base font-medium focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-teal-400" />
              </div>

              {(paymentMethod === "CASH" || paymentMethod === "CASH_AND_BANK") && (
                <div className="flex items-center justify-between">
                  <span className={cn("text-gray-200 text-base font-semibold", isUrdu && "urdu-text")}>
                    {totals.isRefund ? t("sales_refundCash") : t("sales_amtReceived")}
                  </span>
                  <NumberInput value={cashReceived}
                    onChange={setCashReceived}
                    className="w-28 bg-gray-800 border-2 border-green-500 rounded-md px-2 py-1.5 text-right text-green-400 text-lg font-bold focus:outline-none focus:ring-2 focus:ring-green-400" />
                </div>
              )}

              {(paymentMethod === "BANK" || paymentMethod === "CASH_AND_BANK") && (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn("text-gray-400 text-sm shrink-0", isUrdu && "urdu-text")}>{t("sales_bank")}</span>
                    <select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}
                      className="flex-1 bg-gray-800 border border-gray-700 rounded-md px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-teal-400">
                      <option value="">{t("sales_selectBankPlaceholder")}</option>
                      {accounts.filter((a) => a.type === "BANK").map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                  </div>
                  {accounts.filter((a) => a.type === "BANK").length === 0 && (
                    <p className={cn("text-amber-400 text-xs", isUrdu && "urdu-text")}>{t("sales_noBankAccounts")}</p>
                  )}
                  <div className="flex items-center justify-between">
                    <span className={cn("text-gray-200 text-base font-semibold", isUrdu && "urdu-text")}>
                      {totals.isRefund ? t("sales_refundBank") : t("sales_bankAmt")}
                    </span>
                    <NumberInput value={bankAmount}
                      onChange={setBankAmount}
                      className="w-28 bg-gray-800 border-2 border-blue-500 rounded-md px-2 py-1.5 text-right text-blue-400 text-lg font-bold focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  </div>
                </>
              )}

              <div className={`flex items-center justify-between rounded-lg px-3 py-2 ${totals.change > 0 ? "bg-green-900/30 border border-green-700" : "bg-gray-800 border border-gray-700"}`}>
                <span className={cn("text-gray-200 text-lg font-bold", isUrdu && "urdu-text")}>
                  {totals.isRefund ? t("sales_overRefunded") : t("sales_change")}
                </span>
                <span className={`text-2xl font-extrabold ${totals.change > 0 ? "text-green-400" : "text-gray-200"}`}>
                  Rs. {formatCurrency(totals.change)}
                </span>
              </div>

              {/* What the drawer actually keeps once change is handed back. The
                  input above is the tender, so without this the cashier has no
                  way to see the figure the invoice and the reports will hold. */}
              {!totals.isRefund && totals.change > 0 && cashReceived > 0 && (
                <div className="flex items-center justify-between px-3">
                  <span className={cn("text-gray-400 text-sm", isUrdu && "urdu-text")}>{t("sales_cashKept")}</span>
                  <span className="text-gray-300 text-base font-semibold">Rs. {formatCurrency(totals.cashKept)}</span>
                </div>
              )}

              {/* Repayment plan - only meaningful while something is still owed
                  after credit and counter payments. Choosing anything but None
                  makes the server generate a due-dated installment schedule for
                  exactly that outstanding amount. */}
              {outstandingAfterPayment > 0 && (
                <div className="border border-amber-700 bg-amber-900/20 rounded-lg px-3 py-2 mt-1 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className={cn("text-amber-200 text-sm font-medium", isUrdu && "urdu-text")}>{t("sales_balanceOwed")}</span>
                    <span className="text-amber-300 text-base font-bold">Rs. {formatCurrency(outstandingAfterPayment)}</span>
                  </div>

                  <div className="flex items-center gap-3 flex-wrap">
                    <span className={cn("text-gray-400 text-sm font-medium", isUrdu && "urdu-text")}>{t("sales_repaymentLabel")}</span>
                    {([
                      ["NONE", "sales_repaymentNone"],
                      ["PROMISE_DAY", "sales_repaymentPromiseDay"],
                      ["WEEKLY", "sales_repaymentWeekly"],
                      ["MONTHLY", "sales_repaymentMonthly"],
                    ] as const).map(([opt, key]) => (
                      <label key={opt} className="flex items-center gap-1.5 cursor-pointer text-gray-300 text-sm font-medium">
                        <input type="radio" name="repaymentType" checked={repaymentType === opt}
                          onChange={() => changeRepaymentType(opt)} className="accent-amber-500 w-4 h-4" />
                        {t(key)}
                      </label>
                    ))}
                  </div>

                  {(effectiveRepaymentType === "WEEKLY" || effectiveRepaymentType === "MONTHLY") && (
                    <div className="flex items-center justify-between">
                      <span className={cn("text-gray-200 text-base font-semibold", isUrdu && "urdu-text")}>{t("sales_installmentCount")}</span>
                      <input type="number" min={1} value={installmentPeriods}
                        onChange={(e) => setInstallmentPeriods(e.target.value ? Math.max(1, Number(e.target.value)) : "")}
                        className="w-24 bg-gray-800 border-2 border-amber-500 rounded-md px-2 py-1.5 text-right text-amber-300 text-lg font-bold focus:outline-none focus:ring-2 focus:ring-amber-400" />
                    </div>
                  )}

                  {effectiveRepaymentType === "PROMISE_DAY" && (
                    <div className="flex items-center justify-between">
                      <span className={cn("text-gray-200 text-base font-semibold", isUrdu && "urdu-text")}>{t("sales_promiseDays")}</span>
                      <input type="number" min={1} value={promiseDays} placeholder={t("sales_days")}
                        onChange={(e) => setPromiseDays(e.target.value ? Number(e.target.value) : "")}
                        className="w-24 bg-gray-800 border-2 border-amber-500 rounded-md px-2 py-1.5 text-right text-amber-300 text-lg font-bold focus:outline-none focus:ring-2 focus:ring-amber-400" />
                    </div>
                  )}

                  {needsPromiseDays && (
                    <p className={cn("text-amber-400 text-xs", isUrdu && "urdu-text")}>{t("sales_promiseDaysRequired")}</p>
                  )}

                  {schedulePreview.length > 0 && (
                    <p className="text-amber-200/80 text-xs">
                      {schedulePreview.length} x Rs. {formatCurrency(schedulePreview[0].amount)}
                      {" - "}
                      {t("sales_firstDue")} {formatDate(schedulePreview[0].dueDate)}
                      {schedulePreview.length > 1 && `, ${t("sales_lastDue")} ${formatDate(schedulePreview[schedulePreview.length - 1].dueDate)}`}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Second Save, immediately under the payment fields. The toolbar
                copy at the bottom of the screen stays — this one is where the
                cashier's eyes and cursor already are after typing the cash. */}
            <button onClick={() => saveInvoice()} disabled={saving} title={`${t("sales_checkout")} (Ctrl+S)`}
              className="mt-2 w-full bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white rounded-lg py-2.5 flex items-center justify-center gap-2 text-base font-bold shadow-sm">
              <Save className="w-5 h-5" />
              <span className={isUrdu ? "urdu-text" : undefined}>{saving ? t("sales_saving") : t("sales_checkout")}</span>
              <Kbd>^S</Kbd>
            </button>

            <div className="border-t border-gray-700 pt-2 mt-1 flex justify-between gap-4">
              <div className="flex justify-between flex-1">
                <span className={cn("text-gray-400 text-base", isUrdu && "urdu-text")}>{t("sales_scanned")}</span>
                <span className="text-teal-400 text-base font-semibold">{filledLines.length}</span>
              </div>
              <div className="flex justify-between flex-1">
                <span className={cn("text-gray-400 text-base", isUrdu && "urdu-text")}>{t("sales_balQty")}</span>
                <span className="text-orange-400 text-base font-semibold">
                  {filledLines.reduce((s, l) => s + (l.isReturn ? -l.qty : l.qty), 0).toFixed(2)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Item Search Popup ── */}
      {searchRowId && searchResults.length > 0 && searchPopupPos && (
        <div
          className="fixed z-[100] bg-white border border-gray-200 rounded-xl shadow-2xl overflow-hidden"
          style={{ top: searchPopupPos.top, left: searchPopupPos.left, width: searchPopupPos.width, maxHeight: 280 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="bg-teal-700 text-white px-3 py-1.5 text-sm font-semibold flex justify-between items-center">
            <span className={isUrdu ? "urdu-text" : undefined}>{t("sales_itemSearchResults")}</span>
            <button onClick={closeSearch}><X className="w-4 h-4" /></button>
          </div>
          <div className="overflow-y-auto no-scrollbar" style={{ maxHeight: 236 }}>
            {searchResults.map((item, idx) => (
              <div key={item.id}
                ref={(el) => { if (idx === activeSearchIndex) el?.scrollIntoView({ block: "nearest" }); }}
                className={cn(
                  "px-3 py-2 cursor-pointer border-b border-gray-50 last:border-0 flex justify-between items-center",
                  idx === activeSearchIndex ? "bg-teal-100" : "hover:bg-teal-50"
                )}
                onClick={() => pickItemForRow(searchRowId, item)}
                onMouseEnter={() => setActiveSearchIndex(idx)}
              >
                <div>
                  <div className="font-semibold text-gray-800 text-sm">{item.name}</div>
                  {(() => {
                    const stock = formatStock(item.currentStock, item, unitCfg);
                    return (
                      <div className={cn("text-xs", isUrdu && "urdu-text")}>
                        <span className={item.currentStock > 0 ? "text-gray-400" : "text-red-400 font-semibold"}>
                          {t("sales_stock")}: {stock.primary}
                        </span>
                        {/* Only ever present when the item is bought in a
                            different unit from the one it sells in — the shelf
                            label and the vendor's bill then read differently,
                            and this is what reconciles them. */}
                        {stock.secondary && (
                          <span className="text-gray-300"> · {t("sales_boughtAs")} {stock.secondary}</span>
                        )}
                      </div>
                    );
                  })()}
                </div>
                <div className="text-right">
                  <div className="text-teal-700 font-bold text-sm">
                    Rs. {formatCurrency(priceForPartyOption(partyOption, item.salePrice, item.altSalePrice))}
                  </div>
                  {partyOption !== "CASH" && item.altSalePrice != null && (
                    <div className="text-gray-400 text-[11px] line-through">Rs. {formatCurrency(item.salePrice)}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Party Search Modal */}
      {showPartySearch && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-[580px] max-h-[70vh] flex flex-col">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <h3 className={cn("font-semibold text-gray-800 text-base", isUrdu && "urdu-text")}>{t("sales_selectParty")}</h3>
              <button onClick={() => setShowPartySearch(false)} className="text-gray-400 hover:text-gray-600 text-lg">✕</button>
            </div>
            <div className="px-4 py-2 border-b">
              <input autoFocus type="text" value={partyQuery}
                onChange={(e) => setPartyQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (parties.length === 0) return;
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActivePartyIndex((i) => Math.min(i + 1, parties.length - 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActivePartyIndex((i) => Math.max(i - 1, 0));
                  } else if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
                    e.preventDefault();
                    selectParty(parties[activePartyIndex]);
                  }
                }}
                placeholder={t("sales_searchPartyPlaceholder")}
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
            </div>
            {!partyQuery && parties.length > 0 && (
              <div className={cn("px-4 pt-2 text-xs font-semibold text-gray-400 uppercase tracking-wide", isUrdu && "urdu-text")}>
                {t("sales_recentCustomers")}
              </div>
            )}
            <div className="overflow-y-auto no-scrollbar flex-1">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className={cn("px-3 py-2 text-left text-gray-500", isUrdu && "urdu-text")}>{t("sales_id")}</th>
                    <th className={cn("px-3 py-2 text-left text-gray-500", isUrdu && "urdu-text")}>{t("name")}</th>
                    <th className={cn("px-3 py-2 text-left text-gray-500", isUrdu && "urdu-text")}>{t("sales_city")}</th>
                    <th className={cn("px-3 py-2 text-right text-gray-500", isUrdu && "urdu-text")}>{t("sales_phoneNo")}</th>
                    <th className={cn("px-3 py-2 text-right text-gray-500", isUrdu && "urdu-text")}>{t("sales_mobileNo")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {parties.map((p, idx) => (
                    <tr key={p.id}
                      ref={(el) => { if (idx === activePartyIndex) el?.scrollIntoView({ block: "nearest" }); }}
                      className={cn("cursor-pointer", idx === activePartyIndex ? "bg-teal-100" : "hover:bg-teal-50")}
                      onClick={() => selectParty(p)}
                      onMouseEnter={() => setActivePartyIndex(idx)}>
                      <td className="px-3 py-2 text-gray-500">{p.accountId}</td>
                      <td className="px-3 py-2 font-medium text-gray-800">{p.name}</td>
                      <td className="px-3 py-2 text-gray-600">{p.city ?? "—"}</td>
                      <td className="px-3 py-2 text-right text-gray-600">{p.phone ?? "—"}</td>
                      <td className="px-3 py-2 text-right text-gray-600">{p.mobile ?? "—"}</td>
                    </tr>
                  ))}
                  {parties.length === 0 && (
                    <tr><td colSpan={5} className={cn("text-center text-gray-400 py-6", isUrdu && "urdu-text")}>{t("sales_noPartiesFound")}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Held Invoices Modal */}
      {showHeld && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-[660px] max-w-full max-h-[70vh] flex flex-col">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <h3 className={cn("font-semibold text-gray-800 text-base", isUrdu && "urdu-text")}>{t("dash_heldInvoices")} (F8 — {t("sales_resume")})</h3>
              <button onClick={() => setShowHeld(false)} className="text-gray-400 hover:text-gray-600 text-lg">✕</button>
            </div>
            <div className="overflow-y-auto no-scrollbar flex-1">
              {heldInvoices.length === 0 ? (
                <p className={cn("text-center text-gray-400 py-8 text-sm", isUrdu && "urdu-text")}>{t("sales_noHeldInvoices")}</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className={cn("px-3 py-2 text-left", isUrdu && "urdu-text")}>{t("sales_invoiceNoLabel")}</th>
                      <th className={cn("px-3 py-2 text-left", isUrdu && "urdu-text")}>{t("sales_party")}</th>
                      <th className={cn("px-3 py-2 text-left", isUrdu && "urdu-text")}>{t("items")}</th>
                      <th className={cn("px-3 py-2 text-left", isUrdu && "urdu-text")}>{t("sales_heldAt")}</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {heldInvoices.map((h) => (
                      <tr key={h.id} className="hover:bg-teal-50">
                        <td className="px-3 py-2 font-medium whitespace-nowrap align-top">#{h.invoiceNo}</td>
                        <td className="px-3 py-2 align-top">{h.party?.name ?? "—"}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-start gap-2">
                            <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600">
                              {h.lines?.length ?? 0}
                            </span>
                            {/* Clamped to two lines so a long basket can't push the
                                row out of the dialog; the full list is on the tooltip. */}
                            <span className="line-clamp-2 text-xs text-gray-600" title={heldItemSummary(h)}>
                              {heldItemSummary(h)}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-gray-400 whitespace-nowrap align-top">{formatTime(h.heldAt)}</td>
                        <td className="px-3 py-2 align-top">
                          <div className="flex items-center justify-end gap-1.5">
                            <button onClick={() => recallInvoice(h)}
                              className="bg-teal-600 text-white px-2 py-1 rounded text-xs hover:bg-teal-700">
                              <span className={isUrdu ? "urdu-text" : undefined}>{t("sales_resume")}</span>
                            </button>
                            <button onClick={() => deleteHeldInvoice(h)}
                              className="text-red-400 hover:text-red-600 p-1" title={t("sales_delete")}>
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      <ItemFormModal
        open={showAddItem}
        onClose={() => setShowAddItem(false)}
        branchId={branchId}
        defaultUnit="GAZ"
        onSaved={handleItemCreated}
      />

      <PartyFormModal
        open={showAddParty}
        onClose={() => setShowAddParty(false)}
        onSaved={handlePartySaved}
      />

      {/* "New" confirmation — invoice has items, ask before starting a fresh one */}
      {/* A fully-paid Credit-Customer invoice. Switching tier re-prices every
          line, so this confirms the price change and then hands the invoice
          back unsaved — the cashier checks the new Net Bill before saving. */}
      {showSwitchToCash && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
            <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-teal-100 flex items-center justify-center">
              <Banknote className="w-7 h-7 text-teal-600" />
            </div>
            <h3 className={cn("font-bold text-gray-800 text-lg mb-1.5", isUrdu && "urdu-text")}>
              {t("sales_switchToCashTitle")}
            </h3>
            <p className={cn("text-gray-500 text-sm mb-6", isUrdu && "urdu-text")}>
              {t("sales_switchToCashMessage")}
            </p>
            <div className="space-y-2">
              <button
                onClick={confirmSwitchToCash}
                className={cn("w-full px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-semibold", isUrdu && "urdu-text")}
              >
                {t("sales_switchToCashConfirm")}
              </button>
              <button
                onClick={() => setShowSwitchToCash(false)}
                className={cn("w-full px-4 py-2 text-sm font-medium text-gray-400 hover:text-gray-600", isUrdu && "urdu-text")}
              >
                {t("cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* One or more sold lines are under purchase price. The cashier may
          still go ahead; this only makes sure it is deliberate. */}
      {showBelowCost && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
            <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-red-100 flex items-center justify-center">
              <AlertTriangle className="w-7 h-7 text-red-600" />
            </div>
            <h3 className={cn("font-bold text-gray-800 text-lg mb-1.5", isUrdu && "urdu-text")}>
              {t("sales_belowCostTitle")}
            </h3>
            <p className={cn("text-gray-500 text-sm mb-3", isUrdu && "urdu-text")}>
              {t("sales_belowCostMessage")}
            </p>
            <ul className="mb-6 text-sm font-medium text-red-600 space-y-0.5">
              {belowCostLines.map((l) => <li key={l.id}>{l.itemName}</li>)}
            </ul>
            <div className="space-y-2">
              <button
                onClick={() => setShowBelowCost(false)}
                className={cn("w-full px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-semibold", isUrdu && "urdu-text")}
              >
                {t("sales_belowCostReview")}
              </button>
              <button
                onClick={() => saveInvoice(true)}
                disabled={saving}
                className={cn("w-full px-4 py-2 text-sm font-medium text-red-500 hover:text-red-700 disabled:opacity-60", isUrdu && "urdu-text")}
              >
                {t("sales_belowCostSaveAnyway")}
              </button>
            </div>
          </div>
        </div>
      )}

      {showNewConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
            <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center">
              <PauseCircle className="w-7 h-7 text-amber-500" />
            </div>
            <h3 className={cn("font-bold text-gray-800 text-lg mb-1.5", isUrdu && "urdu-text")}>
              {t("sales_confirmNewTitle")}
            </h3>
            <p className={cn("text-gray-500 text-sm mb-6", isUrdu && "urdu-text")}>
              {t("sales_confirmNewMessage")}
            </p>
            <div className="space-y-2">
              <button
                onClick={confirmHoldAndNew}
                className={cn("w-full px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5", isUrdu && "urdu-text")}
              >
                <PauseCircle className="w-4 h-4" /> {t("sales_holdAndNew")}
              </button>
              <button
                onClick={confirmDiscardAndNew}
                className={cn("w-full px-4 py-2.5 border border-red-200 text-red-500 hover:bg-red-50 rounded-lg text-sm font-semibold", isUrdu && "urdu-text")}
              >
                {t("sales_discardAndNew")}
              </button>
              <button
                onClick={() => setShowNewConfirm(false)}
                className={cn("w-full px-4 py-2 text-sm font-medium text-gray-400 hover:text-gray-600", isUrdu && "urdu-text")}
              >
                {t("cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Post-save: print or send the invoice that was just created */}
      {savedInvoice && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
            <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle2 className="w-7 h-7 text-green-600" />
            </div>
            <h3 className={cn("font-bold text-gray-800 text-lg mb-1.5", isUrdu && "urdu-text")}>
              {t("sales_invoiceNoLabel")}{savedInvoice.invoiceNo} {t("sales_invoiceSavedSuffix")}
            </h3>
            <p className={cn("text-gray-500 text-sm mb-5", isUrdu && "urdu-text")}>
              Rs. {formatCurrency(savedInvoice.totals.netBill)} — {savedInvoice.party.name}
            </p>

            <button
              onClick={printReceipt}
              className={cn("w-full mb-3 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center justify-center gap-2", isUrdu && "urdu-text")}
            >
              <Printer className="w-4 h-4" /> {t("sales_printSlip")}
            </button>

            <div className="border-t border-gray-100 pt-4 mt-1">
              <label className={cn("block text-xs font-semibold text-gray-500 mb-1.5 text-left", isUrdu && "urdu-text")}>
                {t("sales_whatsappNumberLabel")}
              </label>
              <input
                type="tel"
                value={waNumber}
                onChange={(e) => setWaNumber(e.target.value)}
                placeholder={t("sales_whatsappNumberPlaceholder")}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-green-400"
              />
              <div className="flex gap-2">
                <button
                  onClick={sendInvoiceWhatsApp}
                  className={cn("flex-1 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5", isUrdu && "urdu-text")}
                >
                  <MessageCircle className="w-4 h-4" /> {t("sales_sendWhatsapp")}
                </button>
                <button
                  onClick={copyInvoiceMessage}
                  className={cn("px-3 py-2.5 border border-gray-300 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50 flex items-center justify-center", isUrdu && "urdu-text")}
                  title={t("sales_copyMessage")}
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
            </div>

            <button
              onClick={() => setSavedInvoice(null)}
              className={cn("w-full mt-5 px-4 py-2 text-sm font-medium text-gray-400 hover:text-gray-600", isUrdu && "urdu-text")}
            >
              {t("sales_done")}
            </button>
          </div>
        </div>
      )}

      {/* ── Receipt — only rendered on paper; the same slip the sales report re-prints ── */}
      <div id="receipt-print" className="hidden print:block">
        <InvoiceReceipt detail={receiptDetail} />
      </div>

      {/* Print stylesheet */}

      <style jsx global>{`
        @media print {
          @page { size: 80mm auto; margin: 3mm; }
          body { font-family: "Courier New", monospace; }
          body * { visibility: hidden; }
          #receipt-print, #receipt-print * { visibility: visible; }
          #receipt-print { position: absolute; top: 0; left: 0; width: 100%; }
        }
      `}</style>
    </div>
  );
}

// ─── Helper component ─────────────────────────────────────────────────────────
// Shortcut hint on an action button. Dropped on the narrowest screens, where
// there is no keyboard to press it with anyway.
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span className="hidden sm:inline rounded bg-black/20 px-1 py-px text-[10px] font-semibold leading-none">
      {children}
    </span>
  );
}

function TotalRow({
  label, value, highlight, bold, className, isUrdu,
}: {
  label: string; value: number; highlight?: boolean; bold?: boolean; className?: string; isUrdu?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between ${highlight ? "border-t border-b border-gray-700 py-1.5 my-0.5" : ""}`}>
      <span className={`text-gray-400 text-base${isUrdu ? " urdu-text" : ""}`}>{label}</span>
      <span className={`${bold ? "font-extrabold text-xl" : "font-semibold text-lg"} ${className ?? "text-teal-400"}`}>
        Rs. {formatCurrency(value)}
      </span>
    </div>
  );
}
