"use client";

import { useState, useEffect, useRef, Fragment } from "react";
import { useSession } from "next-auth/react";
import { useStore } from "@/lib/store-context";
import toast from "react-hot-toast";
import {
  Plus, Trash2, Save, Printer, Search,
  X, Barcode, RefreshCw, AlertTriangle,
  CheckCircle, XCircle, SlidersHorizontal, Package, PackagePlus,
  UserPlus, Edit2, Undo2,
} from "lucide-react";
import { formatCurrency, formatDate, cn, profitPctOf, saleFromProfitPct, shopDateKey, type DateRangePreset } from "@/lib/utils";
import { DATE_PRESETS, applyDatePreset, usePresetLabels } from "@/components/reports/list-ui";
import GrnRecordsTab from "@/components/purchases/GrnRecordsTab";
import { generateInstallmentSchedule, type RepaymentType } from "@/lib/installments";
import { useI18n } from "@/lib/i18n";
import { usePermissions } from "@/lib/permissions-client";
import GRNPrintModal from "@/components/purchases/GRNPrintModal";
import PartyFormModal, { type PartyRecord } from "@/components/parties/PartyFormModal";
import BarcodePrintModal from "@/components/purchases/BarcodePrintModal";
import NumberInput from "@/components/ui/NumberInput";
import Pagination from "@/components/ui/Pagination";
import ItemFormModal from "@/components/items/ItemFormModal";
import BarcodeScanner, { matchesBarcode, normalizeScannedItem, type BarcodeScannerHandle } from "@/components/items/BarcodeScanner";
import { useRowScanFlow } from "@/lib/use-row-scan-flow";
import { useUnitConfig } from "@/lib/use-unit-config";
import {
  convertGrnLine, formatQty, formatStock, isStockUnit, isTxUnit,
  STOCK_UNITS, type StockUnit, type TxUnit,
} from "@/lib/units";

const INV_PAGE_SIZE = 50;

// ─── Types ────────────────────────────────────────────────────────────────────

// The full row, so the selected vendor can go straight into PartyFormModal's
// edit mode.
type Party = PartyRecord;
type Item = {
  id: string; name: string; unit: string;
  purchaseUnit?: string | null; piecesPerBundle?: number | null;
  purchasePrice: number; salePrice: number;
  barcode?: string; systemBarcode?: string; currentStock: number;
};
type GRNLine = {
  id: string; itemId: string; itemName: string; unit: string; barcode?: string; systemBarcode?: string;
  qty: number; costRate: number; saleRate: number; disPct: number;
  amount: number; isReturn: boolean;
  // `buyUnit` is what the vendor bills in, `sellUnit` what the goods will be
  // sold in — and what stock will be held in once this GRN posts. Equal for
  // most lines; the whole conversion exists for when they are not. See
  // lib/units.ts.
  buyUnit: TxUnit; sellUnit: StockUnit; piecesPerBundle: number | null;
};
type Account = {
  id: string; type: "CASH" | "BANK"; name: string; isActive: boolean;
};
type GRNRecord = {
  id: string; grnNo: number; date: string; isReturn?: boolean;
  party: { name: string; accountId: number };
  netBill: number; totalPurchaseQty: number;
};
type InventoryItem = {
  id: string; name: string; unit: string; barcode?: string; systemBarcode: string;
  purchasePrice: number; salePrice: number;
  minLevel: number; qty: number; updatedAt: string | null;
  status: "OK" | "LOW" | "OUT";
};

const EMPTY_LINE = (): GRNLine => ({
  id: `row_${Date.now()}_${Math.random()}`,
  itemId: "", itemName: "", unit: "GAZ", barcode: undefined,
  qty: 0, costRate: 0, saleRate: 0, disPct: 0, amount: 0, isReturn: false,
  buyUnit: "GAZ", sellUnit: "GAZ", piecesPerBundle: null,
});

type GrnMode = "PURCHASE" | "RETURN";

// ─── Component ───────────────────────────────────────────────────────────────

