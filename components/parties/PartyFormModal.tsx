"use client";

import { useState, useEffect } from "react";
import toast from "react-hot-toast";
import { useI18n } from "@/lib/i18n";
import { usePermissions } from "@/lib/permissions-client";
import { cn } from "@/lib/utils";

/**
 * The nullable columns are typed `string | null` rather than `string |
 * undefined`: that is what Prisma hands back, so a caller reading a party
 * straight from an API (the detail page does) can pass it through without
 * laundering every empty field first. Every input below already falls back with
 * `?? ""`, so a null never reaches a value prop.
 */
export type PartyRecord = {
  id: string; accountId: number; name: string; address?: string | null;
  city?: string | null; phone?: string | null; mobile?: string | null; type: string;
  previousBalance: number; creditLimit: number; isDefault?: boolean;
  notes?: string | null;
};

type FormState = Partial<PartyRecord>;

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: (party: any) => void;
  editParty?: PartyRecord | null;
  /** New-party defaults — the GRN adds a vendor, seeded with what was typed. */
  defaultType?: "CASH" | "CREDIT" | "VENDOR";
  defaultName?: string;
};

const EMPTY_FORM: FormState = { type: "CASH", previousBalance: 0, creditLimit: 0 };

export default function PartyFormModal({ open, onClose, onSaved, editParty, defaultType, defaultName }: Props) {
  const { t, isUrdu } = useI18n();
  const { can } = usePermissions();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(editParty
      ? { ...editParty }
      : { ...EMPTY_FORM, ...(defaultType ? { type: defaultType } : {}), ...(defaultName ? { name: defaultName } : {}) });
  }, [open, editParty, defaultType, defaultName]);

  async function handleSave() {
    if (!form.name?.trim()) { toast.error(t("parties_failedSave")); return; }

    const method = editParty ? "PUT" : "POST";
    const url = editParty ? `/api/parties/${editParty.id}` : "/api/parties";

    setSaving(true);
    try {
      // A cleared notes box is stored as NULL rather than "", so "has a note"
      // stays a single IS NOT NULL check rather than two.
      const payload = { ...form, notes: form.notes?.trim() ? form.notes.trim() : null };

      const res = await fetch(url, {
        method, headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error ?? "");
      }
      const saved = await res.json();
      toast.success(editParty ? t("parties_updated") : t("parties_added"));
      onSaved(saved);
      onClose();
    } catch (e) {
      toast.error((e as Error).message || t("parties_failedSave"));
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  // Stored in the app-wide sign (> 0 the party owes us, < 0 we owe the party,
  // see lib/party-balance.ts). A vendor's opening figure is normally a payable,
  // so the box shows it the other way round and the cashier types a plain
  // positive amount for "we owe this vendor Rs. X".
  const openingSign = form.type === "VENDOR" ? -1 : 1;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h3 className={cn("font-bold text-gray-800 text-lg", isUrdu && "urdu-text")}>
            {editParty ? t("parties_editParty") : t("parties_addNewParty")}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
        </div>
        <div className="p-6 grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className={cn("block text-xs font-medium text-gray-600 mb-1", isUrdu && "urdu-text")}>{t("name")} *</label>
            <input type="text" autoFocus value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
          </div>
          {[
            { labelKey: "parties_address" as const, key: "address" as const },
            { labelKey: "parties_city" as const, key: "city" as const },
            { labelKey: "parties_phone" as const, key: "phone" as const },
            { labelKey: "parties_mobile" as const, key: "mobile" as const },
          ].map(({ labelKey, key }) => (
            <div key={key}>
              <label className={cn("block text-xs font-medium text-gray-600 mb-1", isUrdu && "urdu-text")}>{t(labelKey)}</label>
              <input type="text" value={(form as any)[key] ?? ""} onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
            </div>
          ))}
          <div>
            <label className={cn("block text-xs font-medium text-gray-600 mb-1", isUrdu && "urdu-text")}>{t("type")}</label>
            <select value={form.type ?? "CASH"} onChange={(e) => setForm({ ...form, type: e.target.value })}
              className={cn("w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400", isUrdu && "urdu-text")}>
              <option value="CASH">{t("parties_cash")}</option>
              <option value="CREDIT">{t("parties_creditCR")}</option>
              <option value="VENDOR">{t("parties_vendor")}</option>
            </select>
          </div>
          <div>
            <label className={cn("block text-xs font-medium text-gray-600 mb-1", isUrdu && "urdu-text")}>
              {t(form.type === "VENDOR" ? "parties_openingPayable" : "parties_openingReceivable")}
            </label>
            <input type="number" value={openingSign * Number(form.previousBalance ?? 0) || 0}
              onChange={(e) => setForm({ ...form, previousBalance: openingSign * Number(e.target.value) })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 text-right" />
            <p className={cn("mt-1 text-[11px] text-gray-400", isUrdu && "urdu-text")}>{t("parties_openingHint")}</p>
          </div>
          {form.type === "CREDIT" && can("SET_CREDIT_LIMIT") && (
            <div>
              <label className={cn("block text-xs font-medium text-gray-600 mb-1", isUrdu && "urdu-text")}>{t("parties_creditLimit")}</label>
              <input type="number" value={form.creditLimit ?? 0} onChange={(e) => setForm({ ...form, creditLimit: Number(e.target.value) })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 text-right" />
            </div>
          )}
          <div className="col-span-2">
            <label className={cn("block text-xs font-medium text-gray-600 mb-1", isUrdu && "urdu-text")}>{t("parties_notes")}</label>
            <textarea rows={3} value={form.notes ?? ""}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder={t("parties_notesPlaceholder")}
              className={cn(
                "w-full resize-y border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-orange-400",
                isUrdu && "urdu-text"
              )} />
          </div>
        </div>
        <div className="px-6 pb-5 flex justify-end gap-3">
          <button onClick={onClose} className={cn("px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50", isUrdu && "urdu-text")}>{t("cancel")}</button>
          <button onClick={handleSave} disabled={saving} className={cn("px-6 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-sm font-medium disabled:opacity-60", isUrdu && "urdu-text")}>
            {saving ? t("sales_saving") : (editParty ? t("parties_update") : t("parties_addParty"))}
          </button>
        </div>
      </div>
    </div>
  );
}
