"use client";

import { useRef } from "react";
import { useReactToPrint } from "react-to-print";
import { X, Printer } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";

type GRNItem = {
  id: string;
  itemId: string;
  itemName: string;
  unit: string;
  qty: number;
  costRate: number;
  saleRate: number;
  disPct: number;
  amount: number;
  isReturn: boolean;
};

type GRNSummary = {
  grnNo: number;
  date: Date;
  billNo?: string;
  remarks?: string;
  vendorName: string;
  saleAmount: number;
  billAmount: number;
  returnAmount: number;
  discountPct: number;
  adjustment: number;
  netBill: number;
  totalPurchaseQty: number;
  totalReturnQty: number;
};

type Props = {
  grn: GRNSummary;
  lines: GRNItem[];
  storeName: string;
  storeAddress?: string;
  storePhone?: string;
  size?: "A5" | "A4";
  onClose: () => void;
};

export default function GRNPrintModal({ grn, lines, storeName, storeAddress, storePhone, size = "A5", onClose }: Props) {
  const printRef = useRef<HTMLDivElement>(null);

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `GRN-${grn.grnNo}`,
    pageStyle: `
      @page {
        size: ${size === "A4" ? "A4 portrait" : "148mm 210mm portrait"};
        margin: 10mm;
      }
      body { font-family: Arial, sans-serif; font-size: 11px; }
    `,
  });

  const purchaseLines = lines.filter((l) => !l.isReturn);
  const returnLines = lines.filter((l) => l.isReturn);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-white rounded-xl shadow-2xl w-[720px] max-h-[90vh] flex flex-col">
        {/* Modal header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-bold">GRN Print Preview — #{grn.grnNo}</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handlePrint()}
              className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 transition-colors"
            >
              <Printer className="w-4 h-4" />
              Print {size}
            </button>
            <button
              onClick={onClose}
              className="p-2 text-gray-500 hover:text-gray-800 rounded-lg hover:bg-gray-100"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Print content */}
        <div className="overflow-y-auto p-4">
          <div ref={printRef} className="p-4 text-xs font-mono leading-tight">
            {/* Store Header */}
            <div className="text-center mb-3">
              <div className="text-base font-bold uppercase">{storeName}</div>
              {storeAddress && <div className="text-gray-600">{storeAddress}</div>}
              {storePhone && <div className="text-gray-600">Ph: {storePhone}</div>}
              <div className="text-sm font-bold mt-1 border-t border-b border-gray-400 py-0.5">
                GOODS RECEIPT NOTE
              </div>
            </div>

            {/* GRN Details */}
            <div className="grid grid-cols-2 gap-x-4 mb-3 text-xs">
              <div><span className="font-semibold">GRN No:</span> {grn.grnNo}</div>
              <div><span className="font-semibold">Date:</span> {formatDate(grn.date)}</div>
              <div className="col-span-2"><span className="font-semibold">Vendor:</span> {grn.vendorName}</div>
              {grn.billNo && <div><span className="font-semibold">Bill No:</span> {grn.billNo}</div>}
              {grn.remarks && <div className="col-span-2"><span className="font-semibold">Remarks:</span> {grn.remarks}</div>}
            </div>

            {/* Purchase Lines */}
            {purchaseLines.length > 0 && (
              <>
                <div className="font-semibold mb-1 border-b border-gray-400">Purchase Items</div>
                <table className="w-full text-xs mb-2">
                  <thead>
                    <tr className="border-b border-gray-300">
                      <th className="text-left py-0.5">#</th>
                      <th className="text-left py-0.5">Item</th>
                      <th className="text-right py-0.5">Qty</th>
                      <th className="text-right py-0.5">Cost</th>
                      <th className="text-right py-0.5">Sale</th>
                      <th className="text-right py-0.5">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchaseLines.map((line, i) => (
                      <tr key={line.id} className="border-b border-gray-100">
                        <td className="py-0.5">{i + 1}</td>
                        <td className="py-0.5">{line.itemName}</td>
                        <td className="text-right py-0.5">{line.qty} {line.unit}</td>
                        <td className="text-right py-0.5">{formatCurrency(line.costRate)}</td>
                        <td className="text-right py-0.5">{formatCurrency(line.saleRate)}</td>
                        <td className="text-right py-0.5">{formatCurrency(line.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {/* Return Lines */}
            {returnLines.length > 0 && (
              <>
                <div className="font-semibold mb-1 border-b border-gray-400">Return Items</div>
                <table className="w-full text-xs mb-2">
                  <thead>
                    <tr className="border-b border-gray-300">
                      <th className="text-left py-0.5">#</th>
                      <th className="text-left py-0.5">Item</th>
                      <th className="text-right py-0.5">Qty</th>
                      <th className="text-right py-0.5">Cost</th>
                      <th className="text-right py-0.5">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {returnLines.map((line, i) => (
                      <tr key={line.id} className="border-b border-gray-100">
                        <td className="py-0.5">{i + 1}</td>
                        <td className="py-0.5">{line.itemName}</td>
                        <td className="text-right py-0.5">{line.qty} {line.unit}</td>
                        <td className="text-right py-0.5">{formatCurrency(line.costRate)}</td>
                        <td className="text-right py-0.5">{formatCurrency(line.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {/* Summary */}
            <div className="border-t border-gray-400 pt-2 mt-2">
              <div className="grid grid-cols-2 gap-x-4 text-xs">
                <div className="col-span-2 flex justify-between">
                  <span>Sale Amount:</span>
                  <span className="font-semibold">{formatCurrency(grn.saleAmount)}</span>
                </div>
                {grn.returnAmount > 0 && (
                  <div className="col-span-2 flex justify-between">
                    <span>Return Amount:</span>
                    <span>{formatCurrency(grn.returnAmount)}</span>
                  </div>
                )}
                {grn.discountPct > 0 && (
                  <div className="col-span-2 flex justify-between">
                    <span>Discount:</span>
                    <span>{grn.discountPct}%</span>
                  </div>
                )}
                {grn.adjustment !== 0 && (
                  <div className="col-span-2 flex justify-between">
                    <span>Adjustment:</span>
                    <span>{formatCurrency(grn.adjustment)}</span>
                  </div>
                )}
                <div className="col-span-2 flex justify-between font-bold border-t border-gray-400 mt-1 pt-1">
                  <span>Net Bill:</span>
                  <span>{formatCurrency(grn.netBill)}</span>
                </div>
                <div className="col-span-2 flex justify-between text-gray-600">
                  <span>Total Purchase Qty:</span>
                  <span>{grn.totalPurchaseQty}</span>
                </div>
                {grn.totalReturnQty > 0 && (
                  <div className="col-span-2 flex justify-between text-gray-600">
                    <span>Total Return Qty:</span>
                    <span>{grn.totalReturnQty}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="text-center text-gray-400 text-[10px] mt-4 border-t pt-2">
              Generated by Sidhey Sheikh Cloth Center POS
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}