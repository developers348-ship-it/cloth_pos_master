"use client";

import { useRef } from "react";
import { useReactToPrint } from "react-to-print";
import { X, Printer } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";

type LedgerRow = {
  id: string;
  date: string | Date;
  type: string;
  reference: string | null;
  debit: number;
  credit: number;
  balance: number;
  notes: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  partyName: string;
  accountId: number;
  from: string;
  to: string;
  openingBalance: number;
  entries: LedgerRow[];
  totals: { totalDebit: number; totalCredit: number; closingBalance: number };
  storeName: string;
};

const TYPE_LABELS: Record<string, string> = {
  SALE: "Sale",
  SALE_RETURN: "Sale Return",
  PURCHASE: "Purchase",
  PURCHASE_RETURN: "Purchase Return",
  PAYMENT: "Payment",
  RECEIPT: "Receipt",
  ADJUSTMENT: "Adjustment",
  OPENING_BALANCE: "Opening Balance",
};

export default function LedgerPrintModal({
  open, onClose, partyName, accountId, from, to,
  openingBalance, entries, totals, storeName,
}: Props) {
  const printRef = useRef<HTMLDivElement>(null);

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `Ledger_${partyName}_${from}_${to}`,
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        {/* Modal header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 print:hidden">
          <h2 className="font-semibold text-gray-800">Ledger Statement — {partyName}</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handlePrint()}
              className="flex items-center gap-2 px-4 py-1.5 bg-teal-600 text-white rounded-lg text-sm hover:bg-teal-700 transition-colors"
            >
              <Printer className="w-4 h-4" />
              Print
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
              <X className="w-4 h-4 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Scrollable preview */}
        <div className="overflow-y-auto flex-1 p-5">
          {/* Printable area */}
          <div ref={printRef} className="font-mono text-[11px] text-gray-800">
            {/* Header */}
            <div className="text-center mb-4">
              <div className="text-lg font-bold uppercase tracking-wide">{storeName}</div>
              <div className="text-xs text-gray-500">Party Ledger Statement</div>
            </div>

            <div className="flex justify-between mb-1">
              <span><strong>Party:</strong> {partyName} (ID: {accountId})</span>
              <span><strong>Printed:</strong> {formatDate(new Date())}</span>
            </div>
            {(from || to) && (
              <div className="mb-3 text-xs text-gray-600">
                <strong>Period:</strong> {from ? formatDate(new Date(from)) : "All"} — {to ? formatDate(new Date(to)) : "All"}
              </div>
            )}

            <div className="mb-2 text-xs">
              <strong>Opening Balance:</strong>{" "}
              <span className={openingBalance >= 0 ? "text-red-700" : "text-green-700"}>
                Rs. {formatCurrency(Math.abs(openingBalance))}{" "}
                {openingBalance >= 0 ? "Dr" : "Cr"}
              </span>
            </div>

            {/* Table */}
            <table className="w-full border-collapse text-[10px]">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border border-gray-300 px-2 py-1 text-left">Date</th>
                  <th className="border border-gray-300 px-2 py-1 text-left">Type</th>
                  <th className="border border-gray-300 px-2 py-1 text-left">Reference</th>
                  <th className="border border-gray-300 px-2 py-1 text-left">Notes</th>
                  <th className="border border-gray-300 px-2 py-1 text-right">Debit</th>
                  <th className="border border-gray-300 px-2 py-1 text-right">Credit</th>
                  <th className="border border-gray-300 px-2 py-1 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {entries.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-4 text-gray-400 border border-gray-200">
                      No transactions in this period
                    </td>
                  </tr>
                ) : (
                  entries.map((row) => (
                    <tr key={row.id} className="hover:bg-gray-50">
                      <td className="border border-gray-200 px-2 py-1 whitespace-nowrap">
                        {formatDate(new Date(row.date))}
                      </td>
                      <td className="border border-gray-200 px-2 py-1 whitespace-nowrap">
                        {TYPE_LABELS[row.type] ?? row.type}
                      </td>
                      <td className="border border-gray-200 px-2 py-1">{row.reference ?? "—"}</td>
                      <td className="border border-gray-200 px-2 py-1 max-w-[180px] truncate">
                        {row.notes ?? ""}
                      </td>
                      <td className="border border-gray-200 px-2 py-1 text-right">
                        {row.debit > 0 ? formatCurrency(row.debit) : ""}
                      </td>
                      <td className="border border-gray-200 px-2 py-1 text-right">
                        {row.credit > 0 ? formatCurrency(row.credit) : ""}
                      </td>
                      <td className={`border border-gray-200 px-2 py-1 text-right font-semibold ${row.balance >= 0 ? "text-red-700" : "text-green-700"}`}>
                        {formatCurrency(Math.abs(row.balance))}{" "}
                        {row.balance >= 0 ? "Dr" : "Cr"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr className="bg-gray-100 font-bold">
                  <td colSpan={4} className="border border-gray-300 px-2 py-1 text-right">
                    Totals
                  </td>
                  <td className="border border-gray-300 px-2 py-1 text-right">
                    {formatCurrency(totals.totalDebit)}
                  </td>
                  <td className="border border-gray-300 px-2 py-1 text-right">
                    {formatCurrency(totals.totalCredit)}
                  </td>
                  <td className={`border border-gray-300 px-2 py-1 text-right ${totals.closingBalance >= 0 ? "text-red-700" : "text-green-700"}`}>
                    {formatCurrency(Math.abs(totals.closingBalance))}{" "}
                    {totals.closingBalance >= 0 ? "Dr" : "Cr"}
                  </td>
                </tr>
              </tfoot>
            </table>

            <div className="mt-4 text-[10px] text-gray-400 text-center">
              Dr = Debit (Party owes us) &nbsp;|&nbsp; Cr = Credit (We owe party)
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
