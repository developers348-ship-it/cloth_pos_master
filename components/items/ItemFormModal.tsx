"use client";

import { useState, useEffect } from "react";
import toast from "react-hot-toast";
import Link from "next/link";
import { AlertTriangle, Barcode } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { usePermissions } from "@/lib/permissions-client";
import { cn, isBelowCost, netUnitPrice, profitPctOf, saleFromProfitPct } from "@/lib/utils";
import NumberInput from "@/components/ui/NumberInput";
import BarcodePrintModal from "@/components/purchases/BarcodePrintModal";
import { useUnitConfig } from "@/lib/use-unit-config";
import { SUIT_METRES, STOCK_UNITS, convertQty, formatQty, isStockUnit, isTxUnit, type TxUnit } from "@/lib/units";

export type ItemRecord = {
  id: string; name: string; description?: string;
  categoryId?: string; brandId?: string; groupId?: string;
  unit: string; purchaseUnit?: string | null; piecesPerBundle?: number | null;
  clothType?: string | null;
  purchasePrice: number; salePrice: number; altSalePrice?: number;
  discountRS: number; discountPct: number;
  openingStock: number; minLevel: number; barcode?: string;
  /** Assigned by the database on insert and read-only here. */
  systemBarcode?: string;
  /**
   * Derived from `ItemStock` by `GET /api/items`, not a column on `Item`. The
   * Quantity box seeds from it on an edit — `openingStock` is the figure the
   * item was created with and never moves, so it is the wrong number to show
   * on a form whose whole point is what is on the shelf now.
   */
  currentStock?: number;
};

type CatalogEntry = { id: string; name: string };
/**
 * `stockQty` is form-only: it is what the Quantity box holds, and where it goes
 * on save depends on whether this is a create or an edit (see the payload
 * below). It is not an `Item` column and is never written as one.
 */
type FormState = Partial<ItemRecord> & { stockQty?: number };

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: (item: any) => void;
  editItem?: ItemRecord | null;
  branchId?: string;
  defaultUnit?: string;
  /** Pre-fills the barcode when creating a new item — used by the GRN screen,
   *  where a scan that matched nothing opens this form with the code already in. */
  defaultBarcode?: string;
  /** Pre-fills the name — used when an item search came back empty and the
   *  operator adds the thing they just typed. */
  defaultName?: string;
};

