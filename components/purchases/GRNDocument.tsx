"use client";

import { formatCurrency, formatDate, formatTime } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { useStore } from "@/lib/store-context";
import type { GRNDetail } from "./grn-detail";

/**
 * The GRN as a document — the A4 / A5 rendering, and the same markup on screen
 * as on paper so the two can't tell different stories. The purchase-side
 * counterpart of `components/sales/InvoiceDocument.tsx`.
 *
 * Presentational only: it takes a loaded `GRNDetail` and the ref that
 * react-to-print prints from. The page owns the fetch and the print buttons
 * (`app/dashboard/purchases/[id]/page.tsx`).
 *
 * Not to be confused with `GRNPrintModal`, which prints the GRN *being entered*
 * from the form's own state — that one has no saved id, no vendor balance and
 * no payment history to show.
 */

/** A rupee figure that never wraps, with the sign in front of `Rs.`. */
function Amt({ value, bold = false }: { value: number; bold?: boolean }) {
  const negative = value < -0.005;
  return (
    <span className={`whitespace-nowrap tabular-nums ${bold ? "font-semibold" : ""}`}>
      {negative ? "− " : ""}Rs. {formatCurrency(Math.abs(value))}
    </span>
  );
}

/** One label/value line in the totals or payment column. */
function Line({ label, value, tone = "", bold = false }: {
  label: string; value: React.ReactNode; tone?: string; bold?: boolean;
}) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-0.5 ${bold ? "border-t border-gray-400 pt-1 font-semibold" : ""}`}>
      <span className={bold ? "" : "text-gray-500"}>{label}</span>
      <span className={tone}>{value}</span>
    </div>
  );
}

function Tag({ children, tone = "gray" }: {
  children: React.ReactNode;
  tone?: "gray" | "green" | "amber" | "red" | "blue" | "purple";
}) {
  const tones = {
    gray: "border-gray-300 text-gray-600",
    green: "border-green-400 text-green-700",
    amber: "border-amber-400 text-amber-700",
    red: "border-red-400 text-red-700",
    blue: "border-blue-400 text-blue-700",
    purple: "border-purple-400 text-purple-700",
  };
  return (
    <span className={`inline-block rounded border px-1.5 py-px text-[10px] font-semibold uppercase leading-4 ${tones[tone]}`}>
      {children}
    </span>
  );
}

export default function GRNDocument({
  detail, docRef,
}: {
  detail: GRNDetail;
  docRef: React.Ref<HTMLDivElement>;
}) {
  const { t, isUrdu } = useI18n();
  const { store } = useStore();
  const u = isUrdu ? "urdu-text" : "";
  // A GRN that gave back more than it took is a purchase return note, not a
  // receipt note — the same `netBill < 0` test the ledger split uses to write
  // PURCHASE_RETURN instead of PURCHASE (see docs/purchases-grn.md).
  const isReturnDoc = detail.totals.netBill < 0;
  const purchaseLines = detail.lines.filter((l) => !l.isReturn);
  const returnLines = detail.lines.filter((l) => l.isReturn);
  const discountAmount = (detail.totals.saleAmount * detail.totals.discountPct) / 100;

  const methodLabel = (method: string) =>
    method === "CASH" ? t("purchases_payCash")
      : method === "BANK" ? t("purchases_payBank")
      : method === "CASH_AND_BANK" ? t("purchases_payBoth")
      : t("purchases_payLend");

  return (
    <div ref={docRef} id="grn-doc" className="text-[11px] leading-snug text-gray-800">

      {/* Store header */}
      <div className="text-center">
        <div className="text-lg font-bold uppercase tracking-wide">{store?.name ?? "POS"}</div>
        {(store?.address || store?.city) && (
          <div className="text-gray-500">{[store?.address, store?.city].filter(Boolean).join(", ")}</div>
        )}
        {(store?.phone || store?.mobile) && (
          <div className="text-gray-500">{t("reports_phone")}: {[store?.phone, store?.mobile].filter(Boolean).join(" / ")}</div>
        )}
        <div className={`mt-1.5 border-y border-gray-400 py-1 text-sm font-bold tracking-wide ${u}`}>
          {isReturnDoc ? t("purchases_purchaseReturnNote") : t("purchases_goodsReceiptNote")}
        </div>
      </div>

      {/* GRN meta + vendor, side by side */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded border border-gray-200 p-2">
          <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
            <span className={`text-gray-500 ${u}`}>{t("purchases_grnNo")}</span>
            <span className="font-mono font-semibold">#{detail.grnNo}</span>
            <span className={`text-gray-500 ${u}`}>{t("date")}</span>
            <span>{formatDate(new Date(detail.date))} · {formatTime(new Date(detail.date))}</span>
            <span className={`text-gray-500 ${u}`}>{t("reports_billNo")}</span>
            <span>{detail.billNo || "—"}</span>
            <span className={`text-gray-500 ${u}`}>{t("purchases_receivedBy")}</span>
            <span>{detail.receivedBy ?? "—"}</span>
            <span className={`text-gray-500 ${u}`}>{t("reports_paymentMethod")}</span>
            <span className={u}>
              {methodLabel(detail.payment.method)}
              {detail.bankAccountName ? ` (${detail.bankAccountName})` : ""}
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1 border-t border-dashed border-gray-200 pt-1.5">
            <Tag tone={detail.payment.status === "PAID" ? "green" : detail.payment.status === "PARTIAL" ? "amber" : "red"}>
              {detail.payment.status === "PAID" ? t("reports_statusPaid")
                : detail.payment.status === "PARTIAL" ? t("reports_statusPartial")
                : t("reports_statusUnpaid")}
            </Tag>
            {isReturnDoc && <Tag tone="purple">{t("purchases_netReturn")}</Tag>}
            {detail.plan && <Tag tone="blue">{t("reports_installments")}</Tag>}
          </div>
        </div>

        <div className="rounded border border-gray-200 p-2">
          <div className={`mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 ${u}`}>
            {t("reports_vendor")}
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
            <span className={`text-gray-500 ${u}`}>{t("name")}</span>
            <span className="font-semibold">{detail.vendor.name}</span>
            <span className={`text-gray-500 ${u}`}>{t("reports_accountNo")}</span>
            <span>#{detail.vendor.accountId}</span>
            {(detail.vendor.phone || detail.vendor.mobile) && (
              <>
                <span className={`text-gray-500 ${u}`}>{t("reports_phone")}</span>
                <span>{[detail.vendor.phone, detail.vendor.mobile].filter(Boolean).join(" / ")}</span>
              </>
            )}
            {(detail.vendor.address || detail.vendor.city) && (
              <>
                <span className={`text-gray-500 ${u}`}>{t("reports_address")}</span>
                <span>{[detail.vendor.address, detail.vendor.city].filter(Boolean).join(", ")}</span>
              </>
            )}
            {/*
              Previous and closing, so the document adds up on its own:
              previous balance + this bill's ledger effect = closing. A positive
              figure is what we owe the vendor (see the route's sign note).
            */}
            <span className={`text-gray-500 ${u}`}>{t("reports_previousBalance")}</span>
            <span className={detail.vendor.balanceBefore > 0.005 ? "text-red-600" : ""}>
              <Amt value={detail.vendor.balanceBefore} />
            </span>
            <span className={`text-gray-500 ${u}`}>{t("reports_closingBalance")}</span>
            <span className={detail.vendor.balanceAfter > 0.005 ? "font-semibold text-red-600" : "font-semibold"}>
              <Amt value={detail.vendor.balanceAfter} />
            </span>
          </div>
        </div>
      </div>

      {/* Line items — received and returned kept apart, as on the GRN form */}
      {[
        { lines: purchaseLines, heading: t("purchases_receivedItems"), mark: "P" as const },
        { lines: returnLines, heading: t("purchases_returnedItems"), mark: "R" as const },
      ].filter((g) => g.lines.length > 0).map((g) => (
        <div key={g.mark} className="mt-3">
          <div className={`mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 ${u}`}>{g.heading}</div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse">
              <thead>
                <tr className="border-y border-gray-300 text-[10px] uppercase tracking-wide text-gray-500">
                  <th className="w-7 py-1 text-left font-medium">#</th>
                  <th className={`py-1 text-left font-medium ${u}`}>{t("purchases_itemName")}</th>
                  <th className={`py-1 text-center font-medium ${u}`}>{t("purchases_unit")}</th>
                  <th className={`py-1 text-right font-medium ${u}`}>{t("purchases_qty")}</th>
                  <th className={`py-1 text-right font-medium ${u}`}>{t("purchases_costRate")}</th>
                  <th className={`py-1 text-right font-medium ${u}`}>{t("purchases_saleRate")}</th>
                  <th className={`py-1 text-right font-medium ${u}`}>{t("reports_disPct")}</th>
                  <th className={`py-1 text-right font-medium ${u}`}>{t("amount")}</th>
                </tr>
              </thead>
              <tbody>
                {g.lines.map((li, i) => (
                  <tr key={li.id} className="border-b border-dotted border-gray-200">
                    <td className="py-1 text-gray-400">{i + 1}</td>
                    <td className="py-1">
                      {li.name}
                      {li.barcode && <span className="ml-1 font-mono text-[9px] text-gray-400">{li.barcode}</span>}
                    </td>
                    <td className="py-1 text-center text-gray-500">{li.unit}</td>
                    <td className="py-1 text-right tabular-nums">{li.qty}</td>
                    <td className="py-1 text-right"><Amt value={li.costRate} /></td>
                    <td className="py-1 text-right text-gray-500"><Amt value={li.saleRate} /></td>
                    <td className="py-1 text-right tabular-nums text-gray-500">
                      {li.disPct > 0.005 ? `${li.disPct}%` : "—"}
                    </td>
                    <td className="py-1 text-right font-medium"><Amt value={li.amount} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {/* Quantity totals — the figures the stock room counts in */}
      <div className={`mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] text-gray-500 ${u}`}>
        <span>{t("purchases_purchaseQty")}: {detail.totals.totalPurchaseQty}</span>
        {detail.totals.totalReturnQty > 0 && (
          <span>{t("purchases_returnQty")}: {detail.totals.totalReturnQty}</span>
        )}
      </div>

      {/*
        Bill and payment, stacked in a right-hand column — the usual document
        shape, so the eye runs down one list of figures instead of across two.
      */}
      <div className="mt-3 flex justify-end">
        <div className="w-full space-y-2 sm:w-[58%] lg:w-1/2">
          <div className="rounded border border-gray-200 p-2">
            <div className={`mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 ${u}`}>
              {t("reports_totals")}
            </div>
            <Line label={t("purchases_purchaseAmount")} value={<Amt value={detail.totals.saleAmount} />} />
            {detail.totals.discountPct > 0.005 && (
              <Line
                label={`${t("purchases_discount")} (${detail.totals.discountPct}%)`}
                value={<Amt value={-discountAmount} />}
                tone="text-orange-600"
              />
            )}
            {Math.abs(detail.totals.adjustment) > 0.005 && (
              <Line label={t("purchases_adjustment")} value={<Amt value={detail.totals.adjustment} />} />
            )}
            {detail.totals.returnAmount > 0.005 && (
              <Line label={t("purchases_returnAmount")} value={<Amt value={-detail.totals.returnAmount} />} tone="text-red-600" />
            )}
            <Line
              label={isReturnDoc ? t("purchases_refundDue") : t("purchases_netBill")}
              value={<Amt value={detail.totals.netBill} bold />}
              bold
            />
          </div>

          <div className="rounded border border-gray-200 p-2">
            <div className={`mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 ${u}`}>
              {t("reports_paymentStatus")}
            </div>
            {detail.payment.cashPaid > 0.005 && (
              <Line
                label={isReturnDoc ? t("purchases_refundCash") : t("purchases_cashPaid")}
                value={<Amt value={detail.payment.cashPaid} />}
                tone="text-green-700"
              />
            )}
            {detail.payment.bankPaid > 0.005 && (
              <Line
                label={
                  (isReturnDoc ? t("purchases_refundBank") : t("purchases_bankPaid"))
                  + (detail.bankAccountName ? ` (${detail.bankAccountName})` : "")
                }
                value={<Amt value={detail.payment.bankPaid} />}
                tone="text-blue-700"
              />
            )}
            {detail.payment.collected > 0.005 && (
              <Line label={t("purchases_paidSince")} value={<Amt value={detail.payment.collected} />} tone="text-teal-700" />
            )}
            <Line label={t("purchases_totalPaid")} value={<Amt value={detail.payment.settled} bold />} bold />
            <Line
              label={t("reports_outstanding")}
              value={<Amt value={detail.payment.outstanding} bold />}
              tone={detail.payment.outstanding > 0.005 ? "text-red-600" : "text-gray-500"}
            />
          </div>
        </div>
      </div>

      {/* Money paid to the vendor after the goods were received */}
      {detail.payments.length > 0 && (
        <div className="mt-3">
          <div className={`mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 ${u}`}>
            {t("purchases_paymentsAfterReceipt")}
          </div>
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-y border-gray-300 text-[10px] uppercase tracking-wide text-gray-500">
                <th className={`py-1 text-left font-medium ${u}`}>{t("date")}</th>
                <th className={`py-1 text-left font-medium ${u}`}>{t("reports_method")}</th>
                <th className={`py-1 text-right font-medium ${u}`}>{t("amount")}</th>
              </tr>
            </thead>
            <tbody>
              {detail.payments.map((p) => (
                <tr key={p.id} className="border-b border-dotted border-gray-200">
                  <td className="py-1">{formatDate(new Date(p.date))}</td>
                  <td className="py-1">
                    {p.paymentMethod === "BANK" ? t("reports_bank") : t("reports_cash")}
                    {p.accountName ? ` (${p.accountName})` : ""}
                    {p.notes && <span className="ml-1 text-gray-400">· {p.notes}</span>}
                  </td>
                  <td className="py-1 text-right font-medium"><Amt value={p.amount} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Repayment schedule */}
      {detail.plan && (
        <div className="mt-3">
          <div className={`mb-1 flex flex-wrap items-baseline gap-x-3 text-[10px] font-semibold uppercase tracking-wide text-gray-400 ${u}`}>
            <span>{t("reports_installmentSchedule")}</span>
            <span className="font-normal normal-case tracking-normal text-gray-500">
              {detail.plan.periods} × {detail.plan.kind === "MONTHLY" ? t("purchases_repaymentMonthly")
                : detail.plan.kind === "WEEKLY" ? t("purchases_repaymentWeekly")
                : t("purchases_repaymentPromiseDay")} · <Amt value={detail.plan.principal} />
            </span>
          </div>
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-y border-gray-300 text-[10px] uppercase tracking-wide text-gray-500">
                <th className="w-7 py-1 text-left font-medium">#</th>
                <th className={`py-1 text-left font-medium ${u}`}>{t("reports_dueDate")}</th>
                <th className={`py-1 text-right font-medium ${u}`}>{t("amount")}</th>
                <th className={`py-1 text-right font-medium ${u}`}>{t("reports_paid")}</th>
                <th className={`py-1 text-left font-medium ${u}`}>{t("reports_status")}</th>
              </tr>
            </thead>
            <tbody>
              {detail.plan.installments.map((inst) => (
                <tr key={inst.seq} className="border-b border-dotted border-gray-200">
                  <td className="py-1 text-gray-400">{inst.seq}</td>
                  <td className="py-1">{formatDate(new Date(inst.dueDate))}</td>
                  <td className="py-1 text-right"><Amt value={inst.amount} /></td>
                  <td className="py-1 text-right"><Amt value={inst.paidAmount} /></td>
                  <td className={`py-1 ${u}`}>
                    <Tag tone={inst.status === "PAID" ? "green" : inst.status === "PARTIAL" ? "amber" : "gray"}>
                      {inst.status === "PAID" ? t("reports_statusPaid")
                        : inst.status === "PARTIAL" ? t("reports_statusPartial")
                        : t("reports_statusPending")}
                    </Tag>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail.remarks && (
        <div className="mt-3 rounded border border-gray-200 p-2">
          <span className={`text-[10px] font-semibold uppercase tracking-wide text-gray-400 ${u}`}>{t("purchases_remarks")}</span>
          <div className="whitespace-pre-line">{detail.remarks}</div>
        </div>
      )}

      {store?.footerTerms && (
        <div className="mt-3 whitespace-pre-line border-t border-dashed border-gray-300 pt-2 text-[10px] text-gray-500">
          {store.footerTerms}
        </div>
      )}
      <div className="mt-2 border-t border-gray-200 pt-1.5 text-center text-[9px] text-gray-400">
        {store?.name ?? "POS"} · {formatDate(new Date())} {formatTime(new Date())}
      </div>
    </div>
  );
}
