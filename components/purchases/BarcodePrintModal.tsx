"use client";

import { useRef, useEffect } from "react";
import { useReactToPrint } from "react-to-print";
import { X, Printer } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import JsBarcode from "jsbarcode";

type BarcodeItem = {
  itemId: string;
  itemName: string;
  barcode?: string;
  systemBarcode?: string;
  saleRate: number;
  qty: number;
  unit: string;
};

type Props = {
  items: BarcodeItem[];
  double?: boolean;
  onClose: () => void;
};

function BarcodeLabel({ item, index }: { item: BarcodeItem; index: number }) {
  const svgRef = useRef<SVGSVGElement>(null);
  // The shop's own code first: it is on every item and always scans. The
  // company barcode is only a fallback for rows that did not carry the system
  // code, and the id slice is a last resort that no scan can resolve.
  const code = item.systemBarcode || item.barcode || item.itemId.slice(-10);

  useEffect(() => {
    if (svgRef.current) {
      try {
        JsBarcode(svgRef.current, code, {
          format: "CODE128",
          width: 1.5,
          height: 30,
          displayValue: true,
          fontSize: 8,
          margin: 2,
        });
      } catch {
        // Fallback: just show code as text
      }
    }
  }, [code]);

  return (
    <div
      key={`${item.itemId}-${index}`}
      className="border border-gray-300 rounded flex flex-col items-center justify-center p-1 text-center"
      style={{ width: "54mm", height: "27mm", fontSize: "7px", breakInside: "avoid" }}
    >
      <div
        className="font-bold leading-tight mb-0.5 line-clamp-2"
        style={{ fontSize: "8px", maxWidth: "50mm" }}
        title={item.itemName}
      >
        {item.itemName}
      </div>
      <svg ref={svgRef} />
      <div className="font-bold mt-0.5" style={{ fontSize: "9px" }}>
        Rs. {formatCurrency(item.saleRate)}
      </div>
    </div>
  );
}

export default function BarcodePrintModal({ items, double = false, onClose }: Props) {
  const printRef = useRef<HTMLDivElement>(null);

  // Filter to purchase items only and expand if double
  const purchaseItems = items.filter((i) => i.qty > 0);
  const labels: BarcodeItem[] = [];
  for (const item of purchaseItems) {
    labels.push(item);
    if (double) labels.push(item);
  }

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: "Barcode-Labels",
    pageStyle: `
      @page {
        size: A4 portrait;
        margin: 8mm;
      }
      body { font-family: Arial, sans-serif; }
      .label-grid { display: flex; flex-wrap: wrap; gap: 2mm; }
    `,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-white rounded-xl shadow-2xl w-[680px] max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-bold">
            Barcode Labels — {labels.length} labels{double ? " (Double)" : ""}
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handlePrint()}
              className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 transition-colors"
            >
              <Printer className="w-4 h-4" />
              Print Labels
            </button>
            <button
              onClick={onClose}
              className="p-2 text-gray-500 hover:text-gray-800 rounded-lg hover:bg-gray-100"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Preview */}
        <div className="overflow-y-auto p-4">
          {labels.length === 0 ? (
            <div className="text-center text-gray-400 py-12">No purchase items to print labels for.</div>
          ) : (
            <div ref={printRef} className="p-2">
              <div className="flex flex-wrap gap-2">
                {labels.map((item, i) => (
                  <BarcodeLabel key={i} item={item} index={i} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}