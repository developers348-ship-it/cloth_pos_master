/**
 * Domain translation strings for the Cost Management page
 * (`app/dashboard/expenses`) — operating costs, salaries, owner drawings and
 * the category manager.
 *
 * Merged into the app dictionary in `lib/translations.ts`.
 */

export const expensesTranslations = {
  en: {
    // Page header / nav
    expenses: "Costs",
    expenses_title: "Cost Management",
    expenses_subtitle: "Salaries, rent, utilities and other running costs — and what the owner takes out",

    // Summary tiles
    expenses_totalCosts: "Total Costs",
    expenses_unpaidCosts: "Unpaid",
    expenses_withdrawals: "Profit Withdrawn",
    expenses_injections: "Capital Added",
    expenses_entriesCount: "entries",
    expenses_stillOwed: "still owed",
    expenses_netWithdrawn: "Net taken out",

    // Filters
    expenses_dateRange: "Date Range",
    expenses_kind: "Kind",
    expenses_allKinds: "All Kinds",
    expenses_category: "Category",
    expenses_allCategories: "All Categories",
    expenses_status: "Status",
    expenses_allStatuses: "Paid & Unpaid",
    expenses_searchPlaceholder: "Search title, payee, reference…",

    // Kinds
    expenses_kind_EXPENSE: "Cost",
    expenses_kind_PROFIT_WITHDRAWAL: "Profit Withdrawal",
    expenses_kind_CAPITAL_INJECTION: "Capital Added",

    // Status
    expenses_status_PAID: "Paid",
    expenses_status_UNPAID: "Unpaid",

    // Table
    expenses_date: "Date",
    expenses_titleCol: "Description",
    expenses_payee: "Paid To",
    expenses_paidFrom: "Paid From",
    expenses_amount: "Amount",
    expenses_recordedBy: "Entered By",
    expenses_reference: "Reference",
    expenses_notes: "Notes",
    expenses_none: "No costs recorded for this period",
    expenses_loading: "Loading costs…",
    expenses_rangeTotal: "Range total",

    // Add / edit form
    expenses_addCost: "Record Cost",
    expenses_withdrawProfit: "Withdraw Profit",
    expenses_newCost: "New Cost",
    expenses_editCost: "Edit Cost",
    expenses_newWithdrawal: "Withdraw Profit / Add Capital",
    expenses_editWithdrawal: "Edit Withdrawal",
    expenses_titleLabel: "What was it for",
    expenses_titlePlaceholder: "e.g. October salary — Imran",
    expenses_amountRs: "Amount (Rs.)",
    expenses_selectCategory: "Select a category",
    expenses_payeeStaff: "Staff member (optional)",
    expenses_payeeStaffNone: "Not a staff member",
    expenses_payeeName: "Or type a name",
    expenses_payeeNamePlaceholder: "e.g. Imran Ali, K-Electric",
    expenses_payeeHint: "Pick a staff member for a salary, or just type any name",
    expenses_referencePlaceholder: "Bill / cheque number",
    expenses_direction: "Direction",
    expenses_directionOut: "Take money out (withdrawal)",
    expenses_directionIn: "Put money in (capital)",

    // Payment half
    expenses_payment: "Payment",
    expenses_payNow: "Paid now",
    expenses_payLater: "Record as unpaid",
    expenses_payLaterHint: "Counts as a cost straight away, but no money leaves any account until you mark it paid",
    expenses_paidWith: "Paid with",
    expenses_cash: "Cash",
    expenses_bank: "Bank",
    expenses_bankAccount: "Bank account",
    expenses_selectBankAccount: "Select a bank account",
    expenses_noBankAccounts: "No active bank accounts — add one on the Bank & Cash page",

    // Row actions
    expenses_markPaid: "Mark as Paid",
    expenses_edit: "Edit",
    expenses_delete: "Delete",
    expenses_confirmDelete: "Delete this entry? The money goes back into the account balance.",

    // Pay modal
    expenses_payTitle: "Settle Cost",
    expenses_paidOn: "Paid on",
    expenses_confirmPay: "Confirm Payment",

    // Categories manager
    expenses_manageCategories: "Categories",
    expenses_categoriesTitle: "Cost Categories",
    expenses_backToCosts: "Back to Costs",
    expenses_addCategory: "Add Category",
    expenses_newCategory: "New Category",
    expenses_editCategory: "Edit Category",
    expenses_categoryName: "Category Name",
    expenses_categoryNamePlaceholder: "e.g. Generator Diesel",
    expenses_categoryNote: "Note (optional)",
    expenses_categoryNotePlaceholder: "e.g. paid monthly",
    expenses_categoryUsage: "costs booked",
    expenses_deactivate: "Deactivate",
    expenses_activate: "Activate",
    expenses_inactive: "Inactive",
    expenses_confirmDeleteCategory: "Delete this category? Only possible while nothing is booked under it.",

    // Notes / caveats
    expenses_withdrawalNote:
      "Profit withdrawals move money out of an account but are never counted as a cost — taking earnings out does not make the shop less profitable.",
    expenses_accrualNote:
      "Costs count towards the period they are dated in, whether or not they have been paid yet.",

    // Messages
    expenses_savedMsg: "Cost recorded",
    expenses_updatedMsg: "Cost updated",
    expenses_deletedMsg: "Entry deleted",
    expenses_paidMsg: "Marked as paid",
    expenses_categorySavedMsg: "Category saved",
    expenses_categoryDeletedMsg: "Category deleted",
    expenses_titleRequiredMsg: "Enter what the cost was for",
    expenses_amountRequiredMsg: "Enter an amount greater than 0",
    expenses_categoryRequiredMsg: "Select a category",
    expenses_bankRequiredMsg: "Select a bank account",
    expenses_actionFailedMsg: "Action failed",
    expenses_noPermissionMsg: "You do not have permission to view costs",
  },
  ur: {
    // Page header / nav
    expenses: "اخراجات",
    expenses_title: "اخراجات کا انتظام",
    expenses_subtitle: "تنخواہ، کرایہ، بجلی اور دیگر اخراجات — اور مالک کی نکالی گئی رقم",

    // Summary tiles
    expenses_totalCosts: "کل اخراجات",
    expenses_unpaidCosts: "غیر ادا شدہ",
    expenses_withdrawals: "نکالا گیا منافع",
    expenses_injections: "شامل کی گئی رقم",
    expenses_entriesCount: "اندراجات",
    expenses_stillOwed: "ابھی واجب الادا",
    expenses_netWithdrawn: "خالص نکالی گئی رقم",

    // Filters
    expenses_dateRange: "تاریخ کی حد",
    expenses_kind: "قسم",
    expenses_allKinds: "تمام اقسام",
    expenses_category: "زمرہ",
    expenses_allCategories: "تمام زمرے",
    expenses_status: "حالت",
    expenses_allStatuses: "ادا شدہ و غیر ادا شدہ",
    expenses_searchPlaceholder: "تفصیل، نام یا حوالہ تلاش کریں…",

    // Kinds
    expenses_kind_EXPENSE: "خرچ",
    expenses_kind_PROFIT_WITHDRAWAL: "منافع کی نکاسی",
    expenses_kind_CAPITAL_INJECTION: "رقم شامل کی گئی",

    // Status
    expenses_status_PAID: "ادا شدہ",
    expenses_status_UNPAID: "غیر ادا شدہ",

    // Table
    expenses_date: "تاریخ",
    expenses_titleCol: "تفصیل",
    expenses_payee: "کس کو دیا",
    expenses_paidFrom: "کہاں سے ادا",
    expenses_amount: "رقم",
    expenses_recordedBy: "اندراج کرنے والا",
    expenses_reference: "حوالہ",
    expenses_notes: "نوٹس",
    expenses_none: "اس مدت کا کوئی خرچ درج نہیں",
    expenses_loading: "اخراجات لوڈ ہو رہے ہیں…",
    expenses_rangeTotal: "کل میزان",

    // Add / edit form
    expenses_addCost: "خرچ درج کریں",
    expenses_withdrawProfit: "منافع نکالیں",
    expenses_newCost: "نیا خرچ",
    expenses_editCost: "خرچ میں ترمیم",
    expenses_newWithdrawal: "منافع نکالیں / رقم شامل کریں",
    expenses_editWithdrawal: "نکاسی میں ترمیم",
    expenses_titleLabel: "کس مد میں",
    expenses_titlePlaceholder: "مثلاً اکتوبر کی تنخواہ — عمران",
    expenses_amountRs: "رقم (روپے)",
    expenses_selectCategory: "زمرہ منتخب کریں",
    expenses_payeeStaff: "ملازم (اختیاری)",
    expenses_payeeStaffNone: "ملازم نہیں",
    expenses_payeeName: "یا نام لکھیں",
    expenses_payeeNamePlaceholder: "مثلاً عمران علی، کے-الیکٹرک",
    expenses_payeeHint: "تنخواہ کے لیے ملازم منتخب کریں، ورنہ کوئی بھی نام لکھ دیں",
    expenses_referencePlaceholder: "بل / چیک نمبر",
    expenses_direction: "رخ",
    expenses_directionOut: "رقم نکالیں (نکاسی)",
    expenses_directionIn: "رقم شامل کریں (سرمایہ)",

    // Payment half
    expenses_payment: "ادائیگی",
    expenses_payNow: "ابھی ادا کر دی",
    expenses_payLater: "غیر ادا شدہ درج کریں",
    expenses_payLaterHint: "خرچ فوراً شامل ہو جائے گا، مگر جب تک ادا شدہ نہ کریں کسی اکاؤنٹ سے رقم نہیں نکلے گی",
    expenses_paidWith: "ادائیگی کا ذریعہ",
    expenses_cash: "نقد",
    expenses_bank: "بینک",
    expenses_bankAccount: "بینک اکاؤنٹ",
    expenses_selectBankAccount: "بینک اکاؤنٹ منتخب کریں",
    expenses_noBankAccounts: "کوئی فعال بینک اکاؤنٹ نہیں — بینک و نقد کے صفحے سے شامل کریں",

    // Row actions
    expenses_markPaid: "ادا شدہ قرار دیں",
    expenses_edit: "ترمیم",
    expenses_delete: "حذف کریں",
    expenses_confirmDelete: "کیا یہ اندراج حذف کریں؟ رقم اکاؤنٹ کے بیلنس میں واپس چلی جائے گی۔",

    // Pay modal
    expenses_payTitle: "خرچ کی ادائیگی",
    expenses_paidOn: "ادائیگی کی تاریخ",
    expenses_confirmPay: "ادائیگی کی تصدیق",

    // Categories manager
    expenses_manageCategories: "زمرے",
    expenses_categoriesTitle: "اخراجات کے زمرے",
    expenses_backToCosts: "اخراجات پر واپس",
    expenses_addCategory: "زمرہ شامل کریں",
    expenses_newCategory: "نیا زمرہ",
    expenses_editCategory: "زمرے میں ترمیم",
    expenses_categoryName: "زمرے کا نام",
    expenses_categoryNamePlaceholder: "مثلاً جنریٹر ڈیزل",
    expenses_categoryNote: "نوٹ (اختیاری)",
    expenses_categoryNotePlaceholder: "مثلاً ماہانہ ادائیگی",
    expenses_categoryUsage: "اخراجات درج",
    expenses_deactivate: "غیر فعال کریں",
    expenses_activate: "فعال کریں",
    expenses_inactive: "غیر فعال",
    expenses_confirmDeleteCategory: "کیا یہ زمرہ حذف کریں؟ صرف اُس صورت میں ممکن ہے جب اس میں کوئی خرچ درج نہ ہو۔",

    // Notes / caveats
    expenses_withdrawalNote:
      "منافع کی نکاسی سے اکاؤنٹ سے رقم نکلتی ہے مگر یہ خرچ شمار نہیں ہوتی — منافع نکالنے سے دکان کا نفع کم نہیں ہوتا۔",
    expenses_accrualNote:
      "خرچ اُسی مدت میں شمار ہوتا ہے جس کی تاریخ درج ہو، خواہ ادائیگی ہوئی ہو یا نہ ہوئی ہو۔",

    // Messages
    expenses_savedMsg: "خرچ درج ہو گیا",
    expenses_updatedMsg: "خرچ اپ ڈیٹ ہو گیا",
    expenses_deletedMsg: "اندراج حذف ہو گیا",
    expenses_paidMsg: "ادا شدہ قرار دے دیا",
    expenses_categorySavedMsg: "زمرہ محفوظ ہو گیا",
    expenses_categoryDeletedMsg: "زمرہ حذف ہو گیا",
    expenses_titleRequiredMsg: "خرچ کی تفصیل درج کریں",
    expenses_amountRequiredMsg: "صفر سے زیادہ رقم درج کریں",
    expenses_categoryRequiredMsg: "زمرہ منتخب کریں",
    expenses_bankRequiredMsg: "بینک اکاؤنٹ منتخب کریں",
    expenses_actionFailedMsg: "کارروائی ناکام ہو گئی",
    expenses_noPermissionMsg: "آپ کو اخراجات دیکھنے کی اجازت نہیں",
  },
} as const;
