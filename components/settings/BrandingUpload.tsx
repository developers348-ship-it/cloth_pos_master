"use client";

import { useRef, useState } from "react";
import { RefreshCw, Trash2, Upload } from "lucide-react";
import toast from "react-hot-toast";
import { useI18n } from "@/lib/i18n";
import type { TranslationKey } from "@/lib/translations";

/**
 * One branding image: a preview, a click-to-pick tile, and Remove.
 *
 * Four of these are on screen (favicon, logo, and the two PWA icons) and they
 * behave identically, so they are one component rather than four copies of the
 * same dropzone — which is what the PWA tab used to hold for its two icons,
 * already diverging from each other in small ways.
 *
 * **Uploads are immediate.** The old two-icon dropzone staged files and waited
 * for a separate Upload button, so a picked icon that was never followed by the
 * button was silently dropped on tab switch. Here the file goes as soon as it
 * is chosen and the preview then comes from the server, so what is on screen is
 * what is stored.
 */

export type BrandingAsset = "favicon" | "logo" | "icon192" | "icon512";

export default function BrandingUpload({
  asset, branchId, label, hint, uploaded, previewClassName = "w-24 h-24", onChanged,
}: {
  asset: BrandingAsset;
  branchId: string;
  label: string;
  hint?: string;
  /** Whether the store has its own image for this asset, from the summary fetch. */
  uploaded: boolean;
  previewClassName?: string;
  onChanged: () => void;
}) {
  const { t, isUrdu } = useI18n();
  const u = isUrdu ? "urdu-text" : "";
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  /**
   * Bumped after every change to bust the browser's image cache. The URL is
   * stable (`/api/branding/favicon`), so without a changing query the `<img>`
   * would keep showing the previous icon even though the route now returns the
   * new one.
   */
  const [version, setVersion] = useState(() => Date.now());
  const src = `/api/branding/${asset}?v=${version}`;

  async function upload(file: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("asset", asset);
      fd.append("branchId", branchId);
      fd.append("file", file);
      const res = await fetch("/api/settings/branding", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setVersion(Date.now());
      onChanged();
      toast.success(t("settings_brandingSaved"));
    } catch (err: unknown) {
      toast.error(err instanceof Error && err.message ? err.message : t("settings_brandingUploadFailed"));
    } finally {
      setBusy(false);
      // Clear the input so picking the same file again still fires a change.
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(`/api/settings/branding?branchId=${branchId}&asset=${asset}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setVersion(Date.now());
      onChanged();
      toast.success(t("settings_brandingRemoved"));
    } catch {
      toast.error(t("settings_brandingRemoveFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <label className={`block text-xs font-medium text-gray-500 mb-2 ${u}`}>{label}</label>
      <div
        role="button"
        tabIndex={0}
        onClick={() => !busy && inputRef.current?.click()}
        onKeyDown={(e) => { if (!busy && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); inputRef.current?.click(); } }}
        className="border-2 border-dashed border-gray-200 rounded-xl p-4 text-center cursor-pointer hover:border-teal-400 transition-colors focus:outline-none focus:border-teal-400"
      >
        {busy ? (
          <div className={`${previewClassName} mx-auto flex items-center justify-center text-teal-500`}>
            <RefreshCw className="w-6 h-6 animate-spin" />
          </div>
        ) : (
          // Always the server's own rendering — the uploaded image, or the
          // generated first-character disc when there is none. So the tile
          // shows exactly what a browser tab or a launcher will show, rather
          // than a placeholder that looks nothing like the real thing.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={label} className={`${previewClassName} mx-auto object-contain rounded-lg`} />
        )}
        <p className={`text-xs text-gray-400 mt-2 ${u}`}>{t("settings_clickToUpload")}</p>
      </div>
      {hint && <p className={`text-xs text-gray-400 mt-1 ${u}`}>{hint}</p>}
      <div className="mt-1.5 flex items-center gap-3">
        <button
          type="button"
          onClick={() => !busy && inputRef.current?.click()}
          disabled={busy}
          className={`flex items-center gap-1 text-xs text-teal-700 hover:underline disabled:opacity-50 ${u}`}
        >
          <Upload className="w-3 h-3" /> {t("settings_brandingChoose")}
        </button>
        {uploaded && (
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className={`flex items-center gap-1 text-xs text-red-600 hover:underline disabled:opacity-50 ${u}`}
          >
            <Trash2 className="w-3 h-3" /> {t("settings_brandingRemove")}
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml,image/x-icon,.ico"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }}
      />
    </div>
  );
}

/** Label/hint keys per asset, so the page doesn't hand-write four pairs. */
export const BRANDING_LABELS: Record<BrandingAsset, { label: TranslationKey; hint: TranslationKey }> = {
  favicon: { label: "settings_faviconLabel", hint: "settings_faviconHint" },
  logo: { label: "settings_logoLabel", hint: "settings_logoHint" },
  icon192: { label: "settings_icon192Label", hint: "settings_icon192Hint" },
  icon512: { label: "settings_icon512Label", hint: "settings_icon512Hint" },
};
