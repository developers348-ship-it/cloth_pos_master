"use client";

import { useEffect, useRef } from "react";
import { useReactToPrint } from "react-to-print";
import toast from "react-hot-toast";
import InvoiceReceipt from "./InvoiceReceipt";
import { useInvoiceDetail } from "./invoice-detail";
import { useI18n } from "@/lib/i18n";
import { useStore } from "@/lib/store-context";
import { clampReceiptFontSize, RECEIPT_FONT_SIZE_DEFAULT } from "@/lib/receipt-font";

/**
 * Prints one invoice's 80mm slip without leaving the sales report.
 *
 * Mounted by the list when its **Receipt** action is chosen and unmounted again
 * once the print dialog closes, so there is never more than one slip in the
 * DOM. It fetches the invoice rather than printing from the `SaleRow` already
 * in hand: the row has no `change`, no bank account name and no party balance,
 * all of which the original counter receipt shows — a re-print that quietly
 * dropped them would not match the slip the customer was first given.
 *
 * Renders nothing visible; the slip sits off-screen because react-to-print
 * needs a real, laid-out node to copy.
 */
export default function ReceiptPrintTrigger({
  invoiceId, onDone,
}: {
  invoiceId: string;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const { store } = useStore();
  // The slip carries its own inline sizes; this only stops the print
  // stylesheet's `body` rule from overriding them with a stale 11px.
  const fontSize = clampReceiptFontSize(store?.receiptFontSize ?? RECEIPT_FONT_SIZE_DEFAULT);
  const { detail, error } = useInvoiceDetail(invoiceId, t("reports_detailFailed"));
  const receiptRef = useRef<HTMLDivElement>(null);
  const fired = useRef(false);

  const printReceipt = useReactToPrint({
    contentRef: receiptRef,
    documentTitle: `Receipt-${detail?.invoiceNo ?? ""}`,
    pageStyle: `
      @page { size: 80mm auto; margin: 3mm; }
      body { font-family: "Courier New", monospace; font-size: ${fontSize}px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    `,
    onAfterPrint: onDone,
  });

  // Fire once, as soon as the invoice lands. `printReceipt` is a fresh function
  // each render, so the guard — not the dep list — is what keeps it to one
  // dialog.
  useEffect(() => {
    if (!detail || fired.current) return;
    fired.current = true;
    printReceipt();
  }, [detail, printReceipt]);

  useEffect(() => {
    if (!error) return;
    toast.error(error);
    onDone();
  }, [error, onDone]);

  if (!detail) return null;

  return (
    <div aria-hidden className="pointer-events-none fixed left-[-9999px] top-0">
      <InvoiceReceipt detail={detail} docRef={receiptRef} />
    </div>
  );
}
