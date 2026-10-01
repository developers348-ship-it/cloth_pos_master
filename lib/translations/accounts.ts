/**
 * Domain translation strings for the Bank & Cash Accounts page
 * (`app/dashboard/accounts`) and its statement view.
 *
 * These keys were `settings_*` while accounts lived as a Settings tab; they
 * moved here with the page. Only the handful still used by other Settings tabs
 * (activate/deactivate, saving) stayed behind in `settings.ts`.
 */

export const accountsTranslations = {
  en: {
    // Page header
    accounts: "Bank & Cash",
    accounts_title: "Bank & Cash Accounts",
    accounts_subtitle: "Bank accounts, the cash-in-hand balance and the card machine for this branch",

    // Account list
    accounts_addBankAccount: "Add Bank Account",
    accounts_newBankAccount: "New Bank Account",
    accounts_editBankAccount: "Edit Bank Account",
    accounts_accountLabel: "Account Label",
    accounts_accountLabelPlaceholder: "e.g. HBL - Main Branch",
    accounts_bankName: "Bank Name",
    accounts_accountNumber: "Account Number",
    accounts_openingBalance: "Opening Balance",
    accounts_createAccount: "Create Account",
    accounts_saveChanges: "Save Changes",
    accounts_loading: "Loading accounts…",
    accounts_none: "No bank accounts yet",
    accounts_cardPendingHint: "Taken on card, not yet in the bank",
    accounts_cashHint: "Cash in the till — created automatically",
    accounts_inactive: "Inactive",
    accounts_totalHoldings: "Total Holdings",

    // Row actions
    accounts_openStatement: "View Statement",
    accounts_edit: "Edit",
    accounts_delete: "Delete",
    accounts_deactivate: "Deactivate",
    accounts_activate: "Activate",
    accounts_confirmDelete: "Delete this bank account? This cannot be undone.",

    // Transfer / settle
    accounts_settleToBank: "Settle to bank",
    accounts_settle: "Settle",
    accounts_toBankAccount: "Into bank account",
    accounts_selectDestination: "Select a bank account",
    accounts_amountRs: "Amount (Rs.)",

    // Statement
    accounts_statement: "Statement",
    accounts_backToAccounts: "Back to Accounts",
    accounts_entryType: "Entry Type",
    accounts_allTypes: "All Types",
    accounts_openingBalanceLabel: "Opening Balance",
    accounts_moneyIn: "Money In",
    accounts_moneyOut: "Money Out",
    accounts_closingBalance: "Closing Balance",
    accounts_date: "Date",
    accounts_type: "Type",
    accounts_reference: "Reference",
    accounts_party: "Party",
    accounts_details: "Details",
    accounts_debit: "In",
    accounts_credit: "Out",
    accounts_balance: "Balance",
    accounts_noEntries: "No transactions in this period",
    accounts_typeFilteredHint: "Running balance is hidden while an entry type filter is applied — it would not match the account's real balance.",
    accounts_exportStatement: "Export CSV",

    // Entry types
    accounts_type_SALE_RECEIPT: "Sale Receipt",
    accounts_type_SALE_REFUND: "Sale Refund",
    accounts_type_PURCHASE_PAYMENT: "Purchase Payment",
    accounts_type_PURCHASE_REFUND: "Purchase Refund",
    accounts_type_RECOVERY: "Recovery",
    accounts_type_PAYMENT: "Payment",
    accounts_type_INSTALLMENT_COLLECTION: "Installment",
    accounts_type_ADJUSTMENT: "Adjustment",
    accounts_type_TRANSFER: "Transfer",
    accounts_type_EXPENSE: "Expense",
    accounts_type_PROFIT_WITHDRAWAL: "Profit Withdrawal",
    accounts_type_CAPITAL_INJECTION: "Capital Added",

    // Messages
    accounts_nameRequiredMsg: "Account label is required",
    accounts_createdMsg: "Bank account created",
    accounts_updatedMsg: "Bank account updated",
    accounts_deletedMsg: "Bank account deleted",
    accounts_transferRecordedMsg: "Transfer recorded",
    accounts_enterValidAmountMsg: "Enter a valid amount",
    accounts_actionFailedMsg: "Action failed",
    accounts_noPermissionMsg: "You do not have permission to view accounts",
  },
  ur: {
    // Page header
    accounts: "بینک و نقد",
    accounts_title: "بینک اور نقد کھاتے",
    accounts_subtitle: "اس برانچ کے بینک اکاؤنٹس، نقد رقم اور کارڈ مشین کا بیلنس",

    // Account list
    accounts_addBankAccount: "بینک اکاؤنٹ شامل کریں",
    accounts_newBankAccount: "نیا بینک اکاؤنٹ",
    accounts_editBankAccount: "بینک اکاؤنٹ میں ترمیم",
    accounts_accountLabel: "اکاؤنٹ کا نام",
    accounts_accountLabelPlaceholder: "مثلاً HBL - مین برانچ",
    accounts_bankName: "بینک کا نام",
    accounts_accountNumber: "اکاؤنٹ نمبر",
    accounts_openingBalance: "ابتدائی بیلنس",
    accounts_createAccount: "اکاؤنٹ بنائیں",
    accounts_saveChanges: "تبدیلیاں محفوظ کریں",
    accounts_loading: "اکاؤنٹس لوڈ ہو رہے ہیں…",
    accounts_none: "ابھی تک کوئی بینک اکاؤنٹ نہیں",
    accounts_cardPendingHint: "کارڈ پر وصول، ابھی بینک میں نہیں",
    accounts_cashHint: "گلے میں موجود نقدی — خودکار طور پر بنایا گیا",
    accounts_inactive: "غیر فعال",
    accounts_totalHoldings: "کل رقم",

    // Row actions
    accounts_openStatement: "اسٹیٹمنٹ دیکھیں",
    accounts_edit: "ترمیم",
    accounts_delete: "حذف کریں",
    accounts_deactivate: "غیر فعال کریں",
    accounts_activate: "فعال کریں",
    accounts_confirmDelete: "کیا یہ بینک اکاؤنٹ حذف کریں؟ یہ واپس نہیں ہو سکتا۔",

    // Transfer / settle
    accounts_settleToBank: "بینک میں منتقل کریں",
    accounts_settle: "منتقل کریں",
    accounts_toBankAccount: "بینک اکاؤنٹ میں",
    accounts_selectDestination: "بینک اکاؤنٹ منتخب کریں",
    accounts_amountRs: "رقم (روپے)",

    // Statement
    accounts_statement: "اسٹیٹمنٹ",
    accounts_backToAccounts: "اکاؤنٹس پر واپس",
    accounts_entryType: "اندراج کی قسم",
    accounts_allTypes: "تمام اقسام",
    accounts_openingBalanceLabel: "ابتدائی بیلنس",
    accounts_moneyIn: "آمدنی",
    accounts_moneyOut: "اخراجات",
    accounts_closingBalance: "اختتامی بیلنس",
    accounts_date: "تاریخ",
    accounts_type: "قسم",
    accounts_reference: "حوالہ",
    accounts_party: "پارٹی",
    accounts_details: "تفصیل",
    accounts_debit: "جمع",
    accounts_credit: "برآمد",
    accounts_balance: "بیلنس",
    accounts_noEntries: "اس مدت میں کوئی لین دین نہیں",
    accounts_typeFilteredHint: "قسم کا فلٹر لگا ہونے پر چلتا بیلنس ظاہر نہیں ہوتا — یہ اکاؤنٹ کے اصل بیلنس سے مطابقت نہیں رکھے گا۔",
    accounts_exportStatement: "CSV ایکسپورٹ",

    // Entry types
    accounts_type_SALE_RECEIPT: "فروخت کی وصولی",
    accounts_type_SALE_REFUND: "فروخت کی واپسی",
    accounts_type_PURCHASE_PAYMENT: "خریداری کی ادائیگی",
    accounts_type_PURCHASE_REFUND: "خریداری کی واپسی",
    accounts_type_RECOVERY: "وصولی",
    accounts_type_PAYMENT: "ادائیگی",
    accounts_type_INSTALLMENT_COLLECTION: "قسط",
    accounts_type_ADJUSTMENT: "ترمیم",
    accounts_type_TRANSFER: "منتقلی",
    accounts_type_EXPENSE: "خرچ",
    accounts_type_PROFIT_WITHDRAWAL: "منافع کی نکاسی",
    accounts_type_CAPITAL_INJECTION: "رقم شامل کی گئی",

    // Messages
    accounts_nameRequiredMsg: "اکاؤنٹ کا نام درکار ہے",
    accounts_createdMsg: "بینک اکاؤنٹ بن گیا",
    accounts_updatedMsg: "بینک اکاؤنٹ اپ ڈیٹ ہو گیا",
    accounts_deletedMsg: "بینک اکاؤنٹ حذف ہو گیا",
    accounts_transferRecordedMsg: "رقم منتقل ہو گئی",
    accounts_enterValidAmountMsg: "درست رقم درج کریں",
    accounts_actionFailedMsg: "کارروائی ناکام ہو گئی",
    accounts_noPermissionMsg: "آپ کو اکاؤنٹس دیکھنے کی اجازت نہیں",
  },
} as const;
