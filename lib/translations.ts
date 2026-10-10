/**
 * Translation strings for Sidhey Sheikh Cloth Center POS
 * Languages: English (en) and Urdu (ur)
 *
 * Domain-specific strings (per dashboard page) live in lib/translations/*.ts
 * and are merged in below to keep this file manageable.
 */

import { salesTranslations } from "./translations/sales";
import { purchasesTranslations } from "./translations/purchases";
import { itemsTranslations } from "./translations/items";
import { catalogTranslations } from "./translations/catalog";
import { partiesTranslations } from "./translations/parties";
import { ledgerTranslations } from "./translations/ledger";
import { reportsTranslations } from "./translations/reports";
import { settingsTranslations } from "./translations/settings";
import { backupTranslations } from "./translations/backup";
import { rolesTranslations } from "./translations/roles";
import { accountsTranslations } from "./translations/accounts";
import { expensesTranslations } from "./translations/expenses";

const baseTranslations = {
  en: {
    // Sidebar nav
    dashboard: "Dashboard",
    sales: "Sales (POS)",
    purchases: "Purchases (GRN)",
    // The sidebar label only. The bare `items` key below stays "Items" because
    // it also labels a Dashboard tile and the Resume dialog's column header,
    // where "Items / Products" would not fit.
    nav_items: "Items / Products",
    items: "Items",
    catalog: "Catalog",
    // Sidebar label only, like `nav_items` above — the bare `parties` key still
    // labels a Dashboard tile that must stay short.
    nav_parties: "Customers/Vendors",
    parties: "Parties",
    ledger: "Ledger",
    reports: "Sales Report",
    settings: "Settings",
    signOut: "Sign Out",
    installApp: "Install App",

    // "Login as user" banner (components/layout/ImpersonationBar.tsx)
    impersonating_viewingAs: "Viewing as",
    impersonating_signedInAs: "signed in as",
    impersonating_hint: "Everything you do is recorded against this user.",
    impersonating_backToAdmin: "Back to my account",
    impersonating_switching: "Switching…",
    impersonating_switchFailed: "Could not switch back — try signing out",
    allSynced: "All synced",
    pending: "pending",
    offline: "Offline",
    syncing: "Syncing…",

    // Pages
    dashboard_title: "Dashboard",
    sales_title: "Sale Voucher",
    ledger_title: "Ledger & Accounts",
    reports_title: "Reports",
    settings_title: "Settings",
    parties_title: "Parties",
    items_title: "Items",
    purchases_title: "Purchases (GRN)",
    catalog_title: "Catalog",

    // Settings tabs
    storeInfo: "Store Info",
    receipt: "Receipt / Print",
    pwa: "PWA & App",
    backup: "Backup",
    users: "Users",
    language: "Language",

    // Language names
    lang_en: "English",
    lang_ur: "اردو",
    langLabel: "Interface Language",
    langHint: "Changes the language of menus, buttons, and labels throughout the app.",

    // Common
    save: "Save",
    cancel: "Cancel",
    export: "Export",
    loading: "Loading…",
    search: "Search",
    filter: "Filter",
    from: "From",
    to: "To",
    date: "Date",
    name: "Name",
    type: "Type",
    amount: "Amount",
    balance: "Balance",
    actions: "Actions",
    all: "All",
    yes: "Yes",
    no: "No",
    pagination_prev: "Prev",
    pagination_next: "Next",
    pagination_page: "Page",
    pagination_of: "of",
    pagination_records: "records",

    // Dashboard page
    dash_welcome: "Welcome",
    dash_todaysSales: "Today's Sales",
    dash_cashReceived: "Cash Received",
    dash_today: "Today",
    dash_heldInvoices: "Held Invoices",
    dash_pendingRecall: "Pending recall (F8)",
    dash_lowStock: "Low Stock",
    dash_itemsBelowMin: "Items below minimum",
    dash_quickActions: "Quick Actions",
    dash_newSale: "New Sale",
    dash_posBilling: "POS Billing",
    dash_newGRN: "New GRN",
    dash_purchaseEntry: "Purchase Entry",
    dash_products: "products",
    dash_parties: "parties",
    dash_recentInvoices: "Recent Invoices",
    dash_viewAll: "View all",
    dash_noInvoicesToday: "No invoices yet today",
    dash_invoices: "invoice(s)",
    dash_lowStockAlerts: "Low Stock Alerts",
    dash_viewInventory: "View inventory",
    dash_allStocked: "✅ All items sufficiently stocked",
    dash_min: "Min",
    dash_lowStockBadge: "Low stock",

    // Dashboard sales & profit panel
    dash_salesProfit: "Sales & Profit",
    dash_salesProfitSubtitle: "Filter the period to re-scope every figure and the chart below",
    dash_sales: "Sales",
    dash_profit: "Profit",
    dash_margin: "Margin",
    dash_costOfGoods: "Cost of goods",
    dash_returns: "Returns",
    dash_discountGiven: "Discount given",
    dash_invoiceCount: "Invoices",
    dash_profitEstimateNote: "Profit is valued at each item's current purchase price — sale lines carry no cost snapshot, so re-pricing an item shifts past profit.",
    dash_noSalesInPeriod: "No sales in this period",
    dash_showTable: "Show table",
    dash_hideTable: "Hide table",
    dash_period: "Period",
    dash_byDay: "by day",
    dash_byMonth: "by month",
    dash_loadFailed: "Failed to load the sales & profit summary",
    dash_grossProfit: "Gross Profit",
    dash_expenses: "Costs",
    dash_netProfit: "Net Profit",
    dash_afterCosts: "after costs",
    dash_netProfitNote: "Net profit takes the period's recorded costs off gross profit. Owner withdrawals are excluded — they move money without costing the shop anything.",
  },

  ur: {
    // Sidebar nav
    dashboard: "ڈیش بورڈ",
    sales: "فروخت (POS)",
    purchases: "خریداری (GRN)",
    nav_items: "اشیاء / پروڈکٹس",
    items: "اشیاء",
    catalog: "کیٹالاگ",
    nav_parties: "کسٹمرز/وینڈرز",
    parties: "فریقین",
    ledger: "کھاتہ",
    reports: "فروخت کی رپورٹ",
    settings: "ترتیبات",
    signOut: "باہر نکلیں",
    installApp: "ایپ انسٹال کریں",

    // "Login as user" banner
    impersonating_viewingAs: "بطور صارف دیکھ رہے ہیں",
    impersonating_signedInAs: "لاگ اِن ہیں بطور",
    impersonating_hint: "آپ کا ہر عمل اسی صارف کے نام درج ہوگا۔",
    impersonating_backToAdmin: "اپنے اکاؤنٹ پر واپس جائیں",
    impersonating_switching: "تبدیل ہو رہا ہے…",
    impersonating_switchFailed: "واپس نہیں جا سکے — باہر نکل کر دوبارہ لاگ اِن کریں",
    allSynced: "مطابقت مکمل",
    pending: "زیر التواء",
    offline: "آف لائن",
    syncing: "مطابقت ہو رہی ہے…",

    // Pages
    dashboard_title: "ڈیش بورڈ",
    sales_title: "فروخت رسید",
    ledger_title: "کھاتہ و حسابات",
    reports_title: "رپورٹیں",
    settings_title: "ترتیبات",
    parties_title: "فریقین",
    items_title: "اشیاء",
    purchases_title: "خریداری (GRN)",
    catalog_title: "کیٹالاگ",

    // Settings tabs
    storeInfo: "دکان کی معلومات",
    receipt: "رسید / پرنٹ",
    pwa: "ایپ کی ترتیبات",
    backup: "بیک اپ",
    users: "صارفین",
    language: "زبان",

    // Language names
    lang_en: "English",
    lang_ur: "اردو",
    langLabel: "انٹرفیس زبان",
    langHint: "اس سے پورے ایپ میں مینیو، بٹن اور لیبل کی زبان تبدیل ہوگی۔",

    // Common
    save: "محفوظ کریں",
    cancel: "منسوخ",
    export: "برآمد",
    loading: "لوڈ ہو رہا ہے…",
    search: "تلاش",
    filter: "فلٹر",
    from: "سے",
    to: "تک",
    date: "تاریخ",
    name: "نام",
    type: "قسم",
    amount: "رقم",
    balance: "بقایا",
    actions: "اقدامات",
    all: "سب",
    yes: "ہاں",
    no: "نہیں",
    pagination_prev: "پچھلا",
    pagination_next: "اگلا",
    pagination_page: "صفحہ",
    pagination_of: "از",
    pagination_records: "ریکارڈز",

    // Dashboard page
    dash_welcome: "خوش آمدید",
    dash_todaysSales: "آج کی فروخت",
    dash_cashReceived: "موصول نقدی",
    dash_today: "آج",
    dash_heldInvoices: "رکی ہوئی رسیدیں",
    dash_pendingRecall: "زیر التواء بحالی (F8)",
    dash_lowStock: "کم اسٹاک",
    dash_itemsBelowMin: "کم از کم سے کم اشیاء",
    dash_quickActions: "فوری اقدامات",
    dash_newSale: "نئی فروخت",
    dash_posBilling: "POS بلنگ",
    dash_newGRN: "نئی جی آر این",
    dash_purchaseEntry: "خریداری اندراج",
    dash_products: "مصنوعات",
    dash_parties: "فریقین",
    dash_recentInvoices: "حالیہ رسیدیں",
    dash_viewAll: "سب دیکھیں",
    dash_noInvoicesToday: "آج تک کوئی رسید نہیں",
    dash_invoices: "رسید(یں)",
    dash_lowStockAlerts: "کم اسٹاک الرٹس",
    dash_viewInventory: "انوینٹری دیکھیں",
    dash_allStocked: "✅ تمام اشیاء وافر مقدار میں موجود ہیں",
    dash_min: "کم از کم",
    dash_lowStockBadge: "کم اسٹاک",

    // Dashboard sales & profit panel
    dash_salesProfit: "فروخت اور منافع",
    dash_salesProfitSubtitle: "مدت منتخب کریں — نیچے کے تمام اعداد و شمار اور چارٹ اسی کے مطابق بدلیں گے",
    dash_sales: "فروخت",
    dash_profit: "منافع",
    dash_margin: "مارجن",
    dash_costOfGoods: "مالِ فروخت کی لاگت",
    dash_returns: "واپسی",
    dash_discountGiven: "دی گئی رعایت",
    dash_invoiceCount: "رسیدیں",
    dash_profitEstimateNote: "منافع ہر آئٹم کی موجودہ خرید قیمت پر شمار کیا گیا ہے — فروخت کی سطروں میں لاگت محفوظ نہیں ہوتی، اس لیے قیمت بدلنے سے پرانا منافع بھی بدل جاتا ہے۔",
    dash_noSalesInPeriod: "اس مدت میں کوئی فروخت نہیں",
    dash_showTable: "ٹیبل دکھائیں",
    dash_hideTable: "ٹیبل چھپائیں",
    dash_period: "مدت",
    dash_byDay: "روزانہ",
    dash_byMonth: "ماہانہ",
    dash_loadFailed: "فروخت اور منافع کا خلاصہ لوڈ نہیں ہو سکا",
    dash_grossProfit: "خام منافع",
    dash_expenses: "اخراجات",
    dash_netProfit: "خالص منافع",
    dash_afterCosts: "اخراجات کے بعد",
    dash_netProfitNote: "خالص منافع میں اس مدت کے درج شدہ اخراجات خام منافع سے منہا کیے گئے ہیں۔ مالک کی نکالی گئی رقم شامل نہیں — اس سے رقم منتقل ہوتی ہے، دکان کا خرچ نہیں ہوتا۔",
  },
} as const;

export const translations = {
  en: {
    ...baseTranslations.en,
    ...salesTranslations.en,
    ...purchasesTranslations.en,
    ...itemsTranslations.en,
    ...catalogTranslations.en,
    ...partiesTranslations.en,
    ...ledgerTranslations.en,
    ...reportsTranslations.en,
    ...settingsTranslations.en,
    ...backupTranslations.en,
    ...rolesTranslations.en,
    ...accountsTranslations.en,
    ...expensesTranslations.en,
  },
  ur: {
    ...baseTranslations.ur,
    ...salesTranslations.ur,
    ...purchasesTranslations.ur,
    ...itemsTranslations.ur,
    ...catalogTranslations.ur,
    ...partiesTranslations.ur,
    ...ledgerTranslations.ur,
    ...reportsTranslations.ur,
    ...settingsTranslations.ur,
    ...backupTranslations.ur,
    ...rolesTranslations.ur,
    ...accountsTranslations.ur,
    ...expensesTranslations.ur,
  },
} as const;

export type Lang = keyof typeof translations;
export type TranslationKey = keyof typeof translations.en;
