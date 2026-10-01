"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import {
  LayoutDashboard, ShoppingCart, PackagePlus, Users,
  Package, BookOpen, BarChart3, Settings, LogOut,
  ChevronRight, Layers, PanelLeftClose, PanelLeftOpen,
  Globe, Landmark, Receipt,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useStore } from "@/lib/store-context";
import { useI18n } from "@/lib/i18n";
import { usePermissions } from "@/lib/permissions-client";
import { useState } from "react";
import SyncBadge from "./SyncBadge";
import InstallPWA from "./InstallPWA";

export default function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { store } = useStore();
  const { t, lang, setLang, isUrdu } = useI18n();
  const { can } = usePermissions();
  const userRole = (session?.user as any)?.role ?? "";
  const [collapsed, setCollapsed] = useState(false);
  // Site-wide toggles from Settings (DB-backed on Branch) — default to shown
  // until the store settings load, so nothing flashes hidden then visible.
  const pwaEnabled = store?.pwaOfflineEnabled !== false;
  const languageSwitcherEnabled = store?.languageSwitcherEnabled !== false;

  const NAV_ITEMS = [
    { key: "dashboard" as const, href: "/dashboard",           icon: LayoutDashboard, roles: ["SUPER_ADMIN","ADMIN","MANAGER","CASHIER","ACCOUNTANT"] },
    { key: "sales" as const,     href: "/dashboard/sales",     icon: ShoppingCart,    roles: ["SUPER_ADMIN","ADMIN","MANAGER","CASHIER"], highlight: true, permission: "CREATE_INVOICE" },
    { key: "reports" as const,   href: "/dashboard/reports",   icon: BarChart3,       roles: ["SUPER_ADMIN","ADMIN","MANAGER","CASHIER","ACCOUNTANT"] },
    { key: "purchases" as const, href: "/dashboard/purchases", icon: PackagePlus,     roles: ["SUPER_ADMIN","ADMIN","MANAGER"], permission: "CREATE_GRN" },
    // `key` is the translation key for the label, so this one points at
    // `nav_items` rather than the shared `items` — that key also labels a
    // Dashboard tile and a table column that must stay just "Items".
    { key: "nav_items" as const, href: "/dashboard/items",     icon: Package,         roles: ["SUPER_ADMIN","ADMIN","MANAGER","CASHIER","ACCOUNTANT"], permission: "VIEW_ITEMS" },
    { key: "catalog" as const,   href: "/dashboard/catalog",   icon: Layers,          roles: ["SUPER_ADMIN","ADMIN","MANAGER"], permission: "ADD_ITEM" },
    { key: "nav_parties" as const, href: "/dashboard/parties", icon: Users,           roles: ["SUPER_ADMIN","ADMIN","MANAGER","CASHIER","ACCOUNTANT"], permission: "VIEW_PARTIES" },
    { key: "ledger" as const,    href: "/dashboard/ledger",    icon: BookOpen,        roles: ["SUPER_ADMIN","ADMIN","MANAGER","ACCOUNTANT"], permission: "VIEW_DAYBOOK" },
    // Every entry above is now gated on the permission matrix too, not just a
    // hardcoded role list, so Settings → Roles genuinely controls who sees each
    // page — each `permission` picks the key whose default role set already
    // matches the entry's `roles` list exactly, so this changes nothing under
    // the default matrix and only takes effect once an admin edits it.
    { key: "accounts" as const,  href: "/dashboard/accounts",  icon: Landmark,        roles: ["SUPER_ADMIN","ADMIN","MANAGER","ACCOUNTANT"], permission: "VIEW_ACCOUNTS" },
    { key: "expenses" as const,  href: "/dashboard/expenses",  icon: Receipt,         roles: ["SUPER_ADMIN","ADMIN","MANAGER","ACCOUNTANT"], permission: "VIEW_EXPENSES" },
    { key: "settings" as const,  href: "/dashboard/settings",  icon: Settings,        roles: ["SUPER_ADMIN","ADMIN"] },
  ];

  const visibleItems = NAV_ITEMS.filter(
    (item) =>
      item.roles.includes(userRole) &&
      (!("permission" in item) || can(item.permission as string))
  );

  const initials = (store?.name ?? "POS")
    .split(" ")
    .map((w) => w[0])
    .slice(0, 3)
    .join("")
    .toUpperCase();

  return (
    <aside
      className={cn(
        "bg-gray-900 text-white flex flex-col h-full shrink-0 transition-all duration-200",
        collapsed ? "w-16" : "w-60"
      )}
    >
      {/* Logo + Collapse Toggle */}
      <div className="px-3 py-4 border-b border-gray-700 flex items-center justify-between gap-2">
        {!collapsed && (
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 bg-teal-500 rounded-lg flex items-center justify-center font-bold text-xs shrink-0">
              {initials}
            </div>
            <div className="min-w-0">
              <div className={cn("font-bold text-xs leading-tight truncate", isUrdu && "urdu-text text-sm")} title={store?.name ?? "Loading..."}>
                {store?.name ?? "Loading..."}
              </div>
              <div className="text-gray-400 text-[10px] truncate">
                {store?.city ?? (session?.user as any)?.branchName ?? "—"}
              </div>
            </div>
          </div>
        )}

        {collapsed && (
          <div className="w-9 h-9 bg-teal-500 rounded-lg flex items-center justify-center font-bold text-xs mx-auto">
            {initials}
          </div>
        )}

        <button
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={cn(
            "p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition-colors shrink-0",
            collapsed && "mx-auto"
          )}
        >
          {collapsed ? (
            <PanelLeftOpen className="w-4 h-4" />
          ) : (
            <PanelLeftClose className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto">
        {visibleItems.map((item) => {
          const isActive =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? t(item.key) : undefined}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all",
                collapsed && "justify-center px-2",
                isActive
                  ? "bg-teal-600 text-white"
                  : "text-gray-400 hover:text-white hover:bg-gray-800",
                item.highlight && !isActive && "text-teal-400"
              )}
            >
              <item.icon className="w-4 h-4 shrink-0" />
              {!collapsed && (
                <>
                  <span className={cn("flex-1", isUrdu && "urdu-text text-base")}>{t(item.key)}</span>
                  {isActive && <ChevronRight className="w-3 h-3" />}
                </>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Bottom section */}
      <div className="border-t border-gray-700 p-3 space-y-1">
        {/* Sync badge */}
        {pwaEnabled && <SyncBadge collapsed={collapsed} />}

        {/* Language toggle */}
        {languageSwitcherEnabled && !collapsed && (
          <button
            onClick={() => setLang(lang === "en" ? "ur" : "en")}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
            title="Toggle language / زبان بدلیں"
          >
            <Globe className="w-3.5 h-3.5 shrink-0" />
            <span className="flex-1 text-left">
              {lang === "en" ? "اردو میں بدلیں" : "Switch to English"}
            </span>
          </button>
        )}
        {languageSwitcherEnabled && collapsed && (
          <button
            onClick={() => setLang(lang === "en" ? "ur" : "en")}
            title="Toggle language"
            className="flex justify-center w-full py-1 text-gray-400 hover:text-white"
          >
            <Globe className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Install PWA */}
        {pwaEnabled && !collapsed && <InstallPWA />}

        {/* Divider */}
        <div className="border-t border-gray-700 pt-2 mt-1">
          {/* User info */}
          {!collapsed && (
            <div className="flex items-center gap-3 px-2 py-1 mb-1">
              <div className="w-8 h-8 bg-teal-700 rounded-full flex items-center justify-center text-xs font-bold uppercase shrink-0">
                {session?.user?.name?.[0] ?? "U"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{session?.user?.name}</div>
                <div className="text-xs text-gray-400 truncate">{userRole.replace("_", " ")}</div>
              </div>
            </div>
          )}

          {collapsed && (
            <div className="flex justify-center mb-1">
              <div className="w-8 h-8 bg-teal-700 rounded-full flex items-center justify-center text-xs font-bold uppercase" title={session?.user?.name ?? ""}>
                {session?.user?.name?.[0] ?? "U"}
              </div>
            </div>
          )}

          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            title={collapsed ? t("signOut") : undefined}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-red-400 hover:bg-gray-800 transition-colors",
              collapsed && "justify-center px-2"
            )}
          >
            <LogOut className="w-4 h-4" />
            {!collapsed && <span className={isUrdu ? "urdu-text" : ""}>{t("signOut")}</span>}
          </button>
        </div>
      </div>
    </aside>
  );
}
