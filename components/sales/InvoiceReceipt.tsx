"use client";

import { Fragment } from "react";
import { formatDate, formatTime } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { useStore } from "@/lib/store-context";
import { receiptFontScale, RECEIPT_FONT_SIZE_DEFAULT, type ReceiptFontScale } from "@/lib/receipt-font";
import { invoiceDiscounts, lineDiscount, type InvoiceDetail } from "./invoice-detail";

/**
 * The 80mm thermal slip — the one receipt the app prints. The Sales page
 * renders it for the invoice being rung up (building an `InvoiceDetail` from
 * its own state), and the sales report / invoice page render it from
 * `GET /api/sales/:id`, so a re-print is the same piece of paper as the
 * original rather than a look-alike that drifts.
 *
 * Deliberately *not* the A4/A5 `InvoiceDocument`: no ledger history or
 * payments-after-sale table — just what was bought, what came off it, what it
 * came to, and what was paid, in the order a customer reads it. Discounts are
 * spelled out both per line and in the totals, because `grossSale` is stored
 * after line discounts and would otherwise hide them.
 *
 * On a net-return invoice `cashReceived`/`bankAmount` are money paid *out*, so
 * the labels flip to "Refunded" — the same reading the Sales page uses.
 */

/** Plain rupee figure — no thousands grouping games on a 80mm slip. */
const rs = (n: number) => `Rs. ${Math.abs(n).toFixed(2)}`;

/**
 * One label/amount line on the slip. Module scope, not nested in the component:
 * a component defined during render is a new type on every render, so React
 * would unmount and rebuild every one of these lines each time.
 */
function Row({ label, value, strong = false, font }: {
  label: string; value: string; strong?: boolean; font: ReceiptFontScale;
}) {
  const { isUrdu } = useI18n();
  return (
    <div
      className={`flex justify-between gap-2 ${strong ? "font-bold" : ""}`}
      style={strong ? { fontSize: font.lg } : undefined}
    >
      <span className={isUrdu ? "urdu-text" : undefined}>{label}</span>
      <span className="whitespace-nowrap tabular-nums">{value}</span>
    </div>
  );
}

