import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { ShoppingCart, PackagePlus, Package, Users, TrendingUp, AlertTriangle, Clock } from "lucide-react";
import { formatCurrency, formatDate, cn, shopStartOfToday } from "@/lib/utils";
import { getServerLang, tFor } from "@/lib/i18n-server";
import SalesProfitPanel from "@/components/dashboard/SalesProfitPanel";
import { invoiceHref } from "@/lib/document-links";

export default async function DashboardPage() {
  const session = await auth();
  const branchId = (session?.user as any)?.branchId;
  const role = (session?.user as any)?.role;
  const lang = await getServerLang();
  const t = tFor(lang);
  const isUrdu = lang === "ur";

  // This component renders on the server, which runs in UTC — so the plain
  // `setHours(0, 0, 0, 0)` this replaces put the start of "today" at 05:00 shop
  // time and left every early-morning sale out of the tiles below.
  const today = shopStartOfToday();

  // None of these seven depend on each other's result, so they run as one round
  // of concurrent round trips instead of seven sequential ones — each trip to
  // the database costs real network latency, and that used to be paid six
  // times before the page could render anything.
  const [todaySales, todayRefunds, heldCount, stockRows, partyCount, itemCount, recentInvoices] =
    await Promise.all([
      // Today's sales
      prisma.saleInvoice.aggregate({
        where: {
          branchId,
          date: { gte: today },
          status: "SAVED",
        },
        _sum: { netBill: true, cashReceived: true, cardAmount: true },
        _count: { id: true },
      }),
      // Cash paid *out* on today's net-return invoices — `cashReceived` there
      // is a refund, so it comes off the tile rather than adding to it (see
      // `moneyInFromInvoice`). Change is already netted off at save time.
      prisma.saleInvoice.aggregate({
        where: { branchId, date: { gte: today }, status: "SAVED", netBill: { lt: 0 } },
        _sum: { cashReceived: true },
      }),
      // Held invoices
      prisma.saleInvoice.count({
        where: { branchId, status: "HELD" },
      }),
      // Low stock items — every active item's stock has to be checked, since
      // which 5 (if any) are low can't be known without looking at all of them.
      prisma.itemStock.findMany({
        where: {
          branchId,
          item: { isActive: true },
        },
        include: { item: true },
      }),
      // Total parties
      prisma.party.count({ where: { isActive: true } }),
      prisma.item.count({ where: { isActive: true } }),
      // Recent invoices
      prisma.saleInvoice.findMany({
        where: { branchId, status: "SAVED" },
        include: { party: true },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
    ]);
  const allLowStock = stockRows.filter((s) => s.qty <= s.item.minLevel);
  const lowStock = allLowStock.slice(0, 5);

  const totalSales = Number(todaySales._sum.netBill ?? 0);
  const refundCash = Number(todayRefunds._sum.cashReceived ?? 0);
  // All of today's cashReceived minus the refunds counted in it, minus them
  // once more because they were money going out.
  const cashSales = Number(todaySales._sum.cashReceived ?? 0) - 2 * refundCash;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className={cn("text-2xl font-bold text-gray-800", isUrdu && "urdu-text")}>{t("dashboard_title")}</h1>
        <p className={cn("text-gray-500 text-sm mt-0.5", isUrdu && "urdu-text")}>
          {formatDate(new Date())} — {t("dash_welcome")}, {session?.user?.name}
        </p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <span className={cn("text-sm text-gray-500", isUrdu && "urdu-text")}>{t("dash_todaysSales")}</span>
            <TrendingUp className="w-5 h-5 text-teal-500" />
          </div>
          <div className="text-2xl font-bold text-gray-800">
            Rs. {formatCurrency(totalSales)}
          </div>
          <div className={cn("text-xs text-gray-400 mt-1", isUrdu && "urdu-text")}>
            {todaySales._count.id} {t("dash_invoices")}
          </div>
        </div>

        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <span className={cn("text-sm text-gray-500", isUrdu && "urdu-text")}>{t("dash_cashReceived")}</span>
            <ShoppingCart className="w-5 h-5 text-green-500" />
          </div>
          <div className="text-2xl font-bold text-gray-800">
            Rs. {formatCurrency(cashSales)}
          </div>
          <div className={cn("text-xs text-gray-400 mt-1", isUrdu && "urdu-text")}>{t("dash_today")}</div>
        </div>

        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <span className={cn("text-sm text-gray-500", isUrdu && "urdu-text")}>{t("dash_heldInvoices")}</span>
            <Clock className="w-5 h-5 text-orange-500" />
          </div>
          <div className="text-2xl font-bold text-gray-800">{heldCount}</div>
          <div className={cn("text-xs text-gray-400 mt-1", isUrdu && "urdu-text")}>{t("dash_pendingRecall")}</div>
        </div>

        <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-3">
            <span className={cn("text-sm text-gray-500", isUrdu && "urdu-text")}>{t("dash_lowStock")}</span>
            <AlertTriangle className="w-5 h-5 text-red-500" />
          </div>
          <div className="text-2xl font-bold text-red-600">{allLowStock.length}</div>
          <div className={cn("text-xs text-gray-400 mt-1", isUrdu && "urdu-text")}>{t("dash_itemsBelowMin")}</div>
        </div>
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className={cn("text-lg font-semibold text-gray-700 mb-3", isUrdu && "urdu-text")}>{t("dash_quickActions")}</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Link
            href="/dashboard/sales"
            className="bg-teal-600 hover:bg-teal-700 text-white rounded-xl p-4 flex items-center gap-3 transition-colors"
          >
            <ShoppingCart className="w-6 h-6" />
            <div>
              <div className={cn("font-semibold text-sm", isUrdu && "urdu-text")}>{t("dash_newSale")}</div>
              <div className={cn("text-xs text-teal-200", isUrdu && "urdu-text")}>{t("dash_posBilling")}</div>
            </div>
          </Link>
          <Link
            href="/dashboard/purchases"
            className="bg-blue-600 hover:bg-blue-700 text-white rounded-xl p-4 flex items-center gap-3 transition-colors"
          >
            <PackagePlus className="w-6 h-6" />
            <div>
              <div className={cn("font-semibold text-sm", isUrdu && "urdu-text")}>{t("dash_newGRN")}</div>
              <div className={cn("text-xs text-blue-200", isUrdu && "urdu-text")}>{t("dash_purchaseEntry")}</div>
            </div>
          </Link>
          <Link
            href="/dashboard/items"
            className="bg-purple-600 hover:bg-purple-700 text-white rounded-xl p-4 flex items-center gap-3 transition-colors"
          >
            <Package className="w-6 h-6" />
            <div>
              <div className={cn("font-semibold text-sm", isUrdu && "urdu-text")}>{t("items")}</div>
              <div className={cn("text-xs text-purple-200", isUrdu && "urdu-text")}>{itemCount} {t("dash_products")}</div>
            </div>
          </Link>
          <Link
            href="/dashboard/parties"
            className="bg-orange-600 hover:bg-orange-700 text-white rounded-xl p-4 flex items-center gap-3 transition-colors"
          >
            <Users className="w-6 h-6" />
            <div>
              <div className={cn("font-semibold text-sm", isUrdu && "urdu-text")}>{t("parties")}</div>
              <div className={cn("text-xs text-orange-200", isUrdu && "urdu-text")}>{partyCount} {t("dash_parties")}</div>
            </div>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Invoices */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className={cn("font-semibold text-gray-700", isUrdu && "urdu-text")}>{t("dash_recentInvoices")}</h3>
            <Link href="/dashboard/reports" className={cn("text-xs text-teal-600 hover:underline", isUrdu && "urdu-text")}>
              {t("dash_viewAll")}
            </Link>
          </div>
          <div className="divide-y divide-gray-50">
            {recentInvoices.length === 0 ? (
              <p className={cn("text-center text-gray-400 py-8 text-sm", isUrdu && "urdu-text")}>{t("dash_noInvoicesToday")}</p>
            ) : (
              recentInvoices.map((inv) => (
                <div key={inv.id} className="px-5 py-3 flex items-center justify-between">
                  <div>
                    <Link href={invoiceHref(inv.id)} className="block text-sm font-medium text-teal-700 hover:underline">
                      #{inv.invoiceNo}
                    </Link>
                    <Link href={invoiceHref(inv.id)} className="block text-xs text-gray-400 hover:text-teal-600 hover:underline">
                      {inv.party.name}
                    </Link>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-gray-800">
                      Rs. {formatCurrency(Number(inv.netBill))}
                    </div>
                    <div className="text-xs text-gray-400">
                      {inv.partyOption === "CASH" ? t("sales_paymentOptionCash") : t("sales_paymentOptionCC")}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Low Stock Alert */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className={cn("font-semibold text-gray-700", isUrdu && "urdu-text")}>{t("dash_lowStockAlerts")}</h3>
            <Link href="/dashboard/purchases?tab=inventory&lowStock=1" className={cn("text-xs text-teal-600 hover:underline", isUrdu && "urdu-text")}>
              {t("dash_viewInventory")}
            </Link>
          </div>
          <div className="divide-y divide-gray-50">
            {lowStock.length === 0 ? (
              <p className={cn("text-center text-gray-400 py-8 text-sm", isUrdu && "urdu-text")}>{t("dash_allStocked")}</p>
            ) : (
              lowStock.map((s) => (
                <div key={s.id} className="px-5 py-3 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-gray-700 truncate max-w-[200px]">
                      {s.item.name}
                    </div>
                    <div className={cn("text-xs text-gray-400", isUrdu && "urdu-text")}>
                      {t("dash_min")}: {Number(s.item.minLevel)} {s.item.unit}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-red-600">
                      {Number(s.qty)} {s.item.unit}
                    </div>
                    <div className={cn("text-xs text-red-400", isUrdu && "urdu-text")}>{t("dash_lowStockBadge")}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Sales & profit for a chosen period. Its own filter, its own fetch —
          the tiles above stay pinned to today so the till's headline numbers
          don't move when someone browses last year. */}
      <SalesProfitPanel branchId={branchId ?? ""} />
    </div>
  );
}
