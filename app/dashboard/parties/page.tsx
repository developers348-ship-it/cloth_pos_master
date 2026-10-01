"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import toast from "react-hot-toast";
import Link from "next/link";
import { Plus, Search, Edit2, Trash2, Users, Eye } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { usePermissions } from "@/lib/permissions-client";
import PartyFormModal from "@/components/parties/PartyFormModal";
import Pagination from "@/components/ui/Pagination";

const PAGE_SIZE = 50;

type Party = {
  id: string; accountId: number; name: string; address?: string;
  city?: string; phone?: string; mobile?: string; type: string;
  previousBalance: number; creditLimit: number; isDefault: boolean;
  notes?: string | null;
  /**
   * Live balance: opening + Σledger debits − Σledger credits.
   * > 0 the party owes the store (receivable), < 0 the store owes the party.
   * Only present when the list was fetched with `withBalance=true`.
   */
  balance?: number;
};

export default function PartiesPage() {
  const { can, loaded: permsLoaded } = usePermissions();
  const { data: session } = useSession();
  const { t, isUrdu } = useI18n();
  const [parties, setParties] = useState<Party[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [balanceTotals, setBalanceTotals] = useState({ receivable: 0, payable: 0 });
  const [showForm, setShowForm] = useState(false);
  const [editParty, setEditParty] = useState<Party | null>(null);

  const branchId = (session?.user as any)?.branchId;

  const loadParties = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    // withBalance asks the server for the *live* balance. The column used to
    // show `previousBalance`, which is the opening balance frozen at party
    // creation — it never moved as the customer bought and paid.
    const params = new URLSearchParams({
      q: search, limit: String(PAGE_SIZE), page: String(page),
      withBalance: "true", branchId,
    });
    if (typeFilter !== "ALL") params.set("type", typeFilter);
    const res = await fetch(`/api/parties?${params.toString()}`);
    const data = await res.json();
    setParties(data.parties ?? []);
    setTotal(data.total ?? 0);
    // The whole filtered set's receivable/payable split, not just this page's
    // — see the server route, which sums it separately for exactly this reason.
    setBalanceTotals(data.totals ?? { receivable: 0, payable: 0 });
    setLoading(false);
  }, [search, typeFilter, page, branchId]);

  useEffect(() => { loadParties(); }, [loadParties]);

  // A new search or type filter invalidates whatever page we were on.
  useEffect(() => { setPage(1); }, [search, typeFilter]);

  const filtered = parties;

  function openAdd() {
    setEditParty(null);
    setShowForm(true);
  }

  function openEdit(p: Party) {
    setEditParty(p);
    setShowForm(true);
  }

  async function handleDelete(id: string) {
    if (!confirm(t("parties_confirmDelete"))) return;
    const res = await fetch(`/api/parties/${id}`, { method: "DELETE" });
    if (!res.ok) { toast.error(t("parties_cannotDelete")); return; }
    toast.success(t("parties_deleted"));
    loadParties();
  }

  const typeColor = (partyType: string) =>
    partyType === "CASH" ? "bg-green-100 text-green-700"
      : partyType === "CREDIT" ? "bg-orange-100 text-orange-700"
      : "bg-blue-100 text-blue-700";

  const typeLabel = (partyType: string) =>
    partyType === "CASH" ? t("parties_cash")
      : partyType === "CREDIT" ? t("parties_credit")
      : t("parties_vendor");

  if (permsLoaded && !can("VIEW_PARTIES")) {
    return (
      <div className="p-6">
        <p className={`text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{t("parties_noPermissionMsg")}</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className={`text-2xl font-bold text-gray-800 flex items-center gap-2 ${isUrdu ? "urdu-text" : ""}`}>
            <Users className="w-6 h-6 text-orange-600" /> {t("parties_title")}
          </h1>
          <p className={`text-gray-500 text-sm mt-0.5 ${isUrdu ? "urdu-text" : ""}`}>{t("parties_subtitle")} — {total} {t("parties_records")}</p>
        </div>
        {can("ADD_PARTY") && (
          <button onClick={openAdd}
            className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium">
            <Plus className="w-4 h-4" /> <span className={isUrdu ? "urdu-text" : ""}>{t("parties_addParty")}</span>
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder={t("parties_searchPlaceholder")}
            className={`w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 bg-white ${isUrdu ? "urdu-text" : ""}`} />
        </div>
        {[
          { value: "ALL", labelKey: "all" as const },
          { value: "CASH", labelKey: "parties_cash" as const },
          { value: "CREDIT", labelKey: "parties_credit" as const },
          { value: "VENDOR", labelKey: "parties_vendor" as const },
        ].map(({ value, labelKey }) => (
          <button key={value} onClick={() => setTypeFilter(value)}
            className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${isUrdu ? "urdu-text" : ""} ${typeFilter === value ? "bg-orange-600 text-white border-orange-600" : "bg-white text-gray-600 border-gray-200 hover:border-orange-300"}`}>
            {t(labelKey)}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className={`px-4 py-3 text-left text-gray-600 font-semibold ${isUrdu ? "urdu-text" : ""}`}>{t("parties_id")}</th>
              <th className={`px-4 py-3 text-left text-gray-600 font-semibold ${isUrdu ? "urdu-text" : ""}`}>{t("name")}</th>
              <th className={`px-4 py-3 text-left text-gray-600 font-semibold ${isUrdu ? "urdu-text" : ""}`}>{t("parties_city")}</th>
              <th className={`px-4 py-3 text-left text-gray-600 font-semibold ${isUrdu ? "urdu-text" : ""}`}>{t("parties_mobile")}</th>
              <th className={`px-4 py-3 text-center text-gray-600 font-semibold ${isUrdu ? "urdu-text" : ""}`}>{t("type")}</th>
              <th className={`px-4 py-3 text-right text-gray-600 font-semibold ${isUrdu ? "urdu-text" : ""}`}>{t("parties_prevBalance")}</th>
              <th className={`px-4 py-3 text-right text-gray-600 font-semibold ${isUrdu ? "urdu-text" : ""}`}>{t("parties_balance")}</th>
              {/* <th className={`px-4 py-3 text-right text-gray-600 font-semibold ${isUrdu ? "urdu-text" : ""}`}>{t("parties_creditLimit")}</th> */}
              <th className={`px-4 py-3 text-left text-gray-600 font-semibold ${isUrdu ? "urdu-text" : ""}`}>{t("parties_notes")}</th>
              <th className={`px-4 py-3 text-center text-gray-600 font-semibold ${isUrdu ? "urdu-text" : ""}`}>{t("actions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              <tr><td colSpan={9} className={`text-center py-10 text-gray-400 ${isUrdu ? "urdu-text" : ""}`}>{t("loading")}</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={9} className={`text-center py-10 text-gray-400 ${isUrdu ? "urdu-text" : ""}`}>{t("parties_noPartiesFound")}</td></tr>
            ) : filtered.map((p) => (
              <tr key={p.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-gray-500 font-mono">{p.accountId}</td>
                <td className="px-4 py-3">
                  {/* The name is the link as well as the eye button: on a list
                      this wide the row's own label is what people aim at. */}
                  <Link href={`/dashboard/parties/${p.id}`}
                    className="font-medium text-gray-800 hover:text-orange-600 hover:underline underline-offset-2">
                    {p.name}
                  </Link>
                  {p.isDefault && <span className={`ml-2 text-[10px] bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded ${isUrdu ? "urdu-text" : ""}`}>{t("parties_default")}</span>}
                </td>
                <td className="px-4 py-3 text-gray-600">{p.city ?? "—"}</td>
                <td className="px-4 py-3 text-gray-600">{p.mobile ?? p.phone ?? "—"}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${typeColor(p.type)} ${isUrdu ? "urdu-text" : ""}`}>{typeLabel(p.type)}</span>
                </td>
                <td className="px-4 py-3 text-right text-gray-500">
                  {Number(p.previousBalance) !== 0 ? `Rs. ${Number(p.previousBalance).toLocaleString()}` : "—"}
                </td>
                {/* Live balance. Red/Dr = the party owes the store; green/Cr =
                    the store owes the party (a vendor payable, or a customer
                    holding store credit from an unrefunded return). */}
                <td className="px-4 py-3 text-right font-semibold tabular-nums">
                  {(() => {
                    const bal = Number(p.balance ?? p.previousBalance ?? 0);
                    if (Math.abs(bal) <= 0.005) return <span className="text-gray-400">—</span>;
                    return (
                      <span className={bal > 0 ? "text-red-600" : "text-green-600"}>
                        Rs. {Math.abs(bal).toLocaleString()}
                        <span className={`ml-1 text-xs font-normal ${isUrdu ? "urdu-text" : ""}`}>
                          {bal > 0 ? t("parties_dr") : t("parties_cr")}
                        </span>
                      </span>
                    );
                  })()}
                </td>
                {/* <td className="px-4 py-3 text-right text-gray-600">
                  {Number(p.creditLimit) > 0 ? `Rs. ${Number(p.creditLimit).toLocaleString()}` : "—"}
                </td> */}
                <td className="px-4 py-3 text-gray-500 max-w-[200px] truncate" title={p.notes ?? undefined}>{p.notes || "—"}</td>
                <td className="px-4 py-3 text-center">
                  <div className="flex items-center justify-center gap-2">
                    {/* Offered for the walking customer too — its ledger is as
                        worth reading as anyone's, even though it can't be
                        edited or deleted. */}
                    <Link href={`/dashboard/parties/${p.id}`}
                      title={t("parties_viewDetail")} aria-label={t("parties_viewDetail")}
                      className="text-gray-400 hover:text-orange-600 p-1">
                      <Eye className="w-4 h-4" />
                    </Link>
                    {!p.isDefault && (
                      <>
                        {can("EDIT_PARTY") && (
                          <button onClick={() => openEdit(p)} className="text-blue-500 hover:text-blue-700 p-1">
                            <Edit2 className="w-4 h-4" />
                          </button>
                        )}
                        {can("DELETE_PARTY") && (
                          <button onClick={() => handleDelete(p.id)} className="text-red-400 hover:text-red-600 p-1">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Two figures, not one net total: netting a customer's debt against a
            vendor's payable would hide both. */}
        {!loading && filtered.length > 0 && (
          <div className="border-t border-gray-100 bg-gray-50 px-4 py-3 flex flex-wrap justify-end gap-6 text-sm">
            <div className="flex items-center gap-2">
              <span className={`text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{t("parties_totalReceivable")}</span>
              <span className="font-bold text-red-600 tabular-nums">Rs. {balanceTotals.receivable.toLocaleString()}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>{t("parties_totalPayable")}</span>
              <span className="font-bold text-green-600 tabular-nums">Rs. {balanceTotals.payable.toLocaleString()}</span>
            </div>
          </div>
        )}

        <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
      </div>

      <PartyFormModal
        open={showForm}
        onClose={() => setShowForm(false)}
        editParty={editParty}
        onSaved={loadParties}
      />
    </div>
  );
}