export default function InvoiceReceipt({
  detail, docRef,
}: {
  detail: InvoiceDetail;
  docRef?: React.Ref<HTMLDivElement>;
}) {
  const { t, isUrdu } = useI18n();
  const { store } = useStore();
  const u = isUrdu ? "urdu-text" : "";
  const isRefund = detail.totals.netBill < 0;
  const p = detail.payment;
  const disc = invoiceDiscounts(detail);
  const qtySummary = (pcs: number, gaz: number, mtr: number) =>
    [pcs && `${pcs} pcs`, gaz && `${gaz} gaz`, mtr && `${mtr} mtr`].filter(Boolean).join(" · ");
  const soldQty = qtySummary(detail.totals.soldPcs, detail.totals.soldGaz, detail.totals.soldMtr);
  const returnQty = qtySummary(detail.totals.returnPcs, detail.totals.returnGaz, detail.totals.returnMtr);
  // Every size below is derived from the branch's one setting, so turning the
  // dial up scales the whole slip rather than only its body copy.
  const font = receiptFontScale(store?.receiptFontSize ?? RECEIPT_FONT_SIZE_DEFAULT);

  return (
    <div
      ref={docRef}
      id="invoice-receipt"
      className="mx-auto bg-white font-mono leading-tight text-black"
      style={{ width: "80mm", padding: "2mm", fontSize: font.base }}
    >
      {/* Store header */}
      <div className="border-b border-dashed border-black pb-1.5 text-center">
        <div className="font-bold uppercase" style={{ fontSize: font.xl }}>{store?.name ?? "POS"}</div>
        {(store?.address || store?.city) && (
          <div>{[store?.address, store?.city].filter(Boolean).join(", ")}</div>
        )}
        {(store?.phone || store?.mobile) && (
          <div>{t("reports_phone")}: {[store?.phone, store?.mobile].filter(Boolean).join(" / ")}</div>
        )}
      </div>

      <div className={`mt-1 text-center font-bold ${u}`}>
        {isRefund
          ? t("reports_refundInvoice")
          : detail.partyOption === "CASH"
          ? t("sales_paymentOptionCash")
          : t("sales_paymentOptionCC")}
      </div>
      {detail.status === "VOIDED" && (
        <div className={`text-center font-bold uppercase ${u}`}>*** {t("reports_recordVoided")} ***</div>
      )}
      {detail.refundOf && (
        <div className={`text-center ${u}`} style={{ fontSize: font.xs }}>{t("reports_refundOf")} #{detail.refundOf.invoiceNo}</div>
      )}

      <div className="mt-1 flex justify-between gap-2" style={{ fontSize: font.xs }}>
        <span>{t("reports_invoice")} #{detail.invoiceNo}</span>
        <span>{formatDate(new Date(detail.date))} {formatTime(new Date(detail.date))}</span>
      </div>
      <div className={u} style={{ fontSize: font.xs }}>
        {t("reports_customer")}: {detail.party.name}{detail.party.accountId ? ` (#${detail.party.accountId})` : ""}
      </div>
      {(detail.party.mobile || detail.party.phone) && (
        <div className={u} style={{ fontSize: font.xs }}>
          {t("reports_phone")}: {[detail.party.mobile, detail.party.phone].filter(Boolean).join(" / ")}
        </div>
      )}
      {detail.cashier && (
        <div className={u} style={{ fontSize: font.xs }}>{t("reports_cashier")}: {detail.cashier}</div>
      )}
      <div className={u} style={{ fontSize: font.xs }}>
        {t("reports_paymentMethod")}:{" "}
        {detail.paymentMethod === "BANK" ? t("reports_bank")
          : detail.paymentMethod === "CASH_AND_BANK" ? `${t("reports_cash")} + ${t("reports_bank")}`
          : t("reports_cash")}
      </div>

      {/* Items */}
      <table className="mt-1.5 w-full border-collapse" style={{ fontSize: font.sm }}>
        <thead>
          <tr className="border-y border-black">
            <th className={`py-0.5 text-left font-bold ${u}`}>{t("sales_itemName")}</th>
            <th className={`py-0.5 text-center font-bold ${u}`}>{t("sales_qty")}</th>
            <th className={`py-0.5 text-center font-bold ${u}`}>{t("sales_rate")}</th>
            <th className={`py-0.5 text-right font-bold ${u}`}>{t("amount")}</th>
          </tr>
        </thead>
        <tbody>
          {detail.items.map((li) => {
            const d = lineDiscount(li);
            return (
              <Fragment key={li.id}>
                <tr className={d > 0 ? "" : "border-b border-dotted border-gray-400"}>
                  <td className="py-0.5 pr-1">{li.isReturn ? "(R) " : ""}{li.name}</td>
                  <td className="py-0.5 text-center tabular-nums">{li.qty} {li.unit}</td>
                  <td className="py-0.5 text-center tabular-nums">{li.rate.toFixed(0)}</td>
                  <td className="py-0.5 text-right font-bold tabular-nums">{li.amount.toFixed(0)}</td>
                </tr>
                {/* The line's own discount, so the amount above visibly adds up: qty × rate − this. */}
                {d > 0 && (
                  <tr className="border-b border-dotted border-gray-400" style={{ fontSize: font.xs }}>
                    <td colSpan={3} className={`pb-0.5 pl-2 ${u}`}>
                      {t("reports_disc")}
                      {li.disRS > 0.005 ? "" : li.disPct > 0.005 ? ` ${li.disPct}%` : ""}
                      {` (${(li.rate * li.qty).toFixed(0)})`}
                    </td>
                    <td className="pb-0.5 text-right tabular-nums">-{d.toFixed(0)}</td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>

      <div className={`mt-0.5 flex flex-wrap justify-between gap-x-2 ${u}`} style={{ fontSize: font.xs }}>
        <span>{t("reports_items")}: {detail.items.filter((li) => !li.isReturn).length}</span>
        {soldQty && <span>{t("reports_qtyTotal")}: {soldQty}</span>}
        {returnQty && <span>{t("reports_returned")}: {returnQty}</span>}
      </div>

      {/* Bill */}
      <div className="mt-1.5 border-t border-dashed border-black pt-1.5">
        {disc.itemDiscount > 0.005 && (
          <>
            <Row label={t("reports_subtotal")} value={rs(disc.subtotal)} font={font} />
            <Row label={t("reports_itemDiscount")} value={`- ${rs(disc.itemDiscount)}`} font={font} />
          </>
        )}
        <Row label={t("reports_grossSale")} value={rs(detail.totals.grossSale)} font={font} />
        {disc.packageDiscount > 0.005 && (
          <Row label={t("reports_packageDiscount")} value={`- ${rs(disc.packageDiscount)}`} font={font} />
        )}
        {disc.itemDiscount > 0.005 && disc.packageDiscount > 0.005 && (
          <Row label={t("reports_totalDiscount")} value={rs(disc.totalDiscount)} font={font} />
        )}
        {detail.totals.returnAmount > 0.005 && (
          <Row label={t("reports_returns")} value={rs(detail.totals.returnAmount)} font={font} />
        )}
        {detail.totals.adjustment > 0.005 && (
          <Row
            label={t("reports_adjustment")}
            value={`${detail.totals.adjustType === "add" ? "+ " : "- "}${rs(detail.totals.adjustment)}`}
            font={font}
          />
        )}
        {detail.totals.courierCharges > 0.005 && (
          <Row label={t("sales_courier")} value={rs(detail.totals.courierCharges)} font={font} />
        )}
        <div className="mt-1 border-t border-black pt-1">
          <Row
            label={isRefund ? t("reports_refundAmount") : t("reports_netBill")}
            value={rs(detail.totals.netBill)}
            strong
            font={font}
          />
        </div>

        {p.cashReceived > 0.005 && (
          <Row label={isRefund ? `${t("reports_refund")} (${t("reports_cash")})` : t("reports_cashReceived")} value={rs(p.cashReceived)} font={font} />
        )}
        {p.cardAmount > 0.005 && <Row label={t("reports_card")} value={rs(p.cardAmount)} font={font} />}
        {p.bankAmount > 0.005 && (
          <Row
            label={`${isRefund ? `${t("reports_refund")} (${t("reports_bank")})` : t("reports_bank")}${detail.bankAccountName ? ` (${detail.bankAccountName})` : ""}`}
            value={rs(p.bankAmount)}
            font={font}
          />
        )}
        {p.creditApplied > 0.005 && <Row label={t("sales_creditApplied")} value={rs(p.creditApplied)} font={font} />}
        {p.recovered > 0.005 && <Row label={t("reports_recovered")} value={rs(p.recovered)} font={font} />}
        {p.change > 0.005 && <Row label={t("sales_changeFrom").replace("{amount}", (p.cashReceived + p.cardAmount + p.bankAmount + p.change).toFixed(2))} value={rs(p.change)} font={font} />}
        {p.outstanding > 0.005 && (
          <Row label={t("reports_outstanding")} value={rs(p.outstanding)} strong font={font} />
        )}
      </div>

      {/* Where the customer's account stands — only meaningful on a credit sale */}
      {detail.partyOption !== "CASH" && (
        <div className="mt-1.5 border-t border-dashed border-gray-500 pt-1.5">
          <Row label={t("reports_previousBalance")} value={rs(detail.party.balanceBefore)} font={font} />
          <Row label={t("reports_closingBalance")} value={rs(detail.party.balanceAfter)} font={font} />
        </div>
      )}

      {/* The repayment schedule the customer has agreed to */}
      {detail.plan && detail.plan.installments.length > 0 && (
        <div className="mt-1.5 border-t border-dashed border-black pt-1.5" style={{ fontSize: font.xs }}>
          <div className={`font-bold ${u}`}>
            {t("reports_installmentSchedule")} ({detail.plan.periods} ×{" "}
            {detail.plan.kind === "MONTHLY" ? t("sales_repaymentMonthly")
              : detail.plan.kind === "WEEKLY" ? t("sales_repaymentWeekly")
              : t("sales_repaymentPromiseDay")})
          </div>
          {detail.plan.installments.map((inst) => (
            <div key={inst.seq} className="flex justify-between gap-2">
              <span>{inst.seq}. {formatDate(new Date(inst.dueDate))}</span>
              <span className="tabular-nums">{rs(inst.amount)}</span>
            </div>
          ))}
        </div>
      )}

      {detail.notes?.trim() && (
        <div className="mt-1.5 border-t border-dashed border-black pt-1.5" style={{ fontSize: font.xs }}>
          <span className="font-bold">{t("reports_notes")}: </span>{detail.notes.trim()}
        </div>
      )}

      {store?.footerTerms && (
        <div className="mt-2 whitespace-pre-line border-t border-dashed border-black pt-1.5" style={{ fontSize: font.xs }}>
          {store.footerTerms}
        </div>
      )}
      <div className="mt-1.5 text-center" style={{ fontSize: font.xs }}>
        {formatDate(new Date())} {formatTime(new Date())}
      </div>
    </div>
  );
}
