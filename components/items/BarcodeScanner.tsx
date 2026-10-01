"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Barcode, RefreshCw, Search, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn, formatCurrency } from "@/lib/utils";
import ItemFormModal from "@/components/items/ItemFormModal";

/**
 * The union of everything the sales screen and the GRN screen each need off a
 * single scan, so one component can feed both.
 */
export type ScannedItem = {
  id: string; name: string; unit: string; barcode?: string; systemBarcode?: string;
  purchaseUnit?: string | null; piecesPerBundle?: number | null;
  clothType?: string | null;
  purchasePrice: number; salePrice: number; altSalePrice?: number;
  discountRS: number; discountPct: number; currentStock: number;
};

/**
 * `GET /api/items` rows and the raw `Item` that `POST /api/items` returns are
 * not the same shape: the created row carries Prisma `Decimal`s (which arrive
 * over JSON as strings) and has `openingStock` where the list has the derived
 * `currentStock`. Both go through here so callers never have to care which
 * one they were handed.
 */
export function normalizeScannedItem(raw: any): ScannedItem {
  return {
    id: raw.id,
    name: raw.name,
    unit: raw.unit,
    purchaseUnit: raw.purchaseUnit ?? null,
    piecesPerBundle: raw.piecesPerBundle ?? null,
    clothType: raw.clothType ?? null,
    barcode: raw.barcode ?? undefined,
    systemBarcode: raw.systemBarcode ?? undefined,
    purchasePrice: Number(raw.purchasePrice ?? 0),
    salePrice: Number(raw.salePrice ?? 0),
    altSalePrice: raw.altSalePrice == null ? undefined : Number(raw.altSalePrice),
    discountRS: Number(raw.discountRS ?? 0),
    discountPct: Number(raw.discountPct ?? 0),
    currentStock: Number(raw.currentStock ?? raw.openingStock ?? 0),
  };
}

/**
 * Whether `code` is one of the item's two barcodes: the shop's own system code
 * or the company barcode off the packaging. Exact equality only — an empty
 * code never matches.
 */
export function matchesBarcode(
  item: { barcode?: string | null; systemBarcode?: string | null },
  code: string
): boolean {
  if (!code) return false;
  return item.systemBarcode === code || (!!item.barcode && item.barcode === code);
}

type Props = {
  branchId: string;
  /**
   * Called once per resolved scan — matched, attached, or freshly created.
   * `token` is whatever the caller passed to `scan()`, echoed back so the page
   * can tell which of its own inputs the code came from. Undefined for a scan
   * made in this component's own field.
   */
  onItem: (item: ScannedItem, token?: string) => void;
  /** Unit pre-selected in the "create new item" form. */
  defaultUnit?: string;
  /**
   * Also pick up a scan typed while focus is outside any field. A scanner is a
   * keyboard, so without this a scan is lost unless the operator first clicks
   * the box — which on the sales screen, where six rows of inputs compete for
   * focus, is most of the time.
   */
  globalCapture?: boolean;
  inputClassName?: string;
  className?: string;
};

/**
 * Lets a page feed the scanner a code captured somewhere else — the sales
 * screen's per-row item box, where the cursor actually sits while ringing up a
 * sale — and reuse the whole match / attach / create flow rather than
 * reimplementing it against a second copy of the rules.
 */
export type BarcodeScannerHandle = {
  /** `token` is echoed back to `onItem` if and when the code resolves. */
  scan: (code: string, token?: string) => void;
  focus: () => void;
};

/** A scanner types a whole code in well under this; a person cannot. */
export const SCAN_KEY_GAP_MS = 120;
/** Shorter than this is far more likely to be stray typing than a barcode. */
export const MIN_SCAN_LENGTH = 4;