export default function ItemFormModal({ open, onClose, onSaved, editItem, branchId, defaultUnit = "PCS", defaultBarcode, defaultName }: Props) {
  const { t, isUrdu } = useI18n();
  const { can } = usePermissions();
  const [form, setForm] = useState<FormState>({});
  const [saving, setSaving] = useState(false);
  const [showBarcode, setShowBarcode] = useState(false);
  const [showBelowCost, setShowBelowCost] = useState(false);
  const [categories, setCategories] = useState<CatalogEntry[]>([]);
  const [brands, setBrands] = useState<CatalogEntry[]>([]);
  const [groups, setGroups] = useState<CatalogEntry[]>([]);
  /**
   * The active item already holding the typed barcode, or null when it is free;
   * `undefined` while the lookup is in flight. The server is the authority (both
   * write routes answer 409 — see lib/items.ts `findBarcodeOwner`); this is so
   * the operator finds out at the field, in their own language, rather than
   * after filling the rest of the form.
   */
  const [barcodeOwner, setBarcodeOwner] = useState<{ id: string; name: string } | null | undefined>(null);

  const unitCfg = useUnitConfig();
  const sellUnit = isStockUnit(form.unit) ? form.unit : "PCS";

  /**
   * Whether the Quantity box has been moved off what the shelf actually holds.
   * Compared at 4dp because that is `ItemStock.qty`'s precision — a difference
   * finer than the column can store is not a change.
   */
  const stockChanged =
    !!editItem &&
    Number((form.stockQty ?? 0).toFixed(4)) !==
      Number(Number(editItem.currentStock ?? 0).toFixed(4));

  // A buy unit only makes sense inside the sell unit's family: cloth is bought
  // by the gaz or the metre, countables by the piece or the bundle. Offering
  // the others would invite a choice that can only ever be refused.
  const buyUnitChoices: TxUnit[] =
    sellUnit === "PCS" ? ["PCS", "BUNDLE"] : ["GAZ", "MTR"];

  /**
   * What one bought unit comes to in sell units, spelled out — so the
   * relationship is visible here rather than discovered on a stock report.
   * Blank whenever the two units are the same, which is the common case.
   */
  const conversionNote = (() => {
    const buy = form.purchaseUnit;
    if (!isTxUnit(buy) || buy === sellUnit) return null;
    const ppb = Number(form.piecesPerBundle ?? 0);
    if (buy === "BUNDLE" && !(ppb > 0)) return t("items_bundleNeedsSize");
    try {
      const one = convertQty(1, buy, sellUnit, { ...unitCfg, piecesPerBundle: ppb });
      return `1 ${buy} = ${formatQty(one, 4)} ${sellUnit}`;
    } catch {
      return null;
    }
  })();

  useEffect(() => {
    if (!open) return;
    setForm(editItem ? { ...editItem, stockQty: Number(editItem.currentStock ?? 0) } : {
      unit: defaultUnit, discountRS: 0, discountPct: 0, openingStock: 0, minLevel: 0, stockQty: 0,
      categoryId: "", brandId: "", groupId: "",
      barcode: defaultBarcode ?? "",
      name: defaultName ?? "",
    });
  }, [open, editItem, defaultUnit, defaultBarcode, defaultName]);

  // Debounced duplicate check. A scanner fires the whole code in one burst, so
  // 350ms after the last character is one request per scan, not per digit.
  useEffect(() => {
    const code = (form.barcode ?? "").trim();
    if (!open || !code) { setBarcodeOwner(null); return; }
    setBarcodeOwner(undefined);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/items?q=${encodeURIComponent(code)}&limit=10`, { signal: controller.signal });
        const data = await res.json();
        // `q` is a `contains` search across name/brand/category/barcode, so the
        // rows come back wider than asked for — narrow to an exact barcode hit,
        // case-insensitively, matching what the server rejects on.
        const hit = (data.items ?? []).find(
          (i: { id: string; name: string; barcode?: string | null; systemBarcode?: string }) =>
            i.id !== editItem?.id &&
            ((i.barcode ?? "").trim().toLowerCase() === code.toLowerCase() || i.systemBarcode === code)
        );
        setBarcodeOwner(hit ?? null);
      } catch {
        // Offline or aborted: stay silent and let the server have the last word.
        if (!controller.signal.aborted) setBarcodeOwner(null);
      }
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, form.barcode, editItem?.id]);

  useEffect(() => {
    if (!open) return;
    async function loadCatalog() {
      const [catRes, brandRes, groupRes] = await Promise.all([
        fetch("/api/catalog/categories"),
        fetch("/api/catalog/brands"),
        fetch("/api/catalog/groups"),
      ]);
      const [catData, brandData, groupData] = await Promise.all([
        catRes.json(), brandRes.json(), groupRes.json(),
      ]);
      setCategories(catData.items ?? []);
      setBrands(brandData.items ?? []);
      setGroups(groupData.items ?? []);
    }
    loadCatalog();
  }, [open]);

  const belowCost = [form.salePrice, form.altSalePrice]
    .filter((p): p is number => (p ?? 0) > 0)
    .some((p) => isBelowCost(netUnitPrice(p, 1, form.discountRS ?? 0, form.discountPct ?? 0), form.purchasePrice));

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave(allowBelowCost = false) {
    if (!form.name?.trim()) { toast.error(t("items_nameRequiredMsg")); return; }
    if (!form.salePrice) { toast.error(t("items_salePriceRequiredMsg")); return; }
    // Blocked on a known duplicate. A check still in flight (`undefined`) is not
    // a block — the route re-runs it and answers 409 if it lands late.
    if (barcodeOwner) {
      toast.error(`${t("items_barcodeTaken")} ${barcodeOwner.name}`);
      return;
    }
    // The catalog discount is applied automatically at the till, so a price
    // under cost here repeats on every sale. Allowed, but only on purpose.
    if (belowCost && !allowBelowCost) { setShowBelowCost(true); return; }
    setShowBelowCost(false);

    const method = editItem ? "PUT" : "POST";
    const url = editItem ? `/api/items/${editItem.id}` : "/api/items";
    // Built field by field rather than spread from `form`. The rows this modal
    // is opened with come from GET /api/items, which also carries the derived
    // `currentStock` — spreading that into the body used to make every edit fail
    // Prisma validation. The route whitelists the columns too (lib/items.ts);
    // this just keeps the client honest about what it is sending.
    const payload: Record<string, unknown> = {
      name: form.name?.trim(),
      description: form.description ?? "",
      unit: form.unit,
      purchaseUnit: form.purchaseUnit || null,
      piecesPerBundle: form.piecesPerBundle ?? null,
      clothType: form.clothType || null,
      barcode: form.barcode ?? "",
      categoryId: form.categoryId || null,
      brandId: form.brandId || null,
      groupId: form.groupId || null,
      purchasePrice: form.purchasePrice ?? 0,
      salePrice: form.salePrice ?? 0,
      altSalePrice: form.altSalePrice ?? null,
      discountRS: form.discountRS ?? 0,
      discountPct: form.discountPct ?? 0,
      minLevel: form.minLevel ?? 0,
      // Opening stock is only meaningful when the item is first created; on an
      // edit it belongs to ItemStock and is changed through a stock adjustment.
      // One box, two jobs. On create it is the opening figure *and* the branch's
      // starting ItemStock row. On edit it is the live stock, set absolutely —
      // and `openingStock` is deliberately not resent, so the item keeps the
      // quantity it was created with.
      //
      // On an edit it is sent **only when it actually changed**. The route gates
      // `stockQty` on ADJUST_STOCK as well as EDIT_ITEM, and those two are
      // separately revocable on the roles page — sending it unconditionally
      // would 403 every ordinary edit by anyone holding one permission but not
      // the other.
      ...(editItem
        ? stockChanged
          ? { branchId, stockQty: form.stockQty ?? 0 }
          : {}
        : { branchId, openingStock: form.stockQty ?? 0 }),
    };

    setSaving(true);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const saved = await res.json();
      // Surface the server's reason (a 403 from the permission guard, a
      // validation message) instead of the generic "failed to save".
      if (!res.ok) throw new Error(saved?.error);
      toast.success(editItem ? t("items_updatedMsg") : t("items_addedMsg"));
      onSaved(saved);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : t("items_failedToSave"));
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b flex items-center justify-between sticky top-0 bg-white z-10">
          <h3 className={cn("font-bold text-gray-800 text-lg", isUrdu && "urdu-text")}>
            {editItem ? t("items_editItem") : t("items_addNewItem")}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>

        <div className="p-6 grid grid-cols-2 gap-4">
          {/* Item Name */}
          <div className="col-span-2">
            <label className={cn("block text-xs font-semibold text-gray-600 mb-1", isUrdu && "urdu-text")}>{t("items_itemNameRequired")}</label>
            <input
              type="text" autoFocus
              value={form.name ?? ""}
              onChange={(e) => set("name", e.target.value)}
              className={cn("w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400", isUrdu && "urdu-text")}
              placeholder={t("items_enterItemName")}
            />
          </div>

          {/* Category Dropdown */}
          <div>
            <label className={cn("block text-xs font-semibold text-gray-600 mb-1", isUrdu && "urdu-text")}>
              {t("items_category")}
              <span className={cn("text-gray-400 font-normal ml-1", isUrdu && "urdu-text")}>{t("items_optional")}</span>
            </label>
            <select
              value={form.categoryId ?? ""}
              onChange={(e) => set("categoryId", e.target.value)}
              className={cn("w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white", isUrdu && "urdu-text")}
            >
              <option value="">{t("items_none")}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {categories.length === 0 && (
              <p className={cn("text-xs text-orange-500 mt-1", isUrdu && "urdu-text")}>
                {t("items_noCategoriesYet")}{" "}
                <Link href="/dashboard/catalog" target="_blank" className="underline">{t("items_addInCatalog")}</Link>
              </p>
            )}
          </div>

          {/* Brand Dropdown */}
          <div>
            <label className={cn("block text-xs font-semibold text-gray-600 mb-1", isUrdu && "urdu-text")}>
              {t("items_brand")}
              <span className={cn("text-gray-400 font-normal ml-1", isUrdu && "urdu-text")}>{t("items_optional")}</span>
            </label>
            <select
              value={form.brandId ?? ""}
              onChange={(e) => set("brandId", e.target.value)}
              className={cn("w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white", isUrdu && "urdu-text")}
            >
              <option value="">{t("items_none")}</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>

          {/* Group Dropdown */}
          <div>
            <label className={cn("block text-xs font-semibold text-gray-600 mb-1", isUrdu && "urdu-text")}>
              {t("items_group")}
              <span className={cn("text-gray-400 font-normal ml-1", isUrdu && "urdu-text")}>{t("items_optional")}</span>
            </label>
            <select
              value={form.groupId ?? ""}
              onChange={(e) => set("groupId", e.target.value)}
              className={cn("w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white", isUrdu && "urdu-text")}
            >
              <option value="">{t("items_none")}</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>

          {/* Sell Unit — the unit the item is priced and sold in, and the
              unit its stock is held in. Relabelled from a plain "Unit" because
              an item can now be *bought* in another one, and which of the two
              this box means is the whole question. */}
          <div>
            <label className={cn("block text-xs font-semibold text-gray-600 mb-1", isUrdu && "urdu-text")}>{t("items_sellUnit")}</label>
            <select
              value={form.unit ?? defaultUnit}
              onChange={(e) => set("unit", e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white"
            >
              {STOCK_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
            <p className={cn("mt-1 text-[11px] text-gray-400 leading-tight", isUrdu && "urdu-text")}>{t("items_sellUnitHint")}</p>
          </div>

          {/* Buy Unit — informational. It pre-selects the GRN's buy-unit
              dropdown and drives the "bought as" line under a stock figure;
              nothing calculates from it, because the conversion that matters
              happens on the GRN line itself. */}
          <div>
            <label className={cn("block text-xs font-semibold text-gray-600 mb-1", isUrdu && "urdu-text")}>
              {t("items_buyUnit")} <span className={cn("text-gray-400 font-normal", isUrdu && "urdu-text")}>{t("items_optional")}</span>
            </label>
            <select
              value={form.purchaseUnit ?? ""}
              onChange={(e) => set("purchaseUnit", e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white"
            >
              <option value="">{t("items_sameAsSellUnit")}</option>
              {buyUnitChoices.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
            {conversionNote && (
              <p className="mt-1 text-[11px] text-amber-700 leading-tight">{conversionNote}</p>
            )}
          </div>

          {/* Pieces per Bundle — only meaningful for countables. A bundle is a
              counting convenience, not a sealed pack: stock stays in pieces and
              part-selling a bundle is normal, so this is only ever used to
              expand a bundle into pieces when goods are received. */}
          {(form.unit ?? defaultUnit) === "PCS" && (
            <div>
              <label className={cn("block text-xs font-semibold text-gray-600 mb-1", isUrdu && "urdu-text")}>
                {t("items_piecesPerBundle")} <span className={cn("text-gray-400 font-normal", isUrdu && "urdu-text")}>{t("items_optional")}</span>
              </label>
              <NumberInput
                value={Number(form.piecesPerBundle ?? 0)}
                blankZero
                min={0}
                step={1}
                transform={(n) => Math.max(0, Math.round(n))}
                onChange={(n) => set("piecesPerBundle", n > 0 ? n : null)}
                placeholder="0"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
              />
              <p className={cn("mt-1 text-[11px] text-gray-400 leading-tight", isUrdu && "urdu-text")}>{t("items_piecesPerBundleHint")}</p>
            </div>
          )}

          {/* Type — optional, cloth only. It sets how long a suit is, which
              the sales screen's Suit button enters as the quantity. */}
          {sellUnit !== "PCS" && (
            <div>
              <label className={cn("block text-xs font-semibold text-gray-600 mb-1", isUrdu && "urdu-text")}>
                {t("items_clothType")} <span className={cn("text-gray-400 font-normal", isUrdu && "urdu-text")}>{t("items_optional")}</span>
              </label>
              <select
                value={form.clothType ?? ""}
                onChange={(e) => set("clothType", e.target.value || null)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white"
              >
                <option value="">{t("items_none")}</option>
                <option value="COTTON">{t("items_clothType_COTTON")} ({SUIT_METRES.COTTON} MTR)</option>
                <option value="WASH_WEAR">{t("items_clothType_WASH_WEAR")} ({SUIT_METRES.WASH_WEAR} MTR)</option>
              </select>
              <p className={cn("mt-1 text-[11px] text-gray-400 leading-tight", isUrdu && "urdu-text")}>{t("items_clothTypeHint")}</p>
            </div>
          )}

          {/* Separator */}
          <div className="col-span-2 border-t border-gray-100 pt-2">
            <p className={cn("text-xs font-semibold text-gray-500 uppercase tracking-wide", isUrdu && "urdu-text")}>{t("items_stock")}</p>
          </div>

          {/* Quantity — the live stock figure, not a separate "opening" number.
              On a new item it seeds the branch's ItemStock row; on an edit it
              shows what is on the shelf and writing it sets stock to exactly
              that (an absolute figure, not a delta), which the route records as
              a StockAdjustment so the change stays reconcilable.
              `Item.openingStock` is left alone on an edit — it is the figure the
              item started life with and the stock report prints it as such. */}
          <div>
            <label className={cn("block text-xs font-semibold text-gray-600 mb-1", isUrdu && "urdu-text")}>
              {t("items_quantity")}
              {form.unit ? <span className="text-gray-400 font-normal"> ({form.unit})</span> : null}
            </label>
            <NumberInput
              step={1}
              min={0}
              transform={(n) => Math.max(0, n)}
              value={Number(form.stockQty ?? 0)}
              onChange={(v) => set("stockQty", v)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 text-right"
            />
            {/* Changing stock is a real movement, recorded as a StockAdjustment
                — worth saying out loud before Save, not discovering after. */}
            <p className={cn(
              "mt-1 text-[11px] leading-tight",
              stockChanged ? "font-semibold text-amber-700" : "text-gray-400",
              isUrdu && "urdu-text"
            )}>
              {!editItem
                ? t("items_quantityNewHint")
                : stockChanged
                  ? `${t("items_quantityWas")} ${Number(editItem.currentStock ?? 0)}`
                  : t("items_quantityEditHint")}
            </p>
          </div>

          <div>
            {/* Carries the unit too: it now sits beside Quantity, and one of a
                pair of quantity boxes showing "(MTR)" while the other shows
                nothing reads as though they are measured differently. */}
            <label className={cn("block text-xs font-semibold text-gray-600 mb-1", isUrdu && "urdu-text")}>
              {t("items_minLevel")}
              {form.unit ? <span className="text-gray-400 font-normal"> ({form.unit})</span> : null}
            </label>
            <NumberInput
              step={1}
              value={form.minLevel ?? 0}
              onChange={(v) => set("minLevel", v)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 text-right"
            />
          </div>

          {/* Description */}
          <div className="col-span-2">
            <label className={cn("block text-xs font-semibold text-gray-600 mb-1", isUrdu && "urdu-text")}>
              {t("items_description")} <span className={cn("text-gray-400 font-normal", isUrdu && "urdu-text")}>{t("items_optional")}</span>
            </label>
            <input
              type="text"
              value={form.description ?? ""}
              onChange={(e) => set("description", e.target.value)}
              className={cn("w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400", isUrdu && "urdu-text")}
              placeholder={t("items_shortDescriptionPlaceholder")}
            />
          </div>

          {/* Separator */}
          <div className="col-span-2 border-t border-gray-100 pt-2">
            <p className={cn("text-xs font-semibold text-gray-500 uppercase tracking-wide", isUrdu && "urdu-text")}>{t("items_pricing")}</p>
          </div>

          {/* Pricing fields. Purchase price is omitted outright when the
              viewer lacks VIEW_PURCHASE_PRICE (a cost figure some shops keep
              off a manager's screen); sale price stays visible but read-only
              without EDIT_SALE_PRICE since it is required to save the item. */}
          {/* Profit % is not stored: it is derived from purchase and sale price,
              and typing one writes the sale price. It reveals cost, so it hides
              with the purchase price. */}
          {[
            { labelKey: "items_purchasePrice" as const, key: "purchasePrice" as keyof FormState | "profitPct" },
            { labelKey: "items_profitPct" as const, key: "profitPct" as const },
            { labelKey: "items_salePriceRequired" as const, key: "salePrice" as keyof FormState },
            { labelKey: "items_altSalePrice" as const, key: "altSalePrice" as keyof FormState },
            { labelKey: "items_discountRs" as const, key: "discountRS" as keyof FormState },
            { labelKey: "items_discountPct" as const, key: "discountPct" as keyof FormState },
          ]
            .filter(({ key }) => (key !== "purchasePrice" && key !== "profitPct") || can("VIEW_PURCHASE_PRICE"))
            .map(({ labelKey, key }) => (
            <div key={String(key)}>
              <label className={cn("block text-xs font-semibold text-gray-600 mb-1", isUrdu && "urdu-text")}>{t(labelKey)}</label>
              <NumberInput
                step={1}
                value={key === "profitPct"
                  ? profitPctOf(form.purchasePrice ?? 0, form.salePrice ?? 0) ?? 0
                  : (form[key] as number) ?? 0}
                onChange={(v) => key === "profitPct"
                  ? set("salePrice", saleFromProfitPct(form.purchasePrice ?? 0, v))
                  : set(key, v as any)}
                disabled={
                  (key === "salePrice" && !can("EDIT_SALE_PRICE")) ||
                  (key === "profitPct" && (!can("EDIT_SALE_PRICE") || !((form.purchasePrice ?? 0) > 0)))
                }
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 text-right disabled:bg-gray-100 disabled:text-gray-400"
              />
              {key === "profitPct" && (
                <p className={cn("text-[11px] text-gray-400 mt-1", isUrdu && "urdu-text")}>{t("items_profitPctHint")}</p>
              )}
              {key === "altSalePrice" && (
                <p className={cn("text-[11px] text-gray-400 mt-1", isUrdu && "urdu-text")}>{t("items_altSalePriceHint")}</p>
              )}
            </div>
          ))}
          {belowCost && (
            <p className={cn("col-span-2 -mt-1 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-600", isUrdu && "urdu-text")}>
              {t("items_belowCostWarning")}
            </p>
          )}

          {/* Barcode. A USB scanner is just a keyboard, so pointing it at this
              field is all it takes to register a code — the Enter (or Tab) the
              scanner sends afterwards is swallowed so it can't move focus or
              submit the form mid-entry. */}
          {/* The shop's own code: numeric, unique, and assigned by the database
              when the item is first saved, so there is nothing to type here. */}
          <div className="col-span-2">
            <label className={cn("flex items-center gap-1.5 text-xs font-semibold text-gray-600 mb-1", isUrdu && "urdu-text")}>
              {t("items_systemBarcode")}
              {editItem?.systemBarcode && (
                <button
                  type="button"
                  onClick={() => setShowBarcode(true)}
                  title={t("items_viewBarcode")}
                  aria-label={t("items_viewBarcode")}
                  className="p-0.5 rounded text-purple-600 hover:bg-purple-50"
                >
                  <Barcode className="w-4 h-4" />
                </button>
              )}
            </label>
            <div className="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-sm font-mono text-gray-700">
              {editItem?.systemBarcode ?? <span className={cn("font-sans text-gray-400", isUrdu && "urdu-text")}>{t("items_systemBarcodeOnSave")}</span>}
            </div>
          </div>

          <div className="col-span-2">
            <label className={cn("block text-xs font-semibold text-gray-600 mb-1", isUrdu && "urdu-text")}>
              {t("items_barcode")} <span className={cn("text-gray-400 font-normal", isUrdu && "urdu-text")}>{t("items_optional")}</span>
            </label>
            <div className="relative">
              <Barcode className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={form.barcode ?? ""}
                onChange={(e) => set("barcode", e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Tab") e.preventDefault(); }}
                placeholder={t("scan_placeholder")}
                aria-invalid={!!barcodeOwner}
                className={cn(
                  "w-full border rounded-lg pl-9 pr-3 py-2 text-sm font-mono focus:outline-none focus:ring-2",
                  barcodeOwner
                    ? "border-red-400 focus:ring-red-400"
                    : "border-gray-300 focus:ring-purple-400"
                )}
              />
            </div>
            {barcodeOwner ? (
              <p className={cn("text-[11px] text-red-600 mt-1", isUrdu && "urdu-text")}>
                {t("items_barcodeTaken")} <span className="font-semibold">{barcodeOwner.name}</span>
              </p>
            ) : barcodeOwner === undefined ? (
              <p className={cn("text-[11px] text-gray-400 mt-1", isUrdu && "urdu-text")}>{t("items_barcodeChecking")}</p>
            ) : (
              <p className={cn("text-[11px] text-gray-400 mt-1", isUrdu && "urdu-text")}>{t("items_barcodeScanHint")}</p>
            )}
          </div>
        </div>

        <div className="px-6 pb-5 flex justify-end gap-3 border-t border-gray-100 pt-4">
          <button
            onClick={onClose}
            className={cn("px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50", isUrdu && "urdu-text")}
          >
            {t("cancel")}
          </button>
          <button
            onClick={() => handleSave()}
            disabled={saving}
            className={cn("px-6 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium disabled:opacity-60", isUrdu && "urdu-text")}
          >
            {saving ? t("sales_saving") : (editItem ? t("items_updateItem") : t("items_addItem"))}
          </button>
        </div>
      </div>

      {showBelowCost && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
            <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-red-100 flex items-center justify-center">
              <AlertTriangle className="w-7 h-7 text-red-600" />
            </div>
            <h3 className={cn("font-bold text-gray-800 text-lg mb-1.5", isUrdu && "urdu-text")}>
              {t("items_belowCostTitle")}
            </h3>
            <p className={cn("text-gray-500 text-sm mb-6", isUrdu && "urdu-text")}>
              {t("items_belowCostWarning")}
            </p>
            <div className="space-y-2">
              <button
                onClick={() => setShowBelowCost(false)}
                className={cn("w-full px-4 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-semibold", isUrdu && "urdu-text")}
              >
                {t("cancel")}
              </button>
              <button
                onClick={() => handleSave(true)}
                disabled={saving}
                className={cn("w-full px-4 py-2 text-sm font-medium text-red-500 hover:text-red-700 disabled:opacity-60", isUrdu && "urdu-text")}
              >
                {t("items_belowCostSaveAnyway")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* The same label the Inventory tab prints, so what is seen here is what scans. */}
      {showBarcode && editItem?.systemBarcode && (
        <BarcodePrintModal
          items={[{
            itemId: editItem.id, itemName: form.name ?? editItem.name,
            systemBarcode: editItem.systemBarcode, barcode: editItem.barcode,
            saleRate: form.salePrice ?? editItem.salePrice, qty: 1, unit: form.unit ?? editItem.unit,
          }]}
          onClose={() => setShowBarcode(false)}
        />
      )}
    </div>
  );
}