export default function PurchasesPage() {
  const { can } = usePermissions();
  const { data: session } = useSession();
  const { store } = useStore();
  const { t, isUrdu } = useI18n();
  const presetLabels = usePresetLabels();
  const unitCfg = useUnitConfig();
  const branchId = (session?.user as any)?.branchId ?? "";
  const userId = (session?.user as any)?.id ?? "";

  const [activeTab, setActiveTab] = useState<"grn" | "records" | "inventory">("grn");

  // ── GRN State ──────────────────────────────────────────────────────────────
  const [lines, setLines] = useState<GRNLine[]>([EMPTY_LINE()]);
  const [selectedParty, setSelectedParty] = useState<Party | null>(null);
  const [grnNo, setGrnNo] = useState(0);
  const [grnDate, setGrnDate] = useState(new Date());
  const [billNo, setBillNo] = useState("");
  const [remarks, setRemarks] = useState("");
  const [discountPct, setDiscountPct] = useState(0);
  const [adjustment, setAdjustment] = useState(0);
  const [saving, setSaving] = useState(false);
  const [editingGrnId, setEditingGrnId] = useState<string | null>(null);
  // A Purchase Return GRN is its own document: every row is RET, and the
  // ledger books it as a PURCHASE_RETURN. A purchase GRN can still carry RET
  // rows of its own, as it always could.
  const [grnMode, setGrnMode] = useState<GrnMode>("PURCHASE");
  const isReturnMode = grnMode === "RETURN";

  // ── Payment at receipt time (Phase 6) ──
  const [paymentMethod, setPaymentMethod] = useState<"LEND" | "CASH" | "BANK" | "CASH_AND_BANK">("LEND");
  const [cashAmount, setCashAmount] = useState(0);
  const [bankAmount, setBankAmount] = useState(0);
  const [bankAccountId, setBankAccountId] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [repaymentType, setRepaymentType] = useState<RepaymentType>("NONE");
  const [installmentPeriods, setInstallmentPeriods] = useState<number | "">("");
  const [promiseDays, setPromiseDays] = useState<number | "">("");

  // ── Quick "Add Item" ──
  // Opened either from the toolbar button or from an item search that came
  // back empty, in which case the typed text pre-fills the name.
  const [showAddItem, setShowAddItem] = useState(false);
  const [addItemName, setAddItemName] = useState("");

  const [grnList, setGrnList] = useState<GRNRecord[]>([]);
  const [grnSearch, setGrnSearch] = useState("");
  // Date range for the picker list. The default is `all`, which is what the
  // list did before it had a filter — narrowing it by default would hide the
  // older GRN somebody came here to open. Space in a 224px column is the
  // reason this is one dropdown rather than a row of range buttons; the two
  // date inputs appear only under `custom`.
  const [grnPreset, setGrnPreset] = useState<DateRangePreset>("all");
  const [grnFrom, setGrnFrom] = useState("");
  const [grnTo, setGrnTo] = useState("");

  const [searchRowId, setSearchRowId] = useState<string | null>(null);
  const [itemQuery, setItemQuery] = useState("");
  const [itemResults, setItemResults] = useState<Item[]>([]);
  // The results list is positioned against the viewport and rendered outside
  // the table. Absolutely positioning it inside the row put it inside the
  // table wrapper's `overflow-hidden`, which clipped it to the row.
  const [searchPopupPos, setSearchPopupPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const scannerRef = useRef<BarcodeScannerHandle>(null);
  // Scan detection in a row's item box + walking the cursor to the next row.
  // Shared with the sales screen — see lib/use-row-scan-flow.ts.
  const { setInputRef, forgetRow, focusRowAfter, noteRowKey, wasRowScan } =
    useRowScanFlow({ rows: lines, setRows: setLines, makeEmptyRow: () => makeLine() });

  const [showVendorSearch, setShowVendorSearch] = useState(false);
  const [vendors, setVendors] = useState<Party[]>([]);
  const [vendorQuery, setVendorQuery] = useState("");
  const [vendorsLoading, setVendorsLoading] = useState(false);
  // Add a vendor without leaving the half-built GRN, or correct the one
  // picked — the same PartyFormModal the sales screen uses for customers.
  const [showAddVendor, setShowAddVendor] = useState(false);
  const [addVendorName, setAddVendorName] = useState("");
  const [showEditVendor, setShowEditVendor] = useState(false);

  const [showPrintA5, setShowPrintA5] = useState(false);
  const [showPrintA4, setShowPrintA4] = useState(false);
  const [showBarcode, setShowBarcode] = useState(false);
  const [showBarcodeDouble, setShowBarcodeDouble] = useState(false);

  // ── Inventory State ────────────────────────────────────────────────────────
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [invSearch, setInvSearch] = useState("");
  const [invLowOnly, setInvLowOnly] = useState(false);
  const [invLoading, setInvLoading] = useState(false);
  const [invPage, setInvPage] = useState(1);
  const [invTotal, setInvTotal] = useState(0);
  // Server-side counts over the whole search result, not just the page in view.
  const [invCounts, setInvCounts] = useState({ ok: 0, low: 0, out: 0 });
  const [adjustItem, setAdjustItem] = useState<InventoryItem | null>(null);
  const [adjustType, setAdjustType] = useState<"ADD" | "SUBTRACT">("ADD");
  const [adjustQty, setAdjustQty] = useState<number>(1);
  const [adjustReason, setAdjustReason] = useState("");
  const [adjustSaving, setAdjustSaving] = useState(false);
  const [barcodeInvItem, setBarcodeInvItem] = useState<InventoryItem | null>(null);

  // ─── Load on mount ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!branchId) return;
    loadNextGrnNo();
    loadAccounts();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  // The picker list reloads whenever its date range changes as well as on
  // mount. Debounced, so typing into a custom date input doesn't fire a request
  // per keystroke — the same rule the report lists follow.
  useEffect(() => {
    if (!branchId) return;
    const timer = setTimeout(loadGrnList, 250);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, grnFrom, grnTo]);

  // `?tab=inventory` (optionally `&lowStock=1`) opens straight onto the
  // Inventory tab — the Dashboard's Low Stock Alerts card links here. Read
  // once on mount; the tab isn't mirrored back into the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (tab === "grn" || tab === "records" || tab === "inventory") setActiveTab(tab);
    if (params.get("lowStock") === "1") setInvLowOnly(true);
  }, []);

  // Search, the low-stock filter and the page all refetch, debounced so typing
  // into the search box doesn't fire a request per keystroke.
  useEffect(() => {
    if (activeTab !== "inventory" || !branchId) return;
    const timer = setTimeout(loadInventory, 250);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, branchId, invSearch, invLowOnly, invPage]);

  // A new filter invalidates whatever page we were on.
  useEffect(() => { setInvPage(1); }, [invSearch, invLowOnly]);

  // ─── Data Loaders ──────────────────────────────────────────────────────────

  async function loadNextGrnNo() {
    const res = await fetch(`/api/purchases/next-grn-no?branchId=${branchId}`);
    const data = await res.json();
    setGrnNo(data.grnNo);
  }

  async function loadGrnList() {
    const params = new URLSearchParams({ branchId, limit: "80" });
    if (grnFrom) params.set("from", grnFrom);
    if (grnTo) params.set("to", grnTo);
    const res = await fetch(`/api/purchases?${params}`);
    const data = await res.json();
    setGrnList(data.grns ?? []);
  }

  function applyGrnPreset(next: DateRangePreset) {
    setGrnPreset(next);
    applyDatePreset(next, setGrnFrom, setGrnTo);
  }

  /**
   * Open a GRN from the Records tab in the form for editing — the tab switch
   * and the load in one step, so the operator lands on the loaded document
   * rather than on an empty form they then have to find it in.
   */
  function editGrnFromRecords(id: string) {
    setActiveTab("grn");
    loadGrn(id);
  }

  async function loadAccounts() {
    const res = await fetch(`/api/accounts?branchId=${branchId}`);
    const data = await res.json();
    setAccounts((data.accounts ?? []).filter((a: Account) => a.isActive));
  }

  // Vendors are searched on the server — name, city, phone or account no. —
  // rather than filtering a first-200 list in the browser, which silently hid
  // every vendor past the 200th. Debounced like the sales screen's party search.
  useEffect(() => {
    if (!showVendorSearch) return;
    const q = vendorQuery.trim();
    const timer = setTimeout(async () => {
      setVendorsLoading(true);
      try {
        const params = new URLSearchParams({ type: "VENDOR", limit: "30" });
        if (q) params.set("q", q);
        const res = await fetch(`/api/parties?${params}`);
        const data = await res.json();
        setVendors(data.parties ?? []);
      } finally {
        setVendorsLoading(false);
      }
    }, q ? 250 : 0);
    return () => clearTimeout(timer);
  }, [vendorQuery, showVendorSearch]);

  function selectVendor(v: Party) {
    setSelectedParty({ ...v, previousBalance: Number(v.previousBalance ?? 0), creditLimit: Number(v.creditLimit ?? 0) });
    setShowVendorSearch(false);
  }

  function openAddVendor(name = "") {
    setAddVendorName(name);
    setShowVendorSearch(false);
    setShowAddVendor(true);
  }

  async function loadInventory() {
    setInvLoading(true);
    try {
      const params = new URLSearchParams({ branchId, limit: String(INV_PAGE_SIZE), page: String(invPage) });
      if (invSearch) params.set("search", invSearch);
      if (invLowOnly) params.set("lowStock", "true");
      const res = await fetch(`/api/inventory?${params}`);
      const data = await res.json();
      setInventory(data.items ?? []);
      setInvTotal(data.total ?? 0);
      setInvCounts(data.counts ?? { ok: 0, low: 0, out: 0 });
      // An adjustment can empty the last page (under "low only"); step back to
      // the new last page rather than showing an empty table.
      const lastPage = Math.max(1, Math.ceil((data.total ?? 0) / INV_PAGE_SIZE));
      if (invPage > lastPage) setInvPage(lastPage);
    } finally {
      setInvLoading(false);
    }
  }

  // ─── Item search ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!itemQuery || itemQuery.length < 1) { setItemResults([]); return; }
    const timeout = setTimeout(async () => {
      const res = await fetch(`/api/items?search=${encodeURIComponent(itemQuery)}&branchId=${branchId}`);
      const data = await res.json();
      setItemResults(
        (data.items ?? []).map((i: any) => ({
          id: i.id, name: i.name, unit: i.unit,
          purchaseUnit: i.purchaseUnit ?? null,
          piecesPerBundle: i.piecesPerBundle ?? null,
          purchasePrice: Number(i.purchasePrice),
          salePrice: Number(i.salePrice),
          barcode: i.barcode,
          systemBarcode: i.systemBarcode,
          currentStock: Number(i.currentStock ?? 0),
        }))
      );
    }, 200);
    return () => clearTimeout(timeout);
  }, [itemQuery, branchId]);

  // The results popup is pinned to viewport coordinates taken when it opened,
  // so scrolling the form underneath it would leave it floating over the wrong
  // row. Closing is both cheaper and less confusing than re-measuring.
  useEffect(() => {
    if (!searchRowId) return;
    function onScrollOrResize() { closeItemSearch(); }
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [searchRowId]);

  // ─── GRN Calculations ──────────────────────────────────────────────────────

  const saleAmount = lines.filter((l) => l.itemId && !l.isReturn).reduce((s, l) => s + l.amount, 0);
  const returnAmount = lines.filter((l) => l.itemId && l.isReturn).reduce((s, l) => s + l.amount, 0);
  const discountAmount = (saleAmount * discountPct) / 100;
  const billAmount = saleAmount - discountAmount + adjustment;
  // Deliberately NOT clamped at 0. A GRN that returns more than it receives is
  // a real net-return document, and clamping here is what used to hide it from
  // the vendor ledger entirely — the server now books the negative case as a
  // PURCHASE_RETURN (see docs/purchases-grn.md).
  const netBill = billAmount - returnAmount;
  const isReturnGrn = netBill < 0;
  const totalPurchaseQty = lines.filter((l) => l.itemId && !l.isReturn).reduce((s, l) => s + l.qty, 0);
  const totalReturnQty = lines.filter((l) => l.itemId && l.isReturn).reduce((s, l) => s + l.qty, 0);

  // ─── Payment / repayment derivations ───────────────────────────────────────

  const paidNow = (paymentMethod === "LEND" ? 0 : cashAmount + bankAmount);
  // What stays on vendor credit after whatever was handed over at receipt.
  const outstandingAfterPayment = isReturnGrn
    ? 0
    : Math.max(0, Math.round((netBill - paidNow) * 100) / 100);
  const overpaid = paidNow - Math.abs(netBill) > 0.005;

  const effectiveRepaymentType: RepaymentType = outstandingAfterPayment > 0 ? repaymentType : "NONE";
  const needsPromiseDays = effectiveRepaymentType === "PROMISE_DAY" && !(Number(promiseDays) > 0);

  const schedulePreview = effectiveRepaymentType === "NONE" || needsPromiseDays
    ? []
    : generateInstallmentSchedule({
        principal: outstandingAfterPayment,
        kind: effectiveRepaymentType,
        periods: effectiveRepaymentType === "PROMISE_DAY" ? 1 : Number(installmentPeriods || 1),
        startDate: grnDate,
        promiseDays: Number(promiseDays) || null,
      });

  // Switching method clears whichever amount just went out of scope, so a
  // stale figure can't ride along into the saved GRN.
  function changePaymentMethod(next: "LEND" | "CASH" | "BANK" | "CASH_AND_BANK") {
    setPaymentMethod(next);
    if (next === "LEND") { setCashAmount(0); setBankAmount(0); setBankAccountId(""); }
    else if (next === "CASH") { setBankAmount(0); setBankAccountId(""); }
    else if (next === "BANK") { setCashAmount(0); }
  }

  function changeRepaymentType(next: RepaymentType) {
    setRepaymentType(next);
    if ((next === "WEEKLY" || next === "MONTHLY") && !installmentPeriods) setInstallmentPeriods(3);
  }

  /**
   * A line picks its units up from the item: sell unit is what the item is
   * already sold in, buy unit what it was last bought in. Both stay editable —
   * the whole point is that a receipt can arrive in a different unit — but the
   * defaults mean a shop that buys and sells the same way never touches them.
   */
  function unitsForItem(item: Item): Pick<GRNLine, "buyUnit" | "sellUnit" | "piecesPerBundle"> {
    const sellUnit: StockUnit = isStockUnit(item.unit) ? item.unit : "PCS";
    return {
      sellUnit,
      buyUnit: isTxUnit(item.purchaseUnit) ? item.purchaseUnit : sellUnit,
      piecesPerBundle: item.piecesPerBundle ?? null,
    };
  }

  /**
   * Buy unit: anything in the same family as the sell unit. The vendor's terms
   * are the vendor's — cloth billed by the gaz or the metre, countables by the
   * piece or the bundle. BUNDLE is offered even when the item has no bundle
   * size yet, because the receipt is exactly where that size gets known; the
   * hint below the row asks for it and Save refuses without it.
   */
  function buyUnitOptions(line: GRNLine): TxUnit[] {
    if (line.sellUnit === "GAZ" || line.sellUnit === "MTR") return ["GAZ", "MTR"];
    return ["PCS", "BUNDLE"];
  }

  /** Sell unit: never BUNDLE — stock is not held in bundles. */
  function sellUnitOptions(line: GRNLine): StockUnit[] {
    if (line.sellUnit === "GAZ" || line.sellUnit === "MTR") return ["GAZ", "MTR"];
    return STOCK_UNITS.filter((u) => u === "PCS");
  }

  /**
   * The plain-English version of what this line is about to do to stock and to
   * the item's cost price. Runs the same `convertGrnLine` the server runs, so
   * the preview cannot drift from what actually gets written.
   */
  function conversionHint(line: GRNLine): string | null {
    if (!line.itemId || line.buyUnit === line.sellUnit) return null;
    if (line.buyUnit === "BUNDLE" && !line.piecesPerBundle) {
      return t("purchases_needBundleSize");
    }
    try {
      const { stockQty, costPerSellUnit } = convertGrnLine(
        { qty: line.qty, costRate: line.costRate, buyUnit: line.buyUnit, sellUnit: line.sellUnit, piecesPerBundle: line.piecesPerBundle },
        unitCfg
      );
      const into = `${formatQty(line.qty)} ${line.buyUnit} → ${formatQty(stockQty)} ${line.sellUnit}`;
      const cost = line.costRate > 0
        ? ` · ${t("purchases_costPerUnit")} ${formatCurrency(costPerSellUnit)}/${line.sellUnit}`
        : "";
      const relabel = line.sellUnit !== line.unit
        ? ` · ${t("purchases_stockRelabelled")} ${line.unit} → ${line.sellUnit}`
        : "";
      return `${into}${cost}${relabel}`;
    } catch {
      return t("purchases_needBundleSize");
    }
  }

  /**
   * The cost the line's profit % is measured against: the rate per SELL unit,
   * which is what the sale rate is quoted in and what the server writes back
   * as the item's purchase price. Null when there is nothing to measure.
   */
  function lineSellUnitCost(line: GRNLine): number | null {
    if (!(line.costRate > 0)) return null;
    try {
      return convertGrnLine(
        { qty: line.qty, costRate: line.costRate, buyUnit: line.buyUnit, sellUnit: line.sellUnit, piecesPerBundle: line.piecesPerBundle },
        unitCfg
      ).costPerSellUnit;
    } catch {
      return null;
    }
  }

  /** A blank row in the document's own direction. */
  function makeLine(mode: GrnMode = grnMode): GRNLine {
    return { ...EMPTY_LINE(), isReturn: mode === "RETURN" };
  }

  // ─── Barcode scanning ──────────────────────────────────────────────────────

  /**
   * Where a resolved scan lands. An item already on this GRN as a purchase
   * line bumps its quantity; anything else fills the first blank row. The
   * lookup, the unknown-code chooser and the create-item form all live in
   * `BarcodeScanner`, shared with the sales screen.
   */
  function addScannedItem(item: Item, originRowId?: string) {
    setLines((prev) => {
      const existing = prev.find((l) => l.itemId === item.id && l.isReturn === isReturnMode);
      if (existing) {
        toast.success(`${item.name} +1`);
        return prev.map((l) => {
          if (l.id !== existing.id) return l;
          const qty = l.qty + 1;
          const disc = l.costRate * qty * (l.disPct / 100);
          return { ...l, qty, amount: Math.max(0, l.costRate * qty - disc) };
        });
      }
      const filled: GRNLine = {
        id: `row_${Date.now()}_${Math.random()}`,
        itemId: item.id, itemName: item.name, unit: item.unit, barcode: item.barcode, systemBarcode: item.systemBarcode,
        qty: 1, costRate: item.purchasePrice, saleRate: item.salePrice, disPct: 0,
        amount: item.purchasePrice, isReturn: isReturnMode,
        ...unitsForItem(item),
      };
      toast.success(item.name);
      const blank = prev.findIndex((l) => !l.itemId);
      if (blank === -1) return [...prev, filled];
      return prev.map((l, i) => (i === blank ? { ...filled, id: l.id } : l));
    });

    // Only when the code was typed into a row's item box. A scan made in the
    // dedicated field reports no origin and leaves the cursor there, so the
    // next one can follow immediately.
    if (originRowId) focusRowAfter(originRowId);
  }

  // ─── Quick "Add Item" ──────────────────────────────────────────────────────

  /** Opens the item form, optionally seeded with the name already typed. */
  function openAddItem(name = "") {
    setAddItemName(name);
    setShowAddItem(true);
    closeItemSearch();
  }

  // A freshly created item goes straight onto the GRN — cataloguing it was
  // only ever a means to receiving it.
  function handleItemCreated(created: any) {
    setShowAddItem(false);
    setAddItemName("");
    addScannedItem(normalizeScannedItem(created));
  }

  // ─── Line helpers ──────────────────────────────────────────────────────────

  function addLine() { setLines((p) => [...p, makeLine()]); }

  function removeLine(id: string) { forgetRow(id); setLines((p) => p.filter((l) => l.id !== id)); }

  function updateLine(id: string, updates: Partial<GRNLine>) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;
        const next = { ...l, ...updates };
        const disc = next.costRate * next.qty * (next.disPct / 100);
        next.amount = Math.max(0, next.costRate * next.qty - disc);
        return next;
      })
    );
  }

  function openRowSearch(rowId: string, query: string, inputEl: HTMLInputElement) {
    setSearchRowId(rowId);
    setItemQuery(query);
    const rect = inputEl.getBoundingClientRect();
    setSearchPopupPos({
      top: rect.bottom,
      left: rect.left,
      width: Math.max(320, rect.width),
    });
  }

  function closeItemSearch() {
    setSearchRowId(null);
    setItemQuery("");
    setItemResults([]);
    setSearchPopupPos(null);
  }

  function selectItemForLine(rowId: string, item: Item) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== rowId) return l;
        return { ...l, itemId: item.id, itemName: item.name, unit: item.unit, barcode: item.barcode, systemBarcode: item.systemBarcode, costRate: item.purchasePrice, saleRate: item.salePrice, qty: l.qty || 1, amount: item.purchasePrice * (l.qty || 1), ...unitsForItem(item) };
      })
    );
    closeItemSearch();
    focusRowAfter(rowId);
  }

  // ─── Save GRN ──────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!selectedParty) { toast.error(t("purchases_selectVendorError")); return; }
    const validLines = lines.filter((l) => l.itemId && l.qty > 0);
    if (validLines.length === 0) { toast.error(t("purchases_addAtLeastOneItemError")); return; }
    // PUR is disabled on a return, so this guards a row carried over from a
    // purchase rather than a check the operator should ever hit.
    if (isReturnMode && validLines.some((l) => !l.isReturn)) { toast.error(t("purchases_returnGrnHint")); return; }
    if (paymentMethod !== "LEND" && bankAmount > 0 && !bankAccountId) { toast.error(t("purchases_bankAccountRequired")); return; }
    if (overpaid) { toast.error(t("purchases_overpaidError")); return; }
    if (needsPromiseDays) { toast.error(t("purchases_promiseDaysRequired")); return; }
    setSaving(true);
    try {
      const payload = {
        branchId, userId, partyId: selectedParty.id,
        billNo, remarks, date: grnDate.toISOString(),
        // buyUnit/sellUnit go over as chosen; the server re-derives the
        // converted stock quantity and cost itself rather than trusting a
        // figure from the client, the same way the sale totals are re-checked.
        lines: validLines.map((l) => ({ itemId: l.itemId, qty: l.qty, costRate: l.costRate, saleRate: l.saleRate, disPct: l.disPct, amount: l.amount, isReturn: l.isReturn, buyUnit: l.buyUnit, sellUnit: l.sellUnit, piecesPerBundle: l.piecesPerBundle })),
        isReturn: isReturnMode,
        saleAmount, billAmount, returnAmount, discountPct, adjustment, netBill, totalPurchaseQty, totalReturnQty,
        paymentMethod, cashAmount, bankAmount, bankAccountId: bankAccountId || null,
        repaymentType: effectiveRepaymentType,
        installmentPeriods: installmentPeriods || null,
        promiseDays: promiseDays || null,
      };
      const url = editingGrnId ? `/api/purchases/${editingGrnId}` : "/api/purchases";
      const method = editingGrnId ? "PUT" : "POST";
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        if (err?.error) { toast.error(err.error); return; }
        throw new Error("Save failed");
      }
      const data = await res.json();
      toast.success(`${t("purchases_grnHash")}${data.grnNo} ${editingGrnId ? t("purchases_grnUpdatedSuffix") : isReturnMode ? t("purchases_returnGrnSavedSuffix") : t("purchases_grnSavedSuffix")}`);
      handleNew(grnMode);
      loadGrnList();
    } catch { toast.error(t("purchases_saveGrnFailed")); }
    finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!editingGrnId) { toast.error(t("purchases_noGrnLoaded")); return; }
    if (!confirm(t("purchases_deleteGrnConfirm"))) return;
    try {
      const res = await fetch(`/api/purchases/${editingGrnId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success(t("purchases_grnDeletedSuccess"));
      handleNew();
      loadGrnList();
    } catch { toast.error(t("purchases_deleteGrnFailed")); }
  }

  async function loadGrn(id: string) {
    const res = await fetch(`/api/purchases/${id}`);
    const data = await res.json();
    const grn = data.grn;
    setEditingGrnId(grn.id);
    setGrnNo(grn.grnNo);
    setGrnDate(new Date(grn.date));
    setBillNo(grn.billNo ?? "");
    setRemarks(grn.remarks ?? "");
    setDiscountPct(Number(grn.discountPct));
    setAdjustment(Number(grn.adjustment));
    setPaymentMethod(grn.paymentMethod ?? "LEND");
    setCashAmount(Number(grn.cashAmount ?? 0));
    setBankAmount(Number(grn.bankAmount ?? 0));
    setBankAccountId(grn.bankAccountId ?? "");
    setRepaymentType(grn.repaymentType ?? "NONE");
    setInstallmentPeriods(grn.installmentPeriods ?? "");
    setPromiseDays(grn.promiseDays ?? "");
    setGrnMode(grn.isReturn ? "RETURN" : "PURCHASE");
    // The full vendor row (the route includes it), so the edit pencil can open
    // it as-is. Decimal columns arrive as strings.
    setSelectedParty({ ...grn.party, previousBalance: Number(grn.party.previousBalance ?? 0), creditLimit: Number(grn.party.creditLimit ?? 0) });
    const loadedLines: GRNLine[] = grn.items.map((gi: any) => ({
      id: gi.id, itemId: gi.itemId, itemName: gi.item.name, unit: gi.item.unit, barcode: gi.item.barcode, systemBarcode: gi.item.systemBarcode,
      qty: Number(gi.qty), costRate: Number(gi.costRate), saleRate: Number(gi.saleRate),
      disPct: Number(gi.disPct), amount: Number(gi.amount), isReturn: gi.type === "RETURN",
      // The units this receipt was *actually* taken in, not the item's current
      // defaults — an item resold in a different unit since would otherwise
      // make a reopened GRN describe a conversion that never happened.
      buyUnit: isTxUnit(gi.buyUnit) ? gi.buyUnit : (isStockUnit(gi.item.unit) ? gi.item.unit : "PCS"),
      sellUnit: isStockUnit(gi.item.unit) ? gi.item.unit : "PCS",
      piecesPerBundle: gi.item.piecesPerBundle ?? null,
    }));
    setLines(loadedLines.length > 0 ? loadedLines : [makeLine(grn.isReturn ? "RETURN" : "PURCHASE")]);
  }

  /** A fresh document — a purchase, or a Purchase Return. */
  function handleNew(mode: GrnMode = "PURCHASE") {
    setEditingGrnId(null);
    setGrnMode(mode);
    setLines([makeLine(mode)]);
    setSelectedParty(null);
    setBillNo("");
    setRemarks("");
    setDiscountPct(0);
    setAdjustment(0);
    setPaymentMethod("LEND");
    setCashAmount(0); setBankAmount(0); setBankAccountId("");
    setRepaymentType("NONE"); setInstallmentPeriods(""); setPromiseDays("");
    closeItemSearch();
    setGrnDate(new Date());
    loadNextGrnNo();
  }

  async function handleAdjust() {
    if (!adjustItem || adjustQty <= 0) return;
    setAdjustSaving(true);
    try {
      const res = await fetch("/api/inventory/adjust", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ branchId, itemId: adjustItem.id, type: adjustType, qty: adjustQty, reason: adjustReason }) });
      if (!res.ok) throw new Error();
      const data = await res.json();
      toast.success(`${t("purchases_stockUpdatedTo")} ${data.qty} ${adjustItem.unit}`);
      setAdjustItem(null);
      loadInventory();
    } catch { toast.error(t("purchases_adjustStockFailed")); }
    finally { setAdjustSaving(false); }
  }

  const filteredGrnList = grnList.filter((g) => String(g.grnNo).includes(grnSearch) || g.party.name.toLowerCase().includes(grnSearch.toLowerCase()));

  const grnSummaryForPrint = { grnNo, date: grnDate, billNo, remarks, vendorName: selectedParty?.name ?? "—", saleAmount, billAmount, returnAmount, discountPct, adjustment, netBill, totalPurchaseQty, totalReturnQty };
  const linesForPrint = lines.filter((l) => l.itemId);
  // A label is read at the till, so it shows the SELL unit and the sale rate
  // per that unit — never the unit the vendor billed in. The count printed is
  // the converted quantity for the same reason: one label per piece, not one
  // per bundle.
  const barcodeItems = lines.filter((l) => l.itemId && !l.isReturn && l.qty > 0).map((l) => {
    let qty = l.qty;
    try {
      qty = convertGrnLine({ qty: l.qty, costRate: 0, buyUnit: l.buyUnit, sellUnit: l.sellUnit, piecesPerBundle: l.piecesPerBundle }, unitCfg).stockQty;
    } catch { /* an unconvertible line prints its entered count rather than none */ }
    return { itemId: l.itemId, itemName: l.itemName, barcode: l.barcode, systemBarcode: l.systemBarcode, saleRate: l.saleRate, qty, unit: l.sellUnit };
  });

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full" onClick={() => { if (searchRowId) closeItemSearch(); }}>
      {/* Tabs */}
      <div className="border-b bg-white px-4 pt-3 flex gap-4 shrink-0">
        <button onClick={() => setActiveTab("grn")} className={cn(`pb-2 text-sm font-semibold border-b-2 transition-colors ${activeTab === "grn" ? "border-teal-600 text-teal-700" : "border-transparent text-gray-500 hover:text-gray-700"}`, isUrdu && "urdu-text")}>
          📦 {t("purchases_tabGrnPurchases")}
        </button>
        <button onClick={() => setActiveTab("records")} className={cn(`pb-2 text-sm font-semibold border-b-2 transition-colors ${activeTab === "records" ? "border-teal-600 text-teal-700" : "border-transparent text-gray-500 hover:text-gray-700"}`, isUrdu && "urdu-text")}>
          📋 {t("purchases_tabGrnRecords")}
        </button>
        <button onClick={() => setActiveTab("inventory")} className={cn(`pb-2 text-sm font-semibold border-b-2 transition-colors ${activeTab === "inventory" ? "border-teal-600 text-teal-700" : "border-transparent text-gray-500 hover:text-gray-700"}`, isUrdu && "urdu-text")}>
          📊 {t("purchases_tabInventory")}
        </button>
      </div>

      {/* ════ GRN TAB ════════════════════════════════════════════════════════ */}
      {activeTab === "grn" && (
        <div className="flex flex-1 min-h-0">
          {/* Left panel */}
          <aside className="w-56 border-r bg-gray-50 flex flex-col shrink-0">
            <div className="p-2 border-b space-y-1.5">
              <input value={grnSearch} onChange={(e) => setGrnSearch(e.target.value)} placeholder={t("purchases_searchGrnPlaceholder")} className={cn("w-full text-xs border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-teal-400", isUrdu && "urdu-text")} />
              {/*
                One dropdown, not a row of range buttons: this column is 224px
                wide and already carries a search box. The two date inputs below
                appear only for `custom`, so the common ranges cost no height.
              */}
              <select
                value={grnPreset}
                onChange={(e) => applyGrnPreset(e.target.value as DateRangePreset)}
                aria-label={t("reports_dateRange")}
                title={t("reports_dateRange")}
                className={cn("w-full text-xs border rounded bg-white px-2 py-1 focus:outline-none focus:ring-1 focus:ring-teal-400", isUrdu && "urdu-text")}
              >
                {DATE_PRESETS.map((p) => (
                  <option key={p} value={p}>{presetLabels[p]}</option>
                ))}
              </select>
              {grnPreset === "custom" && (
                <div className="flex gap-1">
                  <input type="date" value={grnFrom} onChange={(e) => setGrnFrom(e.target.value)}
                    aria-label={t("from")}
                    className="w-1/2 min-w-0 text-[11px] border rounded px-1 py-1 focus:outline-none focus:ring-1 focus:ring-teal-400" />
                  <input type="date" value={grnTo} onChange={(e) => setGrnTo(e.target.value)}
                    aria-label={t("to")}
                    className="w-1/2 min-w-0 text-[11px] border rounded px-1 py-1 focus:outline-none focus:ring-1 focus:ring-teal-400" />
                </div>
              )}
            </div>
            <div className="flex-1 overflow-y-auto">
              {filteredGrnList.map((g) => (
                <button key={g.id} onClick={() => loadGrn(g.id)} className={`w-full text-left px-3 py-2 border-b text-xs hover:bg-teal-50 transition-colors ${editingGrnId === g.id ? "bg-teal-100 border-l-2 border-l-teal-500" : ""}`}>
                  <div className={cn("font-semibold flex items-center gap-1.5", isUrdu && "urdu-text")}>
                    {t("purchases_grnHash")}{g.grnNo}
                    {g.isReturn && <span className="px-1 rounded bg-orange-500 text-white text-[9px] font-semibold">{t("purchases_returnBadge")}</span>}
                  </div>
                  <div className="text-gray-500 truncate">{g.party.name}</div>
                  <div className="flex justify-between text-gray-400">
                    <span>{formatDate(g.date)}</span>
                    <span>{formatCurrency(g.netBill)}</span>
                  </div>
                </button>
              ))}
              {filteredGrnList.length === 0 && <div className={cn("text-center text-gray-400 text-xs p-4", isUrdu && "urdu-text")}>{t("purchases_noGrnsFound")}</div>}
            </div>
          </aside>

          {/* Main form */}
          <main className="flex-1 flex flex-col min-w-0">
            {/* Toolbar */}
            <div className="bg-gray-100 border-b px-3 py-2 flex items-center gap-2 flex-wrap">
              <button onClick={() => handleNew("PURCHASE")} className={cn("flex items-center gap-1 px-3 py-1.5 bg-white border rounded text-xs font-medium hover:bg-gray-50", isUrdu && "urdu-text")}><Plus className="w-3.5 h-3.5" /> {t("purchases_newPurchase")}</button>
              {/* A Purchase Return is its own document, not only a RET row
                  tucked inside a purchase. */}
              {can("CREATE_GRN") && (
                <button onClick={() => handleNew("RETURN")} className={cn("flex items-center gap-1 px-3 py-1.5 bg-white border border-orange-300 text-orange-700 rounded text-xs font-medium hover:bg-orange-50", isUrdu && "urdu-text")}><Undo2 className="w-3.5 h-3.5" /> {t("purchases_newReturn")}</button>
              )}
              {can(editingGrnId ? "EDIT_GRN" : "CREATE_GRN") && (
                <button onClick={handleSave} disabled={saving} className={cn("flex items-center gap-1 px-3 py-1.5 bg-teal-600 text-white rounded text-xs font-medium hover:bg-teal-700 disabled:opacity-60", isUrdu && "urdu-text")}>
                  <Save className="w-3.5 h-3.5" />{saving ? t("purchases_saving") : editingGrnId ? t("purchases_update") : t("save")}
                </button>
              )}
              {editingGrnId && can("DELETE_GRN") && (
                <button onClick={handleDelete} className={cn("flex items-center gap-1 px-3 py-1.5 bg-red-500 text-white rounded text-xs font-medium hover:bg-red-600", isUrdu && "urdu-text")}><Trash2 className="w-3.5 h-3.5" /> {t("purchases_delete")}</button>
              )}
              <div className="w-px h-5 bg-gray-300 mx-1" />
              {can("PRINT_GRN") && (
                <>
                  <button onClick={() => setShowPrintA5(true)} className={cn("flex items-center gap-1 px-3 py-1.5 bg-white border rounded text-xs font-medium hover:bg-gray-50", isUrdu && "urdu-text")}><Printer className="w-3.5 h-3.5" /> {t("purchases_printA5")}</button>
                  <button onClick={() => setShowPrintA4(true)} className={cn("flex items-center gap-1 px-3 py-1.5 bg-white border rounded text-xs font-medium hover:bg-gray-50", isUrdu && "urdu-text")}><Printer className="w-3.5 h-3.5" /> {t("purchases_printA4")}</button>
                </>
              )}
              {can("PRINT_BARCODE") && (
                <>
                  <button onClick={() => setShowBarcode(true)} className={cn("flex items-center gap-1 px-3 py-1.5 bg-white border rounded text-xs font-medium hover:bg-gray-50", isUrdu && "urdu-text")}><Barcode className="w-3.5 h-3.5" /> {t("purchases_barcode2x1")}</button>
                  <button onClick={() => setShowBarcodeDouble(true)} className={cn("flex items-center gap-1 px-3 py-1.5 bg-white border rounded text-xs font-medium hover:bg-gray-50", isUrdu && "urdu-text")}><Barcode className="w-3.5 h-3.5" /> {t("purchases_barcodeDbl")}</button>
                </>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {isReturnMode && (
                <div className="flex items-start gap-2 border border-orange-300 bg-orange-50 rounded-lg px-3 py-2">
                  <Undo2 className="w-4 h-4 text-orange-600 mt-0.5 shrink-0" />
                  <div>
                    <div className={cn("text-sm font-bold text-orange-800", isUrdu && "urdu-text")}>{t("purchases_returnGrnTitle")}</div>
                    <div className={cn("text-xs text-orange-700", isUrdu && "urdu-text")}>{t("purchases_returnGrnHint")}</div>
                  </div>
                </div>
              )}
              {/* Header */}
              <div className="grid grid-cols-12 gap-3">
                <div className="col-span-2">
                  <label className={cn("block text-xs text-gray-500 mb-1", isUrdu && "urdu-text")}>{t("date")}</label>
                  <input type="date" value={shopDateKey(grnDate)} onChange={(e) => setGrnDate(new Date(e.target.value))} className="w-full border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-teal-400" />
                </div>
                <div className="col-span-1">
                  <label className={cn("block text-xs text-gray-500 mb-1", isUrdu && "urdu-text")}>{t("purchases_grnNo")}</label>
                  <input readOnly value={grnNo} className="w-full border rounded px-2 py-1.5 text-sm bg-gray-50 font-mono" />
                </div>
                <div className="col-span-2">
                  <label className={cn("block text-xs text-gray-500 mb-1", isUrdu && "urdu-text")}>{t("purchases_billNoVendor")}</label>
                  <input value={billNo} onChange={(e) => setBillNo(e.target.value)} placeholder={t("purchases_vendorBillRefPlaceholder")} className={cn("w-full border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-teal-400", isUrdu && "urdu-text")} />
                </div>
                <div className="col-span-4">
                  <label className={cn("block text-xs text-gray-500 mb-1", isUrdu && "urdu-text")}>{t("purchases_vendor")} *</label>
                  <div className="flex items-center gap-1">
                    <button onClick={() => { setShowVendorSearch(true); setVendorQuery(""); }} className="flex-1 min-w-0 border rounded px-2 py-1.5 text-sm text-left hover:bg-gray-50 focus:outline-none focus:ring-1 focus:ring-teal-400 flex justify-between items-center">
                      <span className={cn("truncate", selectedParty ? "text-gray-900" : "text-gray-400", isUrdu && !selectedParty && "urdu-text")}>{selectedParty ? `${selectedParty.accountId} — ${selectedParty.name}` : t("purchases_selectVendorPlaceholder")}</span>
                      <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                    </button>
                    {selectedParty && can("EDIT_PARTY") && (
                      <button type="button" onClick={() => setShowEditVendor(true)} title={t("purchases_editVendor")}
                        className="shrink-0 p-1.5 text-teal-600 hover:text-teal-800 hover:bg-teal-50 rounded">
                        <Edit2 className="w-4 h-4" />
                      </button>
                    )}
                    {can("ADD_PARTY") && (
                      <button type="button" onClick={() => openAddVendor()} title={t("purchases_addNewVendor")}
                        className="shrink-0 p-1.5 text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 rounded">
                        <UserPlus className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="col-span-3">
                  <label className={cn("block text-xs text-gray-500 mb-1", isUrdu && "urdu-text")}>{t("purchases_remarks")}</label>
                  <input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder={t("purchases_optionalRemarksPlaceholder")} className={cn("w-full border rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-teal-400", isUrdu && "urdu-text")} />
                </div>
              </div>

              {/* Items table */}
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-gray-100">
                    <tr>
                      <th className="text-left px-2 py-2 w-6">#</th>
                      <th className={cn("text-left px-2 py-2", isUrdu && "urdu-text")}>{t("purchases_itemName")}</th>
                      <th className={cn("text-center px-2 py-2 w-20", isUrdu && "urdu-text")}>{t("purchases_buyUnit")}</th>
                      <th className={cn("text-center px-2 py-2 w-20", isUrdu && "urdu-text")}>{t("purchases_sellUnit")}</th>
                      <th className={cn("text-right px-2 py-2 w-16", isUrdu && "urdu-text")}>{t("purchases_qty")}</th>
                      <th className={cn("text-right px-2 py-2 w-20", isUrdu && "urdu-text")}>{t("purchases_costRate")}</th>
                      <th className={cn("text-right px-2 py-2 w-16", isUrdu && "urdu-text")}>{t("purchases_profitPct")}</th>
                      <th className={cn("text-right px-2 py-2 w-20", isUrdu && "urdu-text")}>{t("purchases_saleRate")}</th>
                      <th className={cn("text-right px-2 py-2 w-12", isUrdu && "urdu-text")}>{t("purchases_disPct")}</th>
                      <th className={cn("text-right px-2 py-2 w-20", isUrdu && "urdu-text")}>{t("amount")}</th>
                      <th className={cn("text-center px-2 py-2 w-20", isUrdu && "urdu-text")}>{t("type")}</th>
                      <th className="px-2 py-2 w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((line, i) => (
                      <Fragment key={line.id}>
                      <tr className="border-t hover:bg-gray-50" onClick={(e) => e.stopPropagation()}>
                        <td className="px-2 py-1 text-gray-400">{i + 1}</td>
                        <td className="px-2 py-1">
                          <input
                            ref={(el) => setInputRef(line.id, el)}
                            value={searchRowId === line.id ? itemQuery : line.itemName}
                            onFocus={(e) => openRowSearch(line.id, line.itemName, e.target)}
                            onChange={(e) => openRowSearch(line.id, e.target.value, e.target)}
                            onKeyDown={(e) => {
                              if (e.key.length === 1) noteRowKey(line.id, e.key);
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
                              const exact = itemResults.find((r) => matchesBarcode(r, typed));
                              if (exact) { selectItemForLine(line.id, exact); return; }
                              // A scanner beats the 200ms debounce every time, so there are
                              // usually no results yet. Hand the code to the scanner, which
                              // also owns the "not recognised" flow.
                              if (isScan) {
                                closeItemSearch();
                                scannerRef.current?.scan(typed, line.id);
                                return;
                              }
                              if (itemResults.length > 0) selectItemForLine(line.id, itemResults[0]);
                            }}
                            placeholder={t("purchases_typeItemNamePlaceholder")}
                            className={cn("w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-teal-400", isUrdu && "urdu-text")}
                          />
                        </td>
                        {/* Buy unit — what the vendor billed in. Free across the
                            whole family (a bundle is a count of pieces, a gaz a
                            length) because the vendor's terms are the vendor's. */}
                        <td className="px-1 py-1">
                          <select
                            value={line.buyUnit}
                            disabled={!line.itemId}
                            onChange={(e) => updateLine(line.id, { buyUnit: e.target.value as TxUnit })}
                            className="w-full border rounded px-1 py-0.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-teal-400 disabled:bg-gray-50 disabled:text-gray-400"
                          >
                            {buyUnitOptions(line).map((u) => (
                              <option key={u} value={u}>{u}</option>
                            ))}
                          </select>
                        </td>
                        {/* Sell unit — what the item will be sold in, and so the
                            unit its stock will be held in from this receipt on.
                            Changing it re-denominates the stock already on hand. */}
                        <td className="px-1 py-1">
                          <select
                            value={line.sellUnit}
                            disabled={!line.itemId}
                            onChange={(e) => updateLine(line.id, { sellUnit: e.target.value as StockUnit })}
                            className={cn(
                              "w-full border rounded px-1 py-0.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-teal-400 disabled:bg-gray-50 disabled:text-gray-400",
                              line.itemId && line.sellUnit !== line.unit && "border-amber-400 text-amber-700 font-semibold"
                            )}
                          >
                            {sellUnitOptions(line).map((u) => (
                              <option key={u} value={u}>{u}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-1">
                          <input type="number" min={0} value={line.qty || ""} onChange={(e) => updateLine(line.id, { qty: Number(e.target.value) })} className="w-full border rounded px-1 py-0.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-teal-400" />
                        </td>
                        <td className="px-2 py-1">
                          <input type="number" min={0} value={line.costRate || ""} onChange={(e) => updateLine(line.id, { costRate: Number(e.target.value) })} className="w-full border rounded px-1 py-0.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-teal-400" />
                        </td>
                        <td className="px-2 py-1">
                          {/* Derived, not stored: typing a % writes the sale rate, and
                              editing the sale rate moves the % with it. */}
                          <NumberInput
                            blankZero
                            value={profitPctOf(lineSellUnitCost(line) ?? 0, line.saleRate) ?? 0}
                            onChange={(v) => { const cost = lineSellUnitCost(line); if (cost) updateLine(line.id, { saleRate: saleFromProfitPct(cost, v) }); }}
                            disabled={lineSellUnitCost(line) === null}
                            className="w-full border rounded px-1 py-0.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-teal-400 disabled:bg-gray-50 disabled:text-gray-400"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input type="number" min={0} value={line.saleRate || ""} onChange={(e) => updateLine(line.id, { saleRate: Number(e.target.value) })} className="w-full border rounded px-1 py-0.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-teal-400" />
                        </td>
                        <td className="px-2 py-1">
                          <input type="number" min={0} max={100} value={line.disPct || ""} onChange={(e) => updateLine(line.id, { disPct: Number(e.target.value) })} className="w-full border rounded px-1 py-0.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-teal-400" />
                        </td>
                        <td className="px-2 py-1 text-right font-mono text-gray-700">{formatCurrency(line.amount)}</td>
                        <td className="px-2 py-1">
                          <div className="flex gap-1 justify-center">
                            {/* PUR is off on a Purchase Return — every row there is RET. */}
                            <button onClick={() => updateLine(line.id, { isReturn: false })} disabled={isReturnMode} className={cn(`px-1.5 py-0.5 rounded text-[10px] font-medium disabled:opacity-40 disabled:cursor-not-allowed ${!line.isReturn ? "bg-teal-600 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`, isUrdu && "urdu-text")}>{t("purchases_pur")}</button>
                            <button onClick={() => updateLine(line.id, { isReturn: true })} className={cn(`px-1.5 py-0.5 rounded text-[10px] font-medium ${line.isReturn ? "bg-orange-500 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`, isUrdu && "urdu-text")}>{t("purchases_ret")}</button>
                          </div>
                        </td>
                        <td className="px-2 py-1">
                          <button onClick={() => removeLine(line.id)} className="text-red-400 hover:text-red-600"><X className="w-4 h-4" /></button>
                        </td>
                      </tr>
                      {/* Shown only when the units actually differ, so the
                          ordinary buy-and-sell-the-same-way line stays a single
                          quiet row. Spelling the conversion out here is what
                          stops it being a surprise discovered in the stock
                          report a week later. */}
                      {conversionHint(line) && (
                        <tr className="bg-amber-50/60">
                          <td></td>
                          <td colSpan={10} className="px-2 pb-1.5 text-[11px] text-amber-800">
                            {conversionHint(line)}
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
                <div className="p-2 border-t bg-gray-50 flex items-center gap-3 flex-wrap">
                  <button onClick={addLine} className={cn("flex items-center gap-1 text-xs text-teal-600 hover:text-teal-800 font-medium", isUrdu && "urdu-text")}><Plus className="w-3.5 h-3.5" /> {t("purchases_addRow")}</button>
                  {can("ADD_ITEM") && (
                    <button onClick={() => openAddItem()} className={cn("flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-medium", isUrdu && "urdu-text")}>
                      <PackagePlus className="w-3.5 h-3.5" /> {t("items_addNewItem")}
                    </button>
                  )}
                  <BarcodeScanner
                    ref={scannerRef}
                    branchId={branchId}
                    onItem={addScannedItem}
                    defaultUnit="GAZ"
                    globalCapture
                    className="ml-auto"
                  />
                </div>
              </div>

              {/* Summary */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <label className={cn("text-xs text-gray-500 w-24 shrink-0", isUrdu && "urdu-text")}>{t("purchases_discountPct")}</label>
                    <input type="number" min={0} max={100} value={discountPct || ""} onChange={(e) => setDiscountPct(Number(e.target.value))} className="w-24 border rounded px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-teal-400" />
                  </div>
                  <div className="flex items-center gap-3">
                    <label className={cn("text-xs text-gray-500 w-24 shrink-0", isUrdu && "urdu-text")}>{t("purchases_adjustment")}</label>
                    <input type="number" min={0} value={adjustment || ""} onChange={(e) => setAdjustment(Number(e.target.value))} className="w-24 border rounded px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-teal-400" />
                  </div>
                </div>
                <div className="bg-gray-50 border rounded-lg p-4 space-y-1 text-sm">
                  <div className="flex justify-between"><span className={cn("text-gray-500", isUrdu && "urdu-text")}>{t("purchases_purchaseAmount")}</span><span className="font-mono">{formatCurrency(saleAmount)}</span></div>
                  <div className="flex justify-between"><span className={cn("text-gray-500", isUrdu && "urdu-text")}>{t("purchases_returnAmount")}</span><span className="font-mono text-orange-600">{formatCurrency(returnAmount)}</span></div>
                  {discountPct > 0 && <div className="flex justify-between"><span className={cn("text-gray-500", isUrdu && "urdu-text")}>{t("purchases_discount")} ({discountPct}%)</span><span className="font-mono text-red-500">−{formatCurrency(discountAmount)}</span></div>}
                  <div className="flex justify-between border-t pt-1 font-bold text-base">
                    <span className={cn(isUrdu && "urdu-text")}>{isReturnGrn ? t("purchases_refundDue") : t("purchases_netBill")}</span>
                    <span className={cn("font-mono", isReturnGrn ? "text-orange-600" : "text-teal-700")}>{formatCurrency(Math.abs(netBill))}</span>
                  </div>
                  <div className="flex justify-between text-xs text-gray-400 border-t pt-1"><span className={cn(isUrdu && "urdu-text")}>{t("purchases_purchaseQty")}: {totalPurchaseQty}</span><span className={cn(isUrdu && "urdu-text")}>{t("purchases_returnQty")}: {totalReturnQty}</span></div>

                  {/* Payment at receipt time. Until Phase 6 there were no fields
                      here at all and every purchase became a silent payable. */}
                  <div className="border-t pt-2 mt-1 space-y-1.5">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className={cn("text-xs text-gray-500 font-medium", isUrdu && "urdu-text")}>{t("purchases_paymentMethod")}</span>
                      {([
                        ["LEND", "purchases_payLend"],
                        ["CASH", "purchases_payCash"],
                        ["BANK", "purchases_payBank"],
                        ["CASH_AND_BANK", "purchases_payBoth"],
                      ] as const).map(([opt, key]) => (
                        <label key={opt} className="flex items-center gap-1 cursor-pointer text-xs">
                          <input type="radio" name="grnPaymentMethod" checked={paymentMethod === opt}
                            onChange={() => changePaymentMethod(opt)} className="accent-teal-600" />
                          <span className={cn(isUrdu && "urdu-text")}>{t(key)}</span>
                        </label>
                      ))}
                    </div>

                    {(paymentMethod === "CASH" || paymentMethod === "CASH_AND_BANK") && (
                      <div className="flex items-center justify-between">
                        <span className={cn("text-xs text-gray-600 font-semibold", isUrdu && "urdu-text")}>
                          {isReturnGrn ? t("purchases_refundCash") : t("purchases_cashPaid")}
                        </span>
                        <input type="number" min={0} value={cashAmount || ""}
                          onChange={(e) => setCashAmount(Number(e.target.value))}
                          className="w-28 border-2 border-green-500 rounded px-2 py-1 text-xs text-right font-bold text-green-700 focus:outline-none focus:ring-1 focus:ring-green-400" />
                      </div>
                    )}

                    {(paymentMethod === "BANK" || paymentMethod === "CASH_AND_BANK") && (
                      <>
                        <div className="flex items-center justify-between gap-2">
                          <span className={cn("text-xs text-gray-500 shrink-0", isUrdu && "urdu-text")}>{t("purchases_bank")}</span>
                          <select value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)}
                            className="flex-1 border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-teal-400">
                            <option value="">{t("purchases_selectBankAccount")}</option>
                            {accounts.filter((a) => a.type === "BANK").map((a) => (
                              <option key={a.id} value={a.id}>{a.name}</option>
                            ))}
                          </select>
                        </div>
                        {accounts.filter((a) => a.type === "BANK").length === 0 && (
                          <p className={cn("text-amber-600 text-xs", isUrdu && "urdu-text")}>{t("purchases_noBankAccounts")}</p>
                        )}
                        <div className="flex items-center justify-between">
                          <span className={cn("text-xs text-gray-600 font-semibold", isUrdu && "urdu-text")}>
                            {isReturnGrn ? t("purchases_refundBank") : t("purchases_bankPaid")}
                          </span>
                          <input type="number" min={0} value={bankAmount || ""}
                            onChange={(e) => setBankAmount(Number(e.target.value))}
                            className="w-28 border-2 border-blue-500 rounded px-2 py-1 text-xs text-right font-bold text-blue-700 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                        </div>
                      </>
                    )}

                    {overpaid && (
                      <p className={cn("text-red-600 text-xs font-medium", isUrdu && "urdu-text")}>{t("purchases_overpaidError")}</p>
                    )}

                    {/* Vendor credit left over, and how it will be repaid. */}
                    {outstandingAfterPayment > 0 && (
                      <div className="border border-amber-300 bg-amber-50 rounded p-2 space-y-1.5 mt-1">
                        <div className="flex justify-between">
                          <span className={cn("text-xs text-amber-800 font-medium", isUrdu && "urdu-text")}>{t("purchases_balanceOwed")}</span>
                          <span className="font-mono text-sm font-bold text-amber-800">{formatCurrency(outstandingAfterPayment)}</span>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={cn("text-xs text-gray-500 font-medium", isUrdu && "urdu-text")}>{t("purchases_repayment")}</span>
                          {([
                            ["NONE", "purchases_repaymentNone"],
                            ["PROMISE_DAY", "purchases_repaymentPromiseDay"],
                            ["WEEKLY", "purchases_repaymentWeekly"],
                            ["MONTHLY", "purchases_repaymentMonthly"],
                          ] as const).map(([opt, key]) => (
                            <label key={opt} className="flex items-center gap-1 cursor-pointer text-xs">
                              <input type="radio" name="grnRepaymentType" checked={repaymentType === opt}
                                onChange={() => changeRepaymentType(opt)} className="accent-amber-600" />
                              <span className={cn(isUrdu && "urdu-text")}>{t(key)}</span>
                            </label>
                          ))}
                        </div>
                        {(effectiveRepaymentType === "WEEKLY" || effectiveRepaymentType === "MONTHLY") && (
                          <div className="flex items-center justify-between">
                            <span className={cn("text-xs text-gray-600 font-semibold", isUrdu && "urdu-text")}>{t("purchases_installmentCount")}</span>
                            <input type="number" min={1} value={installmentPeriods}
                              onChange={(e) => setInstallmentPeriods(e.target.value ? Math.max(1, Number(e.target.value)) : "")}
                              className="w-20 border-2 border-amber-400 rounded px-2 py-1 text-xs text-right font-bold text-amber-800 focus:outline-none focus:ring-1 focus:ring-amber-400" />
                          </div>
                        )}
                        {effectiveRepaymentType === "PROMISE_DAY" && (
                          <div className="flex items-center justify-between">
                            <span className={cn("text-xs text-gray-600 font-semibold", isUrdu && "urdu-text")}>{t("purchases_promiseDays")}</span>
                            <input type="number" min={1} value={promiseDays}
                              onChange={(e) => setPromiseDays(e.target.value ? Number(e.target.value) : "")}
                              className="w-20 border-2 border-amber-400 rounded px-2 py-1 text-xs text-right font-bold text-amber-800 focus:outline-none focus:ring-1 focus:ring-amber-400" />
                          </div>
                        )}
                        {needsPromiseDays && (
                          <p className={cn("text-amber-700 text-xs", isUrdu && "urdu-text")}>{t("purchases_promiseDaysRequired")}</p>
                        )}
                        {schedulePreview.length > 0 && (
                          <p className="text-xs text-amber-700">
                            {schedulePreview.length} x {formatCurrency(schedulePreview[0].amount)}
                            {" - "}{t("purchases_firstDue")} {formatDate(schedulePreview[0].dueDate)}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Second Save, right under the payment fields. The
                        toolbar copy at the top of the form stays — this one is
                        where the cursor already is after typing the amounts. */}
                    {can(editingGrnId ? "EDIT_GRN" : "CREATE_GRN") && (
                      <button onClick={handleSave} disabled={saving}
                        className={cn("mt-2 w-full bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white rounded-lg py-2.5 flex items-center justify-center gap-2 text-sm font-bold shadow-sm", isUrdu && "urdu-text")}>
                        <Save className="w-4 h-4" />
                        {saving ? t("purchases_saving") : editingGrnId ? t("purchases_update") : t("save")}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </main>
        </div>
      )}

      {/* ════ GRN RECORDS TAB ════════════════════════════════════════════════ */}
      {activeTab === "records" && (
        <div className="flex-1 overflow-y-auto p-4">
          <GrnRecordsTab branchId={branchId} onEditGrn={editGrnFromRecords} />
        </div>
      )}

      {/* ════ INVENTORY TAB ══════════════════════════════════════════════════ */}
      {activeTab === "inventory" && (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={invSearch} onChange={(e) => setInvSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && loadInventory()} placeholder={t("purchases_searchItemsPlaceholder")} className={cn("w-full pl-8 pr-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-400", isUrdu && "urdu-text")} />
            </div>
            <label className={cn("flex items-center gap-2 text-sm cursor-pointer", isUrdu && "urdu-text")}>
              <input type="checkbox" checked={invLowOnly} onChange={(e) => setInvLowOnly(e.target.checked)} className="rounded" />
              {t("purchases_lowStockOnly")}
            </label>
            <button onClick={loadInventory} className={cn("flex items-center gap-1 px-3 py-2 bg-teal-600 text-white rounded-lg text-sm hover:bg-teal-700", isUrdu && "urdu-text")}><RefreshCw className="w-4 h-4" /> {t("purchases_refresh")}</button>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-green-700">{invCounts.ok}</div>
              <div className={cn("text-xs text-green-600 font-medium", isUrdu && "urdu-text")}>{t("purchases_inStock")}</div>
            </div>
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-yellow-700">{invCounts.low}</div>
              <div className={cn("text-xs text-yellow-600 font-medium", isUrdu && "urdu-text")}>{t("purchases_lowStock")}</div>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-red-700">{invCounts.out}</div>
              <div className={cn("text-xs text-red-600 font-medium", isUrdu && "urdu-text")}>{t("purchases_outOfStock")}</div>
            </div>
          </div>

          {invLoading ? (
            <div className={cn("text-center text-gray-400 py-12", isUrdu && "urdu-text")}>{t("purchases_loadingInventory")}</div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className={cn("text-left px-3 py-2.5", isUrdu && "urdu-text")}>{t("purchases_itemName")}</th>
                    <th className={cn("text-center px-3 py-2.5 w-16", isUrdu && "urdu-text")}>{t("purchases_unit")}</th>
                    <th className={cn("text-right px-3 py-2.5 w-24", isUrdu && "urdu-text")}>{t("purchases_qty")}</th>
                    <th className={cn("text-right px-3 py-2.5 w-24", isUrdu && "urdu-text")}>{t("purchases_minLevel")}</th>
                    <th className={cn("text-right px-3 py-2.5 w-28", isUrdu && "urdu-text")}>{t("purchases_salePrice")}</th>
                    <th className={cn("text-center px-3 py-2.5 w-24", isUrdu && "urdu-text")}>{t("purchases_status")}</th>
                    <th className={cn("text-center px-3 py-2.5 w-28", isUrdu && "urdu-text")}>{t("actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {inventory.map((item) => (
                    <tr key={item.id} className="border-t hover:bg-gray-50">
                      <td className="px-3 py-2">
                        <div className="font-medium">{item.name}</div>
                        {/* Both codes scan: the shop's own, and the company's when the goods came with one. */}
                        <div className="text-xs text-gray-400 font-mono">
                          {item.systemBarcode}
                          {item.barcode && <span title={t("purchases_companyBarcode")}> · {item.barcode}</span>}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center text-gray-500">{item.unit}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold">{item.qty}</td>
                      <td className="px-3 py-2 text-right text-gray-500">{item.minLevel}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatCurrency(item.salePrice)}</td>
                      <td className="px-3 py-2 text-center">
                        {item.status === "OK" && <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-medium", isUrdu && "urdu-text")}><CheckCircle className="w-3 h-3" /> {t("purchases_ok")}</span>}
                        {item.status === "LOW" && <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded-full text-xs font-medium", isUrdu && "urdu-text")}><AlertTriangle className="w-3 h-3" /> {t("purchases_low")}</span>}
                        {item.status === "OUT" && <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-700 rounded-full text-xs font-medium", isUrdu && "urdu-text")}><XCircle className="w-3 h-3" /> {t("purchases_out")}</span>}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-center gap-1">
                          {can("ADJUST_STOCK") && (
                            <button onClick={() => { setAdjustItem(item); setAdjustType("ADD"); setAdjustQty(1); setAdjustReason(""); }} title={t("purchases_adjustStockTitle")} className="p-1.5 text-teal-600 hover:bg-teal-50 rounded"><SlidersHorizontal className="w-4 h-4" /></button>
                          )}
                          {can("PRINT_BARCODE") && (
                            <button onClick={() => setBarcodeInvItem(item)} title={t("purchases_printBarcodeTitle")} className="p-1.5 text-gray-500 hover:bg-gray-100 rounded"><Barcode className="w-4 h-4" /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {inventory.length === 0 && (
                    <tr><td colSpan={7} className="text-center text-gray-400 py-12"><Package className="w-10 h-10 mx-auto mb-2 opacity-30" /><div className={cn(isUrdu && "urdu-text")}>{t("purchases_noItemsFound")}</div></td></tr>
                  )}
                </tbody>
              </table>
              <Pagination page={invPage} pageSize={INV_PAGE_SIZE} total={invTotal} onPageChange={setInvPage} />
            </div>
          )}
        </div>
      )}

      {/* Vendor Search */}
      {showVendorSearch && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/50">
          <div className="bg-white rounded-xl shadow-2xl w-[500px] max-h-[70vh] flex flex-col">
            <div className="p-3 border-b flex items-center gap-2">
              <Search className="w-4 h-4 text-gray-400" />
              <input autoFocus value={vendorQuery} onChange={(e) => setVendorQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setShowVendorSearch(false);
                  if (e.key === "Enter" && vendors.length > 0) selectVendor(vendors[0]);
                }}
                placeholder={t("purchases_searchVendorPlaceholder")} className={cn("flex-1 text-sm focus:outline-none", isUrdu && "urdu-text")} />
              <button onClick={() => setShowVendorSearch(false)}><X className="w-4 h-4 text-gray-400" /></button>
            </div>
            <div className="overflow-y-auto flex-1">
              {vendors.map((v) => (
                <button key={v.id} onClick={() => selectVendor(v)} className="w-full text-left px-4 py-2.5 border-b hover:bg-teal-50 text-sm">
                  <div className="font-medium">{v.accountId} — {v.name}</div>
                  <div className="text-xs text-gray-400">{[v.city, v.phone || v.mobile].filter(Boolean).join(" · ")}</div>
                </button>
              ))}
              {vendors.length === 0 && (
                <div className={cn("text-center text-gray-400 text-sm py-8", isUrdu && "urdu-text")}>
                  {vendorsLoading ? t("purchases_searchingVendors") : t("purchases_noVendorsFound")}
                </div>
              )}
            </div>
            {/* No such vendor yet — add one here, seeded with what was typed,
                rather than abandoning the GRN to do it on the Parties page. */}
            {can("ADD_PARTY") && (
              <button onClick={() => openAddVendor(vendorQuery.trim())}
                className={cn("w-full flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border-t rounded-b-xl", isUrdu && "urdu-text")}>
                <UserPlus className="w-4 h-4 shrink-0" />
                <span className="truncate">
                  {vendorQuery.trim() ? `${t("purchases_addAsNewVendor")}: “${vendorQuery.trim()}”` : t("purchases_addNewVendor")}
                </span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Add a vendor from the GRN; the new one is selected straight away. */}
      <PartyFormModal
        open={showAddVendor}
        onClose={() => { setShowAddVendor(false); setAddVendorName(""); }}
        onSaved={(saved) => selectVendor(saved)}
        defaultType="VENDOR"
        defaultName={addVendorName || undefined}
      />
      {/* Edit the selected vendor in place. */}
      <PartyFormModal
        open={showEditVendor}
        onClose={() => setShowEditVendor(false)}
        editParty={selectedParty}
        onSaved={(saved) => selectVendor(saved)}
      />

      {/* Stock Adjust Modal */}
      {adjustItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-2xl w-96 p-6">
            <h3 className={cn("text-lg font-bold mb-1", isUrdu && "urdu-text")}>{t("purchases_adjustStockTitle")}</h3>
            <p className="text-sm text-gray-500 mb-1">{adjustItem.name}</p>
            <p className={cn("text-sm mb-4", isUrdu && "urdu-text")}>{t("purchases_current")}: <span className="font-bold">{adjustItem.qty} {adjustItem.unit}</span></p>
            <div className="space-y-3">
              <div className="flex gap-3">
                <button onClick={() => setAdjustType("ADD")} className={cn(`flex-1 py-2 rounded-lg text-sm font-medium border ${adjustType === "ADD" ? "bg-teal-600 text-white border-teal-600" : "bg-white text-gray-700 hover:bg-gray-50"}`, isUrdu && "urdu-text")}>{t("purchases_addBtn")}</button>
                <button onClick={() => setAdjustType("SUBTRACT")} className={cn(`flex-1 py-2 rounded-lg text-sm font-medium border ${adjustType === "SUBTRACT" ? "bg-red-500 text-white border-red-500" : "bg-white text-gray-700 hover:bg-gray-50"}`, isUrdu && "urdu-text")}>{t("purchases_subtractBtn")}</button>
              </div>
              <div>
                <label className={cn("block text-xs text-gray-500 mb-1", isUrdu && "urdu-text")}>{t("purchases_quantity")}</label>
                <input type="number" min={0.001} step={1} value={adjustQty} onChange={(e) => setAdjustQty(Number(e.target.value))} className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
              </div>
              <div>
                <label className={cn("block text-xs text-gray-500 mb-1", isUrdu && "urdu-text")}>{t("purchases_reasonOptional")}</label>
                <input value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} placeholder={t("purchases_reasonPlaceholder")} className={cn("w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400", isUrdu && "urdu-text")} />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={handleAdjust} disabled={adjustSaving || adjustQty <= 0} className={cn("flex-1 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-60", isUrdu && "urdu-text")}>{adjustSaving ? t("purchases_saving") : t("purchases_confirmAdjustment")}</button>
              <button onClick={() => setAdjustItem(null)} className={cn("px-4 py-2 border rounded-lg text-sm hover:bg-gray-50", isUrdu && "urdu-text")}>{t("cancel")}</button>
            </div>
          </div>
        </div>
      )}

      {/* Print Modals */}
      {showPrintA5 && <GRNPrintModal grn={grnSummaryForPrint} lines={linesForPrint} storeName={store?.name ?? ""} storeAddress={store?.address ?? undefined} storePhone={store?.phone ?? undefined} size="A5" onClose={() => setShowPrintA5(false)} />}
      {showPrintA4 && <GRNPrintModal grn={grnSummaryForPrint} lines={linesForPrint} storeName={store?.name ?? ""} storeAddress={store?.address ?? undefined} storePhone={store?.phone ?? undefined} size="A4" onClose={() => setShowPrintA4(false)} />}
      {/* Item search results. Rendered here, pinned to viewport coordinates,
          rather than absolutely inside the row — the table wrapper's
          `overflow-hidden` clipped the in-row version to a single row's height
          and hid everything below it. */}
      {searchRowId && searchPopupPos && (itemResults.length > 0 || itemQuery.trim().length > 0) && (
        <div
          className="fixed z-[100] bg-white border border-gray-200 rounded-lg shadow-2xl overflow-hidden"
          style={{ top: searchPopupPos.top, left: searchPopupPos.left, width: searchPopupPos.width }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="max-h-56 overflow-y-auto">
            {itemResults.map((item) => (
              <button key={item.id} onClick={() => selectItemForLine(searchRowId, item)} className="w-full text-left px-3 py-1.5 hover:bg-teal-50 border-b last:border-0 text-xs">
                <div className="font-medium">{item.name}</div>
                <div className={cn("text-gray-500", isUrdu && "urdu-text")}>
                  {item.unit} · {t("purchases_costLabel")}: {formatCurrency(item.purchasePrice)} · {t("purchases_saleLabel")}: {formatCurrency(item.salePrice)} · {t("purchases_stockLabel")}: {formatStock(item.currentStock, item, unitCfg).primary}
                  {(() => {
                    const alt = formatStock(item.currentStock, item, unitCfg).secondary;
                    return alt ? <span className="text-gray-400"> ({alt})</span> : null;
                  })()}
                </div>
              </button>
            ))}
          </div>
          {/* Nothing in the catalogue matches what was typed — offer to add it
              rather than making the operator leave the GRN to do it. */}
          {itemQuery.trim().length > 0 && can("ADD_ITEM") && (
            <button
              onClick={() => openAddItem(itemQuery.trim())}
              className={cn("w-full flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border-t", isUrdu && "urdu-text")}
            >
              <PackagePlus className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{t("scan_addAsNewItem")}: “{itemQuery.trim()}”</span>
            </button>
          )}
        </div>
      )}

      {/* Quick add — from the toolbar button or an empty item search. The
          saved item drops straight onto the GRN. */}
      <ItemFormModal
        open={showAddItem}
        onClose={() => { setShowAddItem(false); setAddItemName(""); }}
        onSaved={handleItemCreated}
        branchId={branchId}
        defaultUnit="GAZ"
        defaultName={addItemName || undefined}
      />

      {showBarcode && <BarcodePrintModal items={barcodeItems} double={false} onClose={() => setShowBarcode(false)} />}
      {showBarcodeDouble && <BarcodePrintModal items={barcodeItems} double={true} onClose={() => setShowBarcodeDouble(false)} />}
      {barcodeInvItem && <BarcodePrintModal items={[{ itemId: barcodeInvItem.id, itemName: barcodeInvItem.name, barcode: barcodeInvItem.barcode, systemBarcode: barcodeInvItem.systemBarcode, saleRate: barcodeInvItem.salePrice, qty: 1, unit: barcodeInvItem.unit }]} double={false} onClose={() => setBarcodeInvItem(null)} />}
    </div>
  );
}