function BarcodeScanner({
  branchId,
  onItem,
  defaultUnit = "PCS",
  globalCapture = false,
  inputClassName,
  className,
}: Props, ref: React.Ref<BarcodeScannerHandle>) {
  const { t, isUrdu } = useI18n();

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  /** A scanned code that matched nothing — drives the chooser below. */
  const [miss, setMiss] = useState<string | null>(null);
  const [attachQuery, setAttachQuery] = useState("");
  const [attachResults, setAttachResults] = useState<ScannedItem[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [newItemBarcode, setNewItemBarcode] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  // Held in a ref so the window listener below can stay registered once
  // instead of being torn down on every parent render — `onItem` is an inline
  // arrow at every call site.
  const onItemRef = useRef(onItem);
  useEffect(() => { onItemRef.current = onItem; });
  // Mirrors `busy` for that same listener, which reads it outside of render.
  // Written where the state is, so the guard is never a render behind.
  const busyRef = useRef(false);
  // Set while resolving a code that arrived from somewhere else on the page
  // (see `BarcodeScannerHandle`). It marks the whole flow — including a detour
  // through the chooser — as belonging to that caller, who owns both where the
  // cursor goes next and what to do with the item, so this box must not grab
  // focus back. Undefined means the scan was made here.
  const tokenRef = useRef<string | undefined>(undefined);

  const focusInput = useCallback(() => inputRef.current?.focus(), []);
  const refocusIfOwned = useCallback(() => { if (tokenRef.current === undefined) focusInput(); }, [focusInput]);

  /**
   * One scan. Only an *exact* `barcode` equality counts as a hit: the search
   * endpoint also does partial name/brand matching, which must never silently
   * pick a different item than the one in the operator's hand. An empty-string
   * barcode is falsy and so never matches.
   */
  const lookup = useCallback(async (rawCode: string, token?: string) => {
    const scanned = rawCode.trim();
    if (!scanned) return;
    tokenRef.current = token;
    busyRef.current = true;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/items?search=${encodeURIComponent(scanned)}&branchId=${branchId}&limit=5`
      );
      const data = await res.json();
      const match = (data.items ?? []).find((i: any) => matchesBarcode(i, scanned));
      setCode("");
      if (!match) {
        setMiss(scanned);
        setAttachQuery("");
        setAttachResults([]);
        return;
      }
      onItemRef.current(normalizeScannedItem(match), token);
    } catch {
      toast.error(t("scan_failed"));
    } finally {
      busyRef.current = false;
      setBusy(false);
      refocusIfOwned();
    }
  }, [branchId, refocusIfOwned, t]);

  useImperativeHandle(ref, () => ({
    scan: (c: string, token?: string) => { void lookup(c, token); },
    focus: focusInput,
  }), [lookup, focusInput]);

  // Scans that land while focus is elsewhere on the page.
  useEffect(() => {
    if (!globalCapture) return;
    let buffer = "";
    let lastKeyAt = 0;

    function handleKey(e: KeyboardEvent) {
      // Anything typed into a real field belongs to that field — including
      // this component's own input, which has its own Enter handler.
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      if (busyRef.current || e.ctrlKey || e.metaKey || e.altKey) return;

      const now = Date.now();
      if (now - lastKeyAt > SCAN_KEY_GAP_MS) buffer = "";
      lastKeyAt = now;

      if (e.key === "Enter") {
        const scanned = buffer;
        buffer = "";
        if (scanned.length >= MIN_SCAN_LENGTH) {
          e.preventDefault();
          void lookup(scanned);
        }
        return;
      }
      if (e.key.length === 1) buffer += e.key;
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [globalCapture, lookup]);

  // Item search inside the "unknown barcode" chooser.
  async function searchForAttach(q: string) {
    setAttachQuery(q);
    if (!q.trim()) { setAttachResults([]); return; }
    const res = await fetch(
      `/api/items?search=${encodeURIComponent(q)}&branchId=${branchId}&limit=8`
    );
    const data = await res.json();
    setAttachResults((data.items ?? []).map(normalizeScannedItem));
  }

  /** Writes the scanned code onto an existing item, then hands it to the page. */
  async function attachBarcodeTo(item: ScannedItem) {
    if (!miss) return;
    setAttaching(true);
    try {
      const res = await fetch(`/api/items/${item.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ barcode: miss }),
      });
      // Surface the route's reason — since the barcode routes started rejecting
      // duplicates with a 409, "attach failed" on its own says nothing.
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error);
      toast.success(`${item.name} — ${t("scan_attached")}`);
      setMiss(null);
      onItemRef.current({ ...item, barcode: miss }, tokenRef.current);
      refocusIfOwned();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : t("scan_attachFailed"));
    } finally {
      setAttaching(false);
    }
  }

  // A freshly created item goes straight onto the document — that was the
  // point of scanning an unknown code.
  function handleItemCreated(created: any) {
    setNewItemBarcode(null);
    onItemRef.current(normalizeScannedItem(created), tokenRef.current);
    refocusIfOwned();
  }

  return (
    <>
      {/* A USB scanner types the code and sends Enter, so this is just an input
          with an Enter handler — no driver or library involved. Some models
          send Tab instead, which is handled the same way. */}
      <div className={cn("flex items-center gap-2", className)}>
        <Barcode className="w-4 h-4 text-gray-400 shrink-0" />
        <input
          ref={inputRef}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Tab") {
              if (!code.trim()) return;
              e.preventDefault();
              void lookup(code);
            }
          }}
          placeholder={t("scan_placeholder")}
          className={cn(
            "w-56 border-2 border-teal-400 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-teal-500",
            isUrdu && "urdu-text",
            inputClassName
          )}
        />
        {busy && <RefreshCw className="w-3.5 h-3.5 text-teal-500 animate-spin shrink-0" />}
      </div>

      {/* Unknown code. Most of this catalogue has no barcode yet, so the usual
          answer is "attach it to an item that already exists" — creating a
          second copy of an existing item would be the wrong default. */}
      {miss && (
        <div className="fixed inset-0 bg-black/50 z-[110] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <h3 className={cn("font-semibold text-gray-800", isUrdu && "urdu-text")}>
                {t("scan_unknownBarcode")}
              </h3>
              <button onClick={() => { setMiss(null); refocusIfOwned(); }} className="text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div className="text-center font-mono text-sm bg-gray-50 border rounded py-2">{miss}</div>

              <div>
                <p className={cn("text-xs font-semibold text-gray-600 mb-1", isUrdu && "urdu-text")}>
                  {t("scan_attachToExisting")}
                </p>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2 top-1/2 -translate-y-1/2" />
                  <input
                    autoFocus
                    value={attachQuery}
                    onChange={(e) => searchForAttach(e.target.value)}
                    placeholder={t("scan_searchItemPlaceholder")}
                    className={cn("w-full border rounded pl-7 pr-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-teal-400", isUrdu && "urdu-text")}
                  />
                </div>
              </div>

              <div className="max-h-56 overflow-y-auto border rounded divide-y">
                {attachResults.map((it) => (
                  <button
                    key={it.id}
                    disabled={attaching}
                    onClick={() => attachBarcodeTo(it)}
                    className="w-full text-left px-3 py-2 hover:bg-teal-50 disabled:opacity-50 flex items-center justify-between gap-2"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium truncate">{it.name}</span>
                      <span className="block text-xs text-gray-500">
                        {it.unit} · {formatCurrency(it.salePrice)}
                        {it.barcode ? ` · ${it.barcode}` : ""}
                      </span>
                    </span>
                    {it.barcode ? (
                      <span className={cn("text-xs text-amber-600 shrink-0", isUrdu && "urdu-text")}>
                        {t("scan_willReplaceBarcode")}
                      </span>
                    ) : null}
                  </button>
                ))}
                {attachQuery.trim() && attachResults.length === 0 && (
                  <p className={cn("text-center text-xs text-gray-400 py-4", isUrdu && "urdu-text")}>
                    {t("scan_noItemsFound")}
                  </p>
                )}
              </div>
            </div>

            <div className="px-4 pb-4">
              <button
                onClick={() => { const c = miss; setMiss(null); setNewItemBarcode(c); }}
                className={cn("w-full px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium", isUrdu && "urdu-text")}
              >
                {t("scan_createNewItem")}
              </button>
            </div>
          </div>
        </div>
      )}

      <ItemFormModal
        open={newItemBarcode !== null}
        onClose={() => { setNewItemBarcode(null); refocusIfOwned(); }}
        branchId={branchId}
        defaultUnit={defaultUnit}
        defaultBarcode={newItemBarcode ?? undefined}
        onSaved={handleItemCreated}
      />
    </>
  );
}

export default forwardRef(BarcodeScanner);
