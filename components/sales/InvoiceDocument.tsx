"use client";

import { formatCurrency, formatDate, formatTime } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { useStore } from "@/lib/store-context";
import { invoiceDiscounts, lineDiscount, type InvoiceDetail } from "./invoice-detail";

/**
 * The invoice as a document — the A4 / A5 rendering, and the same markup on
 * screen as on paper so the two can't tell different stories.
 *
 * Presentational only: it takes a loaded `InvoiceDetail` and the ref that
 * react-to-print prints from. The page owns the fetch and the print buttons
 * (`app/dashboard/invoices/[id]/page.tsx`).
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

function Tag({ children, tone = "gray" }: { children: React.ReactNode; tone?: "gray" | "green" | "amber" | "red" | "blue" | "purple" }) {
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
export default function InvoiceDocument({
  detail, docRef,
}: {
  detail: InvoiceDetail;
  docRef: React.Ref<HTMLDivElement>;
}) {
  const { t, isUrdu } = useI18n();
  const { store } = useStore();
  const u = isUrdu ? "urdu-text" : "";
  const isRefundDoc = detail.totals.netBill < 0;
  const soldLines = detail.items.filter((i) => !i.isReturn);
  const returnLines = detail.items.filter((i) => i.isReturn);
  const disc = invoiceDiscounts(detail);

  return (
    <div ref={docRef} id="invoice-doc" className="text-[11px] leading-snug text-gray-800">

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
          {isRefundDoc ? t("reports_refundInvoice") : t("reports_saleInvoice")}
        </div>
      </div>

      {/* Invoice meta + customer, side by side */}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded border border-gray-200 p-2">
          <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
            <span className={`text-gray-500 ${u}`}>{t("reports_invoice")}</span>
            <span className="font-mono font-semibold">#{detail.invoiceNo}</span>
            <span className={`text-gray-500 ${u}`}>{t("date")}</span>
            <span>{formatDate(new Date(detail.date))} · {formatTime(new Date(detail.date))}</span>
            <span className={`text-gray-500 ${u}`}>{t("reports_cashier")}</span>
            <span>{detail.cashier ?? "—"}</span>
            <span className={`text-gray-500 ${u}`}>{t("reports_paymentOption")}</span>
            <span className={u}>
              {detail.partyOption === "CASH" ? t("sales_paymentOptionCash") : t("sales_paymentOptionCC")}
            </span>
            <span className={`text-gray-500 ${u}`}>{t("reports_paymentMethod")}</span>
            <span>
              {detail.paymentMethod === "CASH" ? t("reports_cash")
                : detail.paymentMethod === "BANK" ? t("reports_bank")
                : `${t("reports_cash")} + ${t("reports_bank")}`}
              {detail.bankAccountName ? ` (${detail.bankAccountName})` : ""}
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1 border-t border-dashed border-gray-200 pt-1.5">
            <Tag tone={detail.payment.status === "PAID" ? "green" : detail.payment.status === "PARTIAL" ? "amber" : "red"}>
              {detail.payment.status === "PAID" ? t("reports_statusPaid")
                : detail.payment.status === "PARTIAL" ? t("reports_statusPartial")
                : t("reports_statusUnpaid")}
            </Tag>
            {detail.status === "VOIDED" && <Tag>{t("reports_recordVoided")}</Tag>}
            {detail.refundedBy && <Tag tone="red">{t("reports_refunded")} · #{detail.refundedBy.invoiceNo}</Tag>}
            {detail.refundOf && <Tag tone="purple">{t("reports_refundOf")} #{detail.refundOf.invoiceNo}</Tag>}
            {detail.plan && <Tag tone="blue">{t("reports_installments")}</Tag>}
          </div>
        </div>

        <div className="rounded border border-gray-200 p-2">
          <div className={`mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 ${u}`}>
            {t("reports_customer")}
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
            <span className={`text-gray-500 ${u}`}>{t("name")}</span>
            <span className="font-semibold">{detail.party.name}</span>
            <span className={`text-gray-500 ${u}`}>{t("reports_accountNo")}</span>
            <span>#{detail.party.accountId}</span>
            {(detail.party.phone || detail.party.mobile) && (
              <>
                <span className={`text-gray-500 ${u}`}>{t("reports_phone")}</span>
                <span>{[detail.party.phone, detail.party.mobile].filter(Boolean).join(" / ")}</span>
              </>
            )}
            {(detail.party.address || detail.party.city) && (
              <>
                <span className={`text-gray-500 ${u}`}>{t("reports_address")}</span>
                <span>{[detail.party.address, detail.party.city].filter(Boolean).join(", ")}</span>
              </>
            )}
            {/*
              Previous and closing, so the document adds up on its own:
              previous balance + this bill's ledger effect = closing.
            */}
            <span className={`text-gray-500 ${u}`}>{t("reports_previousBalance")}</span>
            <span className={detail.party.balanceBefore > 0.005 ? "text-red-600" : ""}>
              <Amt value={detail.party.balanceBefore} />
            </span>
            <span className={`text-gray-500 ${u}`}>{t("reports_closingBalance")}</span>
            <span className={detail.party.balanceAfter > 0.005 ? "font-semibold text-red-600" : "font-semibold"}>
              <Amt value={detail.party.balanceAfter} />
            </span>
            {detail.party.creditLimit > 0 && (
              <>
                <span className={`text-gray-500 ${u}`}>{t("reports_creditLimit")}</span>
                <span><Amt value={detail.party.creditLimit} /></span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Line items — sold and returned kept apart, as on the counter slip */}
      {[
        { lines: soldLines, heading: t("reports_soldItems"), mark: "S" as const },
        { lines: returnLines, heading: t("reports_returnedItems"), mark: "R" as const },
      ].filter((g) => g.lines.length > 0).map((g) => (
        <div key={g.mark} className="mt-3">
          <div className={`mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 ${u}`}>{g.heading}</div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse">
              <thead>
                <tr className="border-y border-gray-300 text-[10px] uppercase tracking-wide text-gray-500">
                  <th className="w-7 py-1 text-left font-medium">#</th>
                  <th className={`py-1 text-left font-medium ${u}`}>{t("sales_itemName")}</th>
                  <th className={`py-1 text-center font-medium ${u}`}>{t("sales_unit")}</th>
                  <th className={`py-1 text-right font-medium ${u}`}>{t("sales_qty")}</th>
                  <th className={`py-1 text-right font-medium ${u}`}>{t("sales_rate")}</th>
                  <th className={`py-1 text-right font-medium ${u}`}>{t("reports_disRs")}</th>
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
                    <td className="py-1 text-right"><Amt value={li.rate} /></td>
                    <td className="py-1 text-right text-gray-500">
                      {/* In rupees even for a percentage discount — what the line actually lost */}
                      {lineDiscount(li) > 0 ? <Amt value={lineDiscount(li)} /> : "—"}
                    </td>
                    <td className="py-1 text-right tabular-nums text-gray-500">
                      {li.disRS <= 0.005 && li.disPct > 0.005 ? `${li.disPct}%` : "—"}
                    </td>
                    <td className="py-1 text-right font-medium"><Amt value={li.amount} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {/* Unit totals — pcs / gaz / mtr, the figures the shop counts in */}
      <div className={`mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] text-gray-500 ${u}`}>
        <span>
          {t("reports_sold")}: {detail.totals.soldPcs} pcs · {detail.totals.soldGaz} gaz · {detail.totals.soldMtr} mtr
        </span>
        {(detail.totals.returnPcs > 0 || detail.totals.returnGaz > 0 || detail.totals.returnMtr > 0) && (
          <span>
            {t("reports_returned")}: {detail.totals.returnPcs} pcs · {detail.totals.returnGaz} gaz · {detail.totals.returnMtr} mtr
          </span>
        )}
      </div>

      {/*
        Bill and payment, stacked in a right-hand column — the usual invoice
        shape, so the eye runs down one list of figures instead of across two.
      */}
      <div className="mt-3 flex justify-end">
        <div className="w-full space-y-2 sm:w-[58%] lg:w-1/2">
          <div className="rounded border border-gray-200 p-2">
            <div className={`mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 ${u}`}>
              {t("reports_totals")}
            </div>
            {disc.itemDiscount > 0.005 && (
              <>
                <Line label={t("reports_subtotal")} value={<Amt value={disc.subtotal} />} />
                <Line label={t("reports_itemDiscount")} value={<Amt value={-disc.itemDiscount} />} tone="text-orange-600" />
              </>
            )}
            <Line label={t("reports_grossSale")} value={<Amt value={detail.totals.grossSale} />} />
            {disc.packageDiscount > 0.005 && (
              <Line label={t("reports_packageDiscount")} value={<Amt value={-disc.packageDiscount} />} tone="text-orange-600" />
            )}
            {disc.itemDiscount > 0.005 && disc.packageDiscount > 0.005 && (
              <Line label={t("reports_totalDiscount")} value={<Amt value={disc.totalDiscount} />} tone="text-orange-600" />
            )}
            {detail.totals.returnAmount > 0.005 && (
              <Line label={t("reports_returns")} value={<Amt value={-detail.totals.returnAmount} />} tone="text-red-600" />
            )}
            {detail.totals.adjustment > 0.005 && (
              <Line
                label={`${t("reports_adjustment")} (${detail.totals.adjustType === "add" ? "+" : "−"})`}
                value={<Amt value={detail.totals.adjustType === "add" ? detail.totals.adjustment : -detail.totals.adjustment} />}
              />
            )}
            {detail.totals.courierCharges > 0.005 && (
              <Line label={t("sales_courier")} value={<Amt value={detail.totals.courierCharges} />} />
            )}
            {detail.totals.slipAmount > 0.005 && (
              <Line label={t("sales_slipAmount")} value={<Amt value={detail.totals.slipAmount} />} />
            )}
            <Line
              label={isRefundDoc ? t("reports_refundAmount") : t("reports_netBill")}
              value={<Amt value={detail.totals.netBill} bold />}
              bold
            />
          </div>

          <div className="rounded border border-gray-200 p-2">
            <div className={`mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 ${u}`}>
              {t("reports_paymentStatus")}
            </div>
            {detail.payment.cashReceived > 0.005 && (
              <Line label={t("reports_cash")} value={<Amt value={detail.payment.cashReceived} />} tone="text-green-700" />
            )}
            {detail.payment.cardAmount > 0.005 && (
              <Line label={t("reports_card")} value={<Amt value={detail.payment.cardAmount} />} tone="text-blue-700" />
            )}
            {detail.payment.bankAmount > 0.005 && (
              <Line
                label={detail.bankAccountName ? `${t("reports_bank")} (${detail.bankAccountName})` : t("reports_bank")}
                value={<Amt value={detail.payment.bankAmount} />}
                tone="text-blue-700"
              />
            )}
            {detail.payment.creditApplied > 0.005 && (
              <Line label={t("sales_creditApplied")} value={<Amt value={detail.payment.creditApplied} />} tone="text-purple-700" />
            )}
            {detail.payment.recovered > 0.005 && (
              <Line label={t("reports_recovered")} value={<Amt value={detail.payment.recovered} />} tone="text-teal-700" />
            )}
            {detail.payment.change > 0.005 && (
              <Line
                label={t("sales_changeFrom").replace("{amount}", formatCurrency(detail.payment.cashReceived + detail.payment.cardAmount + detail.payment.bankAmount + detail.payment.change))}
                value={<Amt value={detail.payment.change} />}
              />
            )}
            <Line label={t("reports_totalReceived")} value={<Amt value={detail.payment.settled} bold />} bold />
            <Line
              label={t("reports_outstanding")}
              value={<Amt value={detail.payment.outstanding} bold />}
              tone={detail.payment.outstanding > 0.005 ? "text-red-600" : "text-gray-500"}
            />
          </div>
        </div>
      </div>

      {/* Money collected after the sale */}
      {detail.recoveries.length > 0 && (
        <div className="mt-3">
          <div className={`mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 ${u}`}>
            {t("reports_paymentsAfterSale")}
          </div>
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-y border-gray-300 text-[10px] uppercase tracking-wide text-gray-500">
                <th className={`py-1 text-left font-medium ${u}`}>{t("date")}</th>
                <th className={`py-1 text-left font-medium ${u}`}>{t("reports_method")}</th>
                <th className={`py-1 text-left font-medium ${u}`}>{t("type")}</th>
                <th className={`py-1 text-right font-medium ${u}`}>{t("amount")}</th>
              </tr>
            </thead>
            <tbody>
              {detail.recoveries.map((r) => (
                <tr key={r.id} className="border-b border-dotted border-gray-200">
                  <td className="py-1">{formatDate(new Date(r.date))}</td>
                  <td className="py-1">
                    {r.paymentMethod === "BANK" ? t("reports_bank") : t("reports_cash")}
                    {r.accountName ? ` (${r.accountName})` : ""}
                    {r.notes && <span className="ml-1 text-gray-400">· {r.notes}</span>}
                  </td>
                  <td className={`py-1 text-gray-500 ${u}`}>
                    {r.isMarkPaid ? t("reports_markPaid") : t("reports_installments")}
                  </td>
                  <td className="py-1 text-right font-medium"><Amt value={r.amount} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Installment schedule */}
      {detail.plan && (
        <div className="mt-3">
          <div className={`mb-1 flex flex-wrap items-baseline gap-x-3 text-[10px] font-semibold uppercase tracking-wide text-gray-400 ${u}`}>
            <span>{t("reports_installmentSchedule")}</span>
            <span className="font-normal normal-case tracking-normal text-gray-500">
              {detail.plan.periods} × {detail.plan.kind === "MONTHLY" ? t("sales_repaymentMonthly")
                : detail.plan.kind === "WEEKLY" ? t("sales_repaymentWeekly")
                : t("sales_repaymentPromiseDay")} · <Amt value={detail.plan.principal} />
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

      {detail.notes && (
        <div className="mt-3 rounded border border-gray-200 p-2">
          <span className={`text-[10px] font-semibold uppercase tracking-wide text-gray-400 ${u}`}>{t("reports_notes")}</span>
          <div className="whitespace-pre-line">{detail.notes}</div>
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
