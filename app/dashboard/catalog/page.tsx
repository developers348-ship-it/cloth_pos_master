"use client";

import { useState, useEffect, useRef } from "react";
import toast from "react-hot-toast";
import { Plus, Pencil, Trash2, Check, X, Tag, Award, Layers } from "lucide-react";
import { useI18n } from "@/lib/i18n";

type CatalogItem = { id: string; name: string };
type Tab = "categories" | "brands" | "groups";

const TABS: { key: Tab; icon: React.ElementType; endpoint: string; color: string }[] = [
  { key: "categories", icon: Tag,    endpoint: "/api/catalog/categories", color: "purple" },
  { key: "brands",     icon: Award,  endpoint: "/api/catalog/brands",     color: "blue"   },
  { key: "groups",     icon: Layers, endpoint: "/api/catalog/groups",      color: "teal"   },
];

export default function CatalogPage() {
  const { t, isUrdu } = useI18n();

  // Per-tab display strings — the shared component covers 3 catalog types,
  // so labels/messages are looked up per tab.key rather than stored as
  // plain English text on TABS.
  function tabLabelFor(key: Tab) {
    if (key === "categories") return t("catalog_categories");
    if (key === "brands") return t("catalog_brands");
    return t("catalog_groups");
  }
  function tabAddedMsgFor(key: Tab) {
    if (key === "categories") return t("catalog_categoryAdded");
    if (key === "brands") return t("catalog_brandAdded");
    return t("catalog_groupAdded");
  }
  function tabEmptyMsgFor(key: Tab) {
    if (key === "categories") return t("catalog_noCategoriesYet");
    if (key === "brands") return t("catalog_noBrandsYet");
    return t("catalog_noGroupsYet");
  }
  function tabPlaceholderFor(key: Tab) {
    if (key === "categories") return t("catalog_newCategoryPlaceholder");
    if (key === "brands") return t("catalog_newBrandPlaceholder");
    return t("catalog_newGroupPlaceholder");
  }

  const [activeTab, setActiveTab] = useState<Tab>("categories");
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const addInputRef = useRef<HTMLInputElement>(null);

  const tab = TABS.find((tb) => tb.key === activeTab)!;

  async function load() {
    setLoading(true);
    const res = await fetch(tab.endpoint);
    const data = await res.json();
    setItems(data.items ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    setNewName("");
    setEditId(null);
  }, [activeTab]);

  async function handleAdd() {
    if (!newName.trim()) return;
    setAdding(true);
    const res = await fetch(tab.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    if (res.ok) {
      toast.success(tabAddedMsgFor(tab.key));
      setNewName("");
      load();
    } else {
      const data = await res.json();
      toast.error(data.error ?? t("catalog_failedToAdd"));
    }
    setAdding(false);
  }

  async function handleRename(id: string) {
    if (!editName.trim()) return;
    const res = await fetch(`${tab.endpoint}/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName.trim() }),
    });
    if (res.ok) {
      toast.success(t("catalog_renamed"));
      setEditId(null);
      load();
    } else {
      const data = await res.json();
      toast.error(data.error ?? t("catalog_failedToRename"));
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(t("catalog_confirmDelete"))) return;
    const res = await fetch(`${tab.endpoint}/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success(t("catalog_deleted"));
      load();
    } else {
      toast.error(t("catalog_failedToDelete"));
    }
  }

  const colorMap: Record<string, string> = {
    purple: "bg-purple-600",
    blue:   "bg-blue-600",
    teal:   "bg-teal-600",
  };
  const activeBg = colorMap[tab.color];

  return (
    <div className="p-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className={`text-2xl font-bold text-gray-800 flex items-center gap-2 ${isUrdu ? "urdu-text" : ""}`}>
          <Layers className="w-6 h-6 text-teal-600" /> {t("catalog_title")}
        </h1>
        <p className={`text-gray-500 text-sm mt-0.5 ${isUrdu ? "urdu-text" : ""}`}>
          {t("catalog_subtitle")}
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1">
        {TABS.map((tb) => (
          <button
            key={tb.key}
            onClick={() => setActiveTab(tb.key)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === tb.key
                ? `${colorMap[tb.color]} text-white shadow`
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <tb.icon className="w-4 h-4" />
            <span className={isUrdu ? "urdu-text" : ""}>{tabLabelFor(tb.key)}</span>
          </button>
        ))}
      </div>

      {/* Add New */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm mb-4 p-4">
        <div className="flex gap-2">
          <input
            ref={addInputRef}
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder={tabPlaceholderFor(tab.key)}
            className={`flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 ${isUrdu ? "urdu-text" : ""}`}
          />
          <button
            onClick={handleAdd}
            disabled={adding || !newName.trim()}
            className={`${activeBg} text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 disabled:opacity-50`}
          >
            <Plus className="w-4 h-4" />
            <span className={isUrdu ? "urdu-text" : ""}>{t("catalog_add")}</span>
          </button>
        </div>
      </div>

      {/* List */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className={`text-center py-12 text-gray-400 text-sm ${isUrdu ? "urdu-text" : ""}`}>{t("loading")}</div>
        ) : items.length === 0 ? (
          <div className={`text-center py-12 text-gray-400 text-sm ${isUrdu ? "urdu-text" : ""}`}>
            {tabEmptyMsgFor(tab.key)}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-4 py-3 text-left text-gray-500 font-semibold">#</th>
                <th className={`px-4 py-3 text-left text-gray-500 font-semibold ${isUrdu ? "urdu-text" : ""}`}>{t("name")}</th>
                <th className={`px-4 py-3 text-center text-gray-500 font-semibold w-28 ${isUrdu ? "urdu-text" : ""}`}>{t("actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {items.map((item, idx) => (
                <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-gray-400 w-10">{idx + 1}</td>
                  <td className="px-4 py-3">
                    {editId === item.id ? (
                      <div className="flex gap-2 items-center">
                        <input
                          autoFocus
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleRename(item.id);
                            if (e.key === "Escape") setEditId(null);
                          }}
                          className="flex-1 border border-teal-400 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                        />
                        <button
                          onClick={() => handleRename(item.id)}
                          className="text-green-500 hover:text-green-700 p-1"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setEditId(null)}
                          className="text-gray-400 hover:text-gray-600 p-1"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <span className="font-medium text-gray-800">{item.name}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {editId !== item.id && (
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => { setEditId(item.id); setEditName(item.name); }}
                          className="text-blue-400 hover:text-blue-600 p-1 rounded"
                          title={t("catalog_rename")}
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(item.id, item.name)}
                          className="text-red-400 hover:text-red-600 p-1 rounded"
                          title={t("catalog_delete")}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className={`text-xs text-gray-400 mt-3 text-center ${isUrdu ? "urdu-text" : ""}`}>
        {items.length} {tabLabelFor(tab.key).toLowerCase()} · {t("catalog_pressEnterHint")}
      </p>
    </div>
  );
}
