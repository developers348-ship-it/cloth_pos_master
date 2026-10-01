"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useI18n } from "@/lib/i18n";

type Props = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
};

/**
 * Prev/Next paging for a list backed by a server-side `skip`/`take` query.
 * No page-number jump list — every list in this app is filtered by a date
 * range or search first, so the page count is usually small and Prev/Next
 * is enough; a jump list would be one more thing to keep in sync with
 * `total` changing under a live filter.
 */
export default function Pagination({ page, pageSize, total, onPageChange }: Props) {
  const { t, isUrdu } = useI18n();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (total === 0) return null;

  return (
    <div className="flex items-center justify-between gap-3 border-t border-gray-100 bg-gray-50 px-4 py-3 text-sm">
      <span className={`text-gray-500 ${isUrdu ? "urdu-text" : ""}`}>
        {t("pagination_page")} {page} {t("pagination_of")} {totalPages}
        <span className="text-gray-400"> · {total} {t("pagination_records")}</span>
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white ${isUrdu ? "urdu-text" : ""}`}
        >
          <ChevronLeft className="w-4 h-4" /> {t("pagination_prev")}
        </button>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white ${isUrdu ? "urdu-text" : ""}`}
        >
          {t("pagination_next")} <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
