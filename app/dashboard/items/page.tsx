"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import toast from "react-hot-toast";
import { Plus, Search, Edit2, Trash2, Package, AlertTriangle, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { usePermissions } from "@/lib/permissions-client";
import ItemFormModal from "@/components/items/ItemFormModal";
import Pagination from "@/components/ui/Pagination";
import { cn } from "@/lib/utils";
import { formatQty, formatStock } from "@/lib/units";
import { useUnitConfig } from "@/lib/use-unit-config";

const PAGE_SIZE = 50;

type Item = {
  id: string; name: string; description?: string; group?: string;
  category?: string; brand?: string;
  categoryId?: string; brandId?: string; groupId?: string;
  unit: string;
  purchasePrice: number; salePrice: number; altSalePrice?: number;
  discountRS: number; discountPct: number;
  openingStock: number; minLevel: number; barcode?: string; isActive: boolean;
  /**
   * Live per-branch stock, derived by the API from `ItemStock` — not a column
   * on `Item`. `openingStock` is the figure the item was created with and
   * never moves, so it must not be used as the displayed stock.
   */
  currentStock: number;
  /** See lib/units.ts — informational, drives the "bought as" line below. */
  purchaseUnit?: string | null;
  piecesPerBundle?: number | null;
};

type CatalogEntry = { id: string; name: string };

export default function ItemsPage() {
  const { can, loaded: permsLoaded } = usePermissions();
  const { data: session } = useSession();
  const branchId = (session?.user as any)?.branchId;
  const { t, isUrdu } = useI18n();
  const unitCfg = useUnitConfig();

  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [editItem, setEditItem] = useState<Item | null>(null);

  // Catalog dropdowns (for displaying category/brand/group names in the table)
  const [categories, setCategories] = useState<CatalogEntry[]>([]);
  const [brands, setBrands] = useState<CatalogEntry[]>([]);
  const [groups, setGroups] = useState<CatalogEntry[]>([]);

  // Load catalog options once
  useEffect(() => {
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
  }, []);

  async function loadItems() {
    setLoading(true);
    const res = await fetch(`/api/items?q=${encodeURIComponent(search)}&branchId=${branchId}&limit=${PAGE_SIZE}&page=${page}`);
    const data = await res.json();
    setItems(data.items ?? []);
    setTotal(data.total ?? 0);
    setLoading(false);
  }

  useEffect(() => { if (branchId) loadItems(); }, [branchId, search, page]);

  // A new search invalidates whatever page we were on.
  useEffect(() => { setPage(1); }, [search]);

  function openAdd() {
    setEditItem(null);
    setShowForm(true);
  }

  function openEdit(item: Item) {
    setEditItem(item);
    setShowForm(true);
  }

  async function handleDelete(id: string) {
    if (!confirm(t("items_confirmDelete"))) return;
    const res = await fetch(`/api/items/${id}`, { method: "DELETE" });
    if (!res.ok) { toast.error(t("items_failedToDelete")); return; }
    toast.success(t("items_deletedMsg"));
    loadItems();
  }

  // Reads the API's `currentStock`. This used to read `item.stockLevels[0].qty`
  // — a shape GET /api/items has never returned — so it always fell through to
  // `openingStock` and the column sat frozen at the item's starting quantity
  // no matter how much was sold or received.
  const currentStock = (item: Item) => Number(item.currentStock ?? 0);
  const isLow = (item: Item) => currentStock(item) <= item.minLevel;

  // Look up catalog name by ID for display in table
  const catName = (item: Item) =>
    categories.find((c) => c.id === item.categoryId)?.name ?? item.category ?? "—";
  const brandName = (item: Item) =>
    brands.find((b) => b.id === item.brandId)?.name ?? item.brand ?? "";
  const groupName = (item: Item) =>
    groups.find((g) => g.id === item.groupId)?.name ?? item.group ?? "";

  // The matrix is fetched once per page load; gating on `loaded` avoids a
  // flash of "no permission" before it arrives.
  if (permsLoaded && !can("VIEW_ITEMS")) {
    return (
      <div className="p-6">
        <p className={`text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{t("items_noPermissionMsg")}</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className={`text-2xl font-bold text-gray-800 flex items-center gap-2 ${isUrdu ? "urdu-text" : ""}`}>
            <Package className="w-6 h-6 text-purple-600" /> {t("items_title")} / {t("items_products")}
          </h1>
          <p className={`text-gray-500 text-sm mt-0.5 ${isUrdu ? "urdu-text" : ""}`}>{total} {t("items_itemsFound")}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/catalog"
            className={`border border-gray-200 hover:bg-gray-50 text-gray-600 px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium ${isUrdu ? "urdu-text" : ""}`}>
            <ExternalLink className="w-4 h-4" /> {t("items_manageCatalog")}
          </Link>
          {can("ADD_ITEM") && (
            <button onClick={openAdd}
              className={`bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium ${isUrdu ? "urdu-text" : ""}`}>
              <Plus className="w-4 h-4" /> {t("items_addItem")}
            </button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder={t("items_searchPlaceholder")}
          className={`w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white ${isUrdu ? "urdu-text" : ""}`} />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className={`px-4 py-3 text-left text-gray-600 font-semibold ${isUrdu ? "urdu-text" : ""}`}>{t("items_itemName")}</th>
              <th className={`px-4 py-3 text-left text-gray-600 font-semibold ${isUrdu ? "urdu-text" : ""}`}>{t("items_categoryBrand")}</th>
              <th className={`px-4 py-3 text-left text-gray-600 font-semibold ${isUrdu ? "urdu-text" : ""}`}>{t("items_group")}</th>
              <th className={`px-4 py-3 text-center text-gray-600 font-semibold ${isUrdu ? "urdu-text" : ""}`}>{t("items_unit")}</th>
              <th className={`px-4 py-3 text-right text-gray-600 font-semibold ${isUrdu ? "urdu-text" : ""}`}>{t("items_salePrice")}</th>
              <th className={`px-4 py-3 text-right text-gray-600 font-semibold ${isUrdu ? "urdu-text" : ""}`}>{t("items_stock")}</th>
              <th className={`px-4 py-3 text-center text-gray-600 font-semibold ${isUrdu ? "urdu-text" : ""}`}>{t("items_status")}</th>
              <th className={`px-4 py-3 text-center text-gray-600 font-semibold ${isUrdu ? "urdu-text" : ""}`}>{t("actions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              <tr><td colSpan={8} className={`text-center py-12 text-gray-400 ${isUrdu ? "urdu-text" : ""}`}>{t("loading")}</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={8} className={`text-center py-12 text-gray-400 ${isUrdu ? "urdu-text" : ""}`}>{t("items_noItemsFound")}</td></tr>
            ) : items.map((item) => (
              <tr key={item.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="font-medium text-gray-800">{item.name}</div>
                  {item.description && <div className="text-xs text-gray-400 truncate max-w-[220px]">{item.description}</div>}
                </td>
                <td className="px-4 py-3">
                  <div className="text-gray-700">{catName(item)}</div>
                  <div className="text-xs text-gray-400">{brandName(item)}</div>
                </td>
                <td className="px-4 py-3 text-gray-500 text-sm">{groupName(item) || "—"}</td>
                <td className="px-4 py-3 text-center">
                  <span className="bg-blue-50 text-blue-700 text-xs font-medium px-2 py-0.5 rounded">{item.unit}</span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="font-semibold text-gray-800">Rs. {Number(item.salePrice).toLocaleString()}</div>
                  {item.altSalePrice != null && Number(item.altSalePrice) > 0 && (
                    <div className={`text-xs text-orange-500 ${isUrdu ? "urdu-text" : ""}`}>{t("items_altPriceShort")} Rs. {Number(item.altSalePrice).toLocaleString()}</div>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <span className={`font-semibold ${isLow(item) ? "text-red-600" : "text-green-600"}`}>
                    {formatQty(currentStock(item))}
                  </span>
                  <span className="text-gray-400 text-xs ml-1">{item.unit}</span>
                  {/* The same quantity in the unit the goods were bought in.
                      Present only when those differ, so the ordinary item stays
                      a single clean figure — but when a roll is billed in gaz
                      and sold by the metre, this is the line that lets the
                      shelf be reconciled against the vendor's bill. */}
                  {(() => {
                    const alt = formatStock(currentStock(item), item, unitCfg).secondary;
                    return alt ? (
                      <div className={cn("text-[11px] text-gray-400", isUrdu && "urdu-text")}>
                        {t("items_boughtAs")} {alt}
                      </div>
                    ) : null;
                  })()}
                </td>
                <td className="px-4 py-3 text-center">
                  {isLow(item) ? (
                    <span className={`flex items-center justify-center gap-1 text-xs text-red-600 bg-red-50 px-2 py-0.5 rounded-full ${isUrdu ? "urdu-text" : ""}`}>
                      <AlertTriangle className="w-3 h-3" /> {t("items_low")}
                    </span>
                  ) : (
                    <span className={`text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full ${isUrdu ? "urdu-text" : ""}`}>{t("items_inStock")}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-center">
                  <div className="flex items-center justify-center gap-2">
                    {can("EDIT_ITEM") && (
                      <button onClick={() => openEdit(item)} className="text-blue-500 hover:text-blue-700 p-1 rounded">
                        <Edit2 className="w-4 h-4" />
                      </button>
                    )}
                    {can("DELETE_ITEM") && (
                      <button onClick={() => handleDelete(item.id)} className="text-red-400 hover:text-red-600 p-1 rounded">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
      </div>

      <ItemFormModal
        open={showForm}
        onClose={() => setShowForm(false)}
        editItem={editItem}
        branchId={branchId}
        onSaved={loadItems}
      />
    </div>
  );
}
