"use client";

import { useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useReactToPrint } from "react-to-print";
import { ArrowLeft, Printer, Receipt, Loader2 } from "lucide-react";
import InvoiceDocument from "@/components/sales/InvoiceDocument";
import InvoiceReceipt from "@/components/sales/InvoiceReceipt";
import { useInvoiceDetail } from "@/components/sales/invoice-detail";
import { useI18n } from "@/lib/i18n";

/**
 * One invoice, full page — reached from the sales report list (Reports → Sales)
 * by clicking an invoice number or its **Order Detail** action.
 *
 * This was a modal to begin with. A page is the better home for it: the invoice
 * gets a URL that can be linked, bookmarked, opened in a second tab and used
 * with the browser's Back button, none of which a dialog can do, and a document
 * this tall had to scroll inside a box that was itself scrolling the report
 * behind it.
 *
 * Three prints, because three different pieces of paper are wanted:
 * - **Receipt** — the 80mm counter slip, for a customer who wants it again.
 * - **A5** / **A4** — the full invoice document, for a file or a copy.
 */
export default function InvoiceDetailPage() {
  const { t, isUrdu } = useI18n();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const u = isUrdu ? "urdu-text" : "";
  const { detail, error } = useInvoiceDetail(params.id, t("reports_detailFailed"));

  const docRef = useRef<HTMLDivElement>(null);
  const receiptRef = useRef<HTMLDivElement>(null);

  // One handler per paper size rather than a `size` state the buttons set:
  // `useReactToPrint` closes over the `pageStyle` string it was given, so a
  // button that set state and then printed would print at the previous size.
  const documentTitle = detail ? `Invoice-${detail.invoiceNo}` : "Invoice";
  const paperStyle = (paper: "A5" | "A4") => `
    @page {
      size: ${paper === "A4" ? "A4 portrait" : "148mm 210mm portrait"};
      margin: 8mm;
    }
    body { font-family: Arial, sans-serif; font-size: 10px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  `;
  const printA5 = useReactToPrint({ contentRef: docRef, documentTitle, pageStyle: paperStyle("A5") });
  const printA4 = useReactToPrint({ contentRef: docRef, documentTitle, pageStyle: paperStyle("A4") });
  const printReceipt = useReactToPrint({
    contentRef: receiptRef,
    documentTitle: `Receipt-${detail?.invoiceNo ?? ""}`,
    // `auto` height: a slip is as long as its item list, and a fixed page
    // length would feed blank paper after a short sale.
    pageStyle: `
      @page { size: 80mm auto; margin: 3mm; }
      body { font-family: "Courier New", monospace; font-size: 11px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    `,
  });

  return (
    <div className="p-4 sm:p-6">
      {/* Page chrome — never printed; each print targets its own ref */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            aria-label={t("reports_backToSales")}
            className="rounded-lg border border-gray-200 bg-white p-2 text-gray-500 hover:bg-gray-50 hover:text-teal-700"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className={`text-lg font-bold text-gray-800 sm:text-xl ${u}`}>
              {t("reports_orderDetail")}
              {detail && <span className="ml-2 font-mono text-teal-700">#{detail.invoiceNo}</span>}
            </h1>
            <Link
              href="/dashboard/reports"
              className={`text-xs text-gray-400 hover:text-teal-700 hover:underline ${u}`}
            >
              {t("reports_backToSales")}
            </Link>
          </div>
        </div>

        {detail && (
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => printReceipt()}
              className="flex items-center gap-1.5 rounded-lg bg-teal-600 px-3 py-2 text-xs font-medium text-white hover:bg-teal-700">
              <Receipt className="h-3.5 w-3.5" /> <span className={u}>{t("reports_printReceipt")}</span>
            </button>
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
        <>
          <div className="mx-auto max-w-[820px] rounded-xl border border-gray-200 bg-white p-3 shadow-sm sm:p-6">
            <InvoiceDocument detail={detail} docRef={docRef} />
          </div>

          {/*
            The slip is mounted but off-screen rather than conditionally
            rendered: react-to-print needs the node to exist when the button is
            pressed, and `display: none` would give it nothing to measure.
          */}
          <div aria-hidden className="pointer-events-none fixed left-[-9999px] top-0">
            <InvoiceReceipt detail={detail} docRef={receiptRef} />
          </div>
        </>
      )}
    </div>
  );
}
