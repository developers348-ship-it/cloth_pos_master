"use client";

import { useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useReactToPrint } from "react-to-print";
import { ArrowLeft, Printer, Loader2 } from "lucide-react";
import GRNDocument from "@/components/purchases/GRNDocument";
import { useGrnDetail } from "@/components/purchases/grn-detail";
import { useI18n } from "@/lib/i18n";

/**
 * One GRN, full page — reached from the GRN Records list by clicking a GRN
 * number or its **GRN Detail** action.
 *
 * The purchase-side counterpart of `/dashboard/invoices/[id]`, and a page for
 * the same reasons: a received bill deserves a URL that can be linked,
 * bookmarked, opened in a second tab and walked back through with the browser's
 * Back button, and a document this tall shouldn't scroll inside a box that is
 * itself scrolling the list behind it.
 *
 * Two prints rather than the sale's three — there is no counter slip for a
 * purchase, so A5 and A4 of the document is the whole of it.
 */
export default function GRNDetailPage() {
  const { t, isUrdu } = useI18n();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const u = isUrdu ? "urdu-text" : "";
  const { detail, error } = useGrnDetail(params.id, t("purchases_grnDetailFailed"));

  const docRef = useRef<HTMLDivElement>(null);

  // One handler per paper size rather than a `size` state the buttons set:
  // `useReactToPrint` closes over the `pageStyle` string it was given, so a
  // button that set state and then printed would print at the previous size.
  const documentTitle = detail ? `GRN-${detail.grnNo}` : "GRN";
  const paperStyle = (paper: "A5" | "A4") => `
    @page {
      size: ${paper === "A4" ? "A4 portrait" : "148mm 210mm portrait"};
      margin: 8mm;
    }
    body { font-family: Arial, sans-serif; font-size: 10px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  `;
  const printA5 = useReactToPrint({ contentRef: docRef, documentTitle, pageStyle: paperStyle("A5") });
  const printA4 = useReactToPrint({ contentRef: docRef, documentTitle, pageStyle: paperStyle("A4") });

  return (
    <div className="p-4 sm:p-6">
      {/* Page chrome — never printed; the print targets the document's ref */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            aria-label={t("purchases_backToPurchases")}
            className="rounded-lg border border-gray-200 bg-white p-2 text-gray-500 hover:bg-gray-50 hover:text-teal-700"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className={`text-lg font-bold text-gray-800 sm:text-xl ${u}`}>
              {t("purchases_grnDetail")}
              {detail && <span className="ml-2 font-mono text-teal-700">#{detail.grnNo}</span>}
            </h1>
            <Link
              href="/dashboard/purchases"
              className={`text-xs text-gray-400 hover:text-teal-700 hover:underline ${u}`}
            >
              {t("purchases_backToPurchases")}
            </Link>
          </div>
        </div>

        {detail && (
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => printA5()}
              className="flex items-center gap-1.5 rounded-lg border border-teal-600 px-3 py-2 text-xs font-medium text-teal-700 hover:bg-teal-50">
              <Printer className="h-3.5 w-3.5" /> <span className={u}>{t("reports_print")}</span> A5
            </button>
            <button onClick={() => printA4()}
              className="flex items-center gap-1.5 rounded-lg border border-teal-600 px-3 py-2 text-xs font-medium text-teal-700 hover:bg-teal-50">
              <Printer className="h-3.5 w-3.5" /> <span className={u}>{t("reports_print")}</span> A4
            </button>
          </div>
        )}
      </div>

      {!detail ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-20 text-sm text-gray-400">
          {error
            ? <span className={`text-red-600 ${u}`}>{error}</span>
            : <><Loader2 className="h-4 w-4 animate-spin" /> <span className={u}>{t("loading")}</span></>}
        </div>
      ) : (
        <div className="mx-auto max-w-[820px] rounded-xl border border-gray-200 bg-white p-3 shadow-sm sm:p-6">
          <GRNDocument detail={detail} docRef={docRef} />
        </div>
      )}
    </div>
  );
}
