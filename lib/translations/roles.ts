/**
 * Domain translation strings for the Roles & Permissions page.
 * Merged into lib/translations.ts by a separate process — do not import
 * this file's shape into lib/translations.ts by hand.
 */

export const rolesTranslations = {
  en: {
    // Page header
    roles_title: "Roles & Permissions",
    roles_backToSettings: "Back to Settings",
    roles_subtitleEditable: "Toggle permissions per role. Changes take effect immediately after saving.",
    roles_subtitleReadOnly: "Read-only view — only Super Admin can edit permissions.",

    // Action buttons
    roles_resetDefaults: "Reset Defaults",
    roles_discard: "Discard",
    roles_saveChanges: "Save Changes",
    roles_saving: "Saving…",

    // Unsaved changes banner
    roles_unsavedPrefix: "You have unsaved changes. Click",
    roles_unsavedSuffix: "to apply.",

    // View toggle
    roles_permissionMatrix: "Permission Matrix",
    roles_roleCards: "Role Cards",
    roles_loadingPermissions: "Loading permissions…",

    // Matrix view
    roles_permissionCol: "Permission",
    roles_lockedBadge: "locked",
    roles_totalGranted: "Total Granted",

    // Role cards
    roles_perms: "perms",
    roles_access: "access",
    roles_lockedFullAccess: "Locked — always full access",
    roles_showPermissions: "Show permissions",
    roles_hidePermissions: "Hide permissions",

    // Toggle switch tooltips
    roles_toggleLockedTitle: "SUPER_ADMIN permissions cannot be removed",
    roles_toggleGrantTitle: "Click to grant",
    roles_toggleRevokeTitle: "Click to revoke",

    // Info notes
    roles_noteLabel: "Note:",
    roles_noteEditablePart1: "Toggles take effect after clicking",
    roles_noteEditablePart2: ". SUPER_ADMIN permissions are always locked and cannot be removed. Changes here affect what each role can see and do across the entire application.",
    roles_readOnlyLabel: "Read-only:",
    roles_readOnlyNote: "Only Super Admin can modify role permissions. Contact your Super Admin to request changes.",

    // Toasts / confirm
    roles_failedLoad: "Failed to load permissions",
    roles_savedSuccess: "✅ Permissions saved!",
    roles_failedSave: "Failed to save permissions",
    roles_confirmReset: "Reset all permissions to system defaults? This cannot be undone.",
    roles_resetSuccess: "Permissions reset to defaults",

    // Role display labels
    roles_role_superAdmin: "Super Admin",
    roles_role_admin: "Admin",
    roles_role_manager: "Manager",
    roles_role_cashier: "Cashier",
    roles_role_accountant: "Accountant",

    // Role descriptions
    roles_desc_superAdmin: "Full system access. Reserved for system owners. All permissions are locked.",
    roles_desc_admin: "Branch-level administrator. Can manage users, settings, items, sales, and purchases.",
    roles_desc_manager: "Oversees daily operations. Can create sales & GRNs, manage stock and parties.",
    roles_desc_cashier: "Point-of-sale operator. Can create invoices and process returns.",
    roles_desc_accountant: "Finance specialist. Can manage ledger, payments, and financial reports.",

    // Permission group labels
    roles_group_userManagement: "User Management",
    roles_group_itemsCatalog: "Items & Catalog",
    roles_group_parties: "Parties",
    roles_group_sales: "Sales",
    roles_group_purchasesGrn: "Purchases / GRN",
    roles_group_inventory: "Inventory",
    roles_group_ledgerAccounts: "Ledger & Accounts",
    roles_group_reports: "Reports",

    // Permission labels — User Management
    roles_perm_viewUsers: "View Users",
    roles_perm_createUser: "Create User",
    roles_perm_editUser: "Edit User",
    roles_perm_deleteUser: "Delete User",
    roles_perm_assignRoles: "Assign Roles",
    roles_perm_impersonateUser: "Sign In As Another User",

    // Permission labels — Branches

    // Permission labels — Items & Catalog
    roles_perm_viewItems: "View Items",
    roles_perm_addItem: "Add Item",
    roles_perm_editItem: "Edit Item",
    roles_perm_deleteItem: "Delete Item",
    roles_perm_viewPurchasePrice: "View Purchase Price",
    roles_perm_editSalePrice: "Edit Sale Price",
    roles_perm_printBarcode: "Print Barcode",

    // Permission labels — Parties
    roles_perm_viewParties: "View Parties",
    roles_perm_addParty: "Add Party",
    roles_perm_editParty: "Edit Party",
    roles_perm_deleteParty: "Delete Party",
    roles_perm_setCreditLimit: "Set Credit Limit",
    roles_perm_viewPartyLedger: "View Party Ledger",

    // Permission labels — Sales
    roles_perm_createInvoice: "Create Invoice",
    roles_perm_deleteInvoice: "Delete Invoice",
    roles_perm_applyItemDiscount: "Apply Item Discount",
    roles_perm_applyPackageDiscount: "Apply Package Discount",
    roles_perm_overrideSalePrice: "Override Sale Price",
    roles_perm_processSaleReturn: "Process Sale Return",
    roles_perm_holdInvoice: "Hold Invoice",
    roles_perm_printReceipt: "Print Receipt",

    // Phase 7/8 additions
    roles_perm_voidInvoice: "Void / restore invoice",
    roles_perm_applyStoreCredit: "Apply store credit at checkout",
    roles_perm_markInvoicePaid: "Mark invoice paid (record payment)",
    roles_perm_markInvoiceUnpaid: "Mark invoice unpaid (reverse payment)",
    roles_perm_changeInvoiceCustomer: "Change an invoice’s customer",
    roles_perm_collectInstallment: "Collect / pay an installment",
    roles_group_bankAccounts: "Bank & Cash Accounts",
    roles_perm_viewAccounts: "View bank & cash accounts",
    roles_perm_viewAccountLedger: "View a bank account statement",
    roles_perm_createAccount: "Add a bank account",
    roles_perm_editAccount: "Edit / deactivate a bank account",
    roles_perm_deleteAccount: "Delete a bank account",
    roles_perm_transferFunds: "Settle card / cash into the bank",

    // Cost management
    roles_group_costManagement: "Cost Management",
    roles_perm_viewExpenses: "View costs & salaries",
    roles_perm_createExpense: "Record a cost",
    roles_perm_editExpense: "Edit a cost",
    roles_perm_deleteExpense: "Delete a cost",
    roles_perm_withdrawProfit: "Withdraw profit / add capital",
    roles_perm_manageExpenseCategories: "Add / edit cost categories",

    // Permission labels — Purchases / GRN
    roles_perm_createGrn: "Create GRN",
    roles_perm_editGrn: "Edit GRN",
    roles_perm_deleteGrn: "Delete GRN",
    roles_perm_printGrn: "Print GRN",

    // Permission labels — Inventory
    roles_perm_viewStock: "View Stock",
    roles_perm_adjustStock: "Adjust Stock",

    // Permission labels — Ledger & Accounts
    roles_perm_viewDaybook: "View Day Book",
    roles_perm_recordPayment: "Record Payment",
    roles_perm_recordRecovery: "Record Recovery",
    roles_perm_viewOutstanding: "View Outstanding",

    // Permission labels — Reports
    roles_perm_viewSalesReport: "View Sales Report",
    roles_perm_viewCashReport: "View Cash Report",
    roles_perm_viewPurchaseReport: "View Purchase Report",
    roles_perm_exportReport: "Export Report",

    // Permission labels — Settings
    roles_perm_editStoreSettings: "Edit Store Settings",
    roles_perm_databaseBackup: "Database Backup",
    roles_perm_databaseRestore: "Database Restore",
    roles_perm_clearTestData: "Clear Test Data",
    roles_perm_systemConfig: "System Configuration",
  },

  ur: {
    // Page header
    roles_title: "کردار اور اجازتیں",
    roles_backToSettings: "ترتیبات پر واپس جائیں",
    roles_subtitleEditable: "ہر کردار کے لیے اجازتیں تبدیل کریں۔ محفوظ کرنے کے فوراً بعد تبدیلیاں لاگو ہو جائیں گی۔",
    roles_subtitleReadOnly: "صرف دیکھنے کا منظر — صرف سپر ایڈمن اجازتوں میں ترمیم کر سکتا ہے۔",

    // Action buttons
    roles_resetDefaults: "ڈیفالٹ پر ری سیٹ کریں",
    roles_discard: "رد کریں",
    roles_saveChanges: "تبدیلیاں محفوظ کریں",
    roles_saving: "محفوظ ہو رہا ہے…",

    // Unsaved changes banner
    roles_unsavedPrefix: "آپ کی غیر محفوظ شدہ تبدیلیاں ہیں۔ کلک کریں",
    roles_unsavedSuffix: "لاگو کرنے کے لیے۔",

    // View toggle
    roles_permissionMatrix: "اجازتوں کا میٹرکس",
    roles_roleCards: "کردار کارڈز",
    roles_loadingPermissions: "اجازتیں لوڈ ہو رہی ہیں…",

    // Matrix view
    roles_permissionCol: "اجازت",
    roles_lockedBadge: "مقفل",
    roles_totalGranted: "کل دی گئی",

    // Role cards
    roles_perms: "اجازتیں",
    roles_access: "رسائی",
    roles_lockedFullAccess: "مقفل — ہمیشہ مکمل رسائی",
    roles_showPermissions: "اجازتیں دکھائیں",
    roles_hidePermissions: "اجازتیں چھپائیں",

    // Toggle switch tooltips
    roles_toggleLockedTitle: "SUPER_ADMIN کی اجازتیں ہٹائی نہیں جا سکتیں",
    roles_toggleGrantTitle: "دینے کے لیے کلک کریں",
    roles_toggleRevokeTitle: "منسوخ کرنے کے لیے کلک کریں",

    // Info notes
    roles_noteLabel: "نوٹ:",
    roles_noteEditablePart1: "ٹوگلز کلک کرنے کے بعد لاگو ہوں گے",
    roles_noteEditablePart2: "۔ SUPER_ADMIN کی اجازتیں ہمیشہ مقفل رہتی ہیں اور انہیں ہٹایا نہیں جا سکتا۔ یہاں کی تبدیلیاں پوری ایپلیکیشن میں ہر کردار کے دیکھنے اور کرنے کی صلاحیت پر اثر انداز ہوتی ہیں۔",
    roles_readOnlyLabel: "صرف دیکھنے کے لیے:",
    roles_readOnlyNote: "صرف سپر ایڈمن کردار کی اجازتوں میں تبدیلی کر سکتا ہے۔ تبدیلی کی درخواست کے لیے اپنے سپر ایڈمن سے رابطہ کریں۔",

    // Toasts / confirm
    roles_failedLoad: "اجازتیں لوڈ کرنے میں ناکامی",
    roles_savedSuccess: "✅ اجازتیں محفوظ ہو گئیں!",
    roles_failedSave: "اجازتیں محفوظ کرنے میں ناکامی",
    roles_confirmReset: "تمام اجازتیں سسٹم کے ڈیفالٹ پر ری سیٹ کریں؟ یہ واپس نہیں ہو سکتا۔",
    roles_resetSuccess: "اجازتیں ڈیفالٹ پر ری سیٹ ہو گئیں",

    // Role display labels
    roles_role_superAdmin: "سپر ایڈمن",
    roles_role_admin: "منتظم",
    roles_role_manager: "منیجر",
    roles_role_cashier: "کیشیئر",
    roles_role_accountant: "اکاؤنٹنٹ",

    // Role descriptions
    roles_desc_superAdmin: "مکمل سسٹم رسائی۔ سسٹم کے مالکان کے لیے مخصوص۔ تمام اجازتیں مقفل ہیں۔",
    roles_desc_admin: "شاخ کی سطح کا منتظم۔ صارفین، ترتیبات، اشیاء، فروخت اور خریداری کا انتظام کر سکتا ہے۔",
    roles_desc_manager: "روزمرہ کے امور کی نگرانی کرتا ہے۔ فروخت اور جی آر این بنا سکتا ہے، اسٹاک اور فریقین کا انتظام کر سکتا ہے۔",
    roles_desc_cashier: "پوائنٹ آف سیل آپریٹر۔ انوائس بنا سکتا ہے اور واپسی کی کارروائی کر سکتا ہے۔",
    roles_desc_accountant: "مالیاتی ماہر۔ کھاتہ، ادائیگیاں اور مالیاتی رپورٹس کا انتظام کر سکتا ہے۔",

    // Permission group labels
    roles_group_userManagement: "صارف کا انتظام",
    roles_group_itemsCatalog: "اشیاء اور کیٹلاگ",
    roles_group_parties: "فریقین",
    roles_group_sales: "فروخت",
    roles_group_purchasesGrn: "خریداری / جی آر این",
    roles_group_inventory: "انوینٹری",
    roles_group_ledgerAccounts: "کھاتہ اور حسابات",
    roles_group_reports: "رپورٹس",

    // Permission labels — User Management
    roles_perm_viewUsers: "صارفین دیکھیں",
    roles_perm_createUser: "صارف بنائیں",
    roles_perm_editUser: "صارف میں ترمیم کریں",
    roles_perm_deleteUser: "صارف حذف کریں",
    roles_perm_assignRoles: "کردار تفویض کریں",
    roles_perm_impersonateUser: "دوسرے صارف کے طور پر لاگ اِن کریں",

    // Permission labels — Branches

    // Permission labels — Items & Catalog
    roles_perm_viewItems: "اشیاء دیکھیں",
    roles_perm_addItem: "شے شامل کریں",
    roles_perm_editItem: "شے میں ترمیم کریں",
    roles_perm_deleteItem: "شے حذف کریں",
    roles_perm_viewPurchasePrice: "خرید قیمت دیکھیں",
    roles_perm_editSalePrice: "فروخت قیمت میں ترمیم کریں",
    roles_perm_printBarcode: "بارکوڈ پرنٹ کریں",

    // Permission labels — Parties
    roles_perm_viewParties: "فریقین دیکھیں",
    roles_perm_addParty: "فریق شامل کریں",
    roles_perm_editParty: "فریق میں ترمیم کریں",
    roles_perm_deleteParty: "فریق حذف کریں",
    roles_perm_setCreditLimit: "کریڈٹ لمٹ مقرر کریں",
    roles_perm_viewPartyLedger: "فریق کھاتہ دیکھیں",

    // Permission labels — Sales
    roles_perm_createInvoice: "انوائس بنائیں",
    roles_perm_deleteInvoice: "انوائس حذف کریں",
    roles_perm_applyItemDiscount: "شے پر رعایت دیں",
    roles_perm_applyPackageDiscount: "پیکج پر رعایت دیں",
    roles_perm_overrideSalePrice: "فروخت قیمت اوور رائیڈ کریں",
    roles_perm_processSaleReturn: "فروخت واپسی کارروائی کریں",
    roles_perm_holdInvoice: "انوائس ہولڈ کریں",
    roles_perm_printReceipt: "رسید پرنٹ کریں",

    // Phase 7/8 additions
    roles_perm_voidInvoice: "رسید منسوخ / بحال کرنا",
    roles_perm_applyStoreCredit: "اسٹور کریڈٹ استعمال کرنا",
    roles_perm_markInvoicePaid: "رسید ادا شدہ کرنا (ادایگی درج)",
    roles_perm_markInvoiceUnpaid: "ادایگی واپس کرنا",
    roles_perm_changeInvoiceCustomer: "رسید کا گاہک تبدیل کرنا",
    roles_perm_collectInstallment: "قسط وصول / ادا کرنا",
    roles_group_bankAccounts: "بینک اور نقد کھاتے",
    roles_perm_viewAccounts: "بینک و نقد اکاؤنٹس دیکھیں",
    roles_perm_viewAccountLedger: "بینک اکاؤنٹ کی اسٹیٹمنٹ دیکھیں",
    roles_perm_createAccount: "بینک اکاؤنٹ شامل کریں",
    roles_perm_editAccount: "بینک اکاؤنٹ میں ترمیم / غیر فعال کریں",
    roles_perm_deleteAccount: "بینک اکاؤنٹ حذف کریں",
    roles_perm_transferFunds: "کارڈ / نقد بینک میں منتقل کریں",

    // Cost management
    roles_group_costManagement: "اخراجات کا انتظام",
    roles_perm_viewExpenses: "اخراجات و تنخواہیں دیکھیں",
    roles_perm_createExpense: "خرچ درج کریں",
    roles_perm_editExpense: "خرچ میں ترمیم کریں",
    roles_perm_deleteExpense: "خرچ حذف کریں",
    roles_perm_withdrawProfit: "منافع نکالیں / سرمایہ شامل کریں",
    roles_perm_manageExpenseCategories: "اخراجات کے زمرے بنائیں / بدلیں",

    // Permission labels — Purchases / GRN
    roles_perm_createGrn: "جی آر این بنائیں",
    roles_perm_editGrn: "جی آر این میں ترمیم کریں",
    roles_perm_deleteGrn: "جی آر این حذف کریں",
    roles_perm_printGrn: "جی آر این پرنٹ کریں",

    // Permission labels — Inventory
    roles_perm_viewStock: "اسٹاک دیکھیں",
    roles_perm_adjustStock: "اسٹاک ایڈجسٹ کریں",

    // Permission labels — Ledger & Accounts
    roles_perm_viewDaybook: "ڈے بک دیکھیں",
    roles_perm_recordPayment: "ادائیگی درج کریں",
    roles_perm_recordRecovery: "وصولی درج کریں",
    roles_perm_viewOutstanding: "بقایا جات دیکھیں",

    // Permission labels — Reports
    roles_perm_viewSalesReport: "فروخت رپورٹ دیکھیں",
    roles_perm_viewCashReport: "نقد رپورٹ دیکھیں",
    roles_perm_viewPurchaseReport: "خریداری رپورٹ دیکھیں",
    roles_perm_exportReport: "رپورٹ برآمد کریں",

    // Permission labels — Settings
    roles_perm_editStoreSettings: "اسٹور ترتیبات میں ترمیم کریں",
    roles_perm_databaseBackup: "ڈیٹا بیس بیک اپ",
    roles_perm_databaseRestore: "ڈیٹا بیس بحال کریں",
    roles_perm_clearTestData: "ٹیسٹ ڈیٹا صاف کریں",
    roles_perm_systemConfig: "سسٹم کنفیگریشن",
  },
} as const;
