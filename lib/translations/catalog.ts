/**
 * Domain translation strings for the Catalog page (Categories / Brands / Groups).
 * Merged into lib/translations.ts by a separate process — do not import
 * this file's shape into lib/translations.ts by hand.
 */

export const catalogTranslations = {
  en: {
    catalog_subtitle: "Manage Categories, Brands and Groups used for classifying items.",

    catalog_categories: "Categories",
    catalog_brands: "Brands",
    catalog_groups: "Groups",

    catalog_add: "Add",
    catalog_newCategoryPlaceholder: "New Category name...",
    catalog_newBrandPlaceholder: "New Brand name...",
    catalog_newGroupPlaceholder: "New Group name...",

    catalog_noCategoriesYet: "No categories yet — add one above.",
    catalog_noBrandsYet: "No brands yet — add one above.",
    catalog_noGroupsYet: "No groups yet — add one above.",

    catalog_rename: "Rename",
    catalog_delete: "Delete",

    catalog_categoryAdded: "Category added!",
    catalog_brandAdded: "Brand added!",
    catalog_groupAdded: "Group added!",
    catalog_failedToAdd: "Failed to add",

    catalog_renamed: "Renamed!",
    catalog_failedToRename: "Failed to rename",

    catalog_deleted: "Deleted",
    catalog_failedToDelete: "Failed to delete",

    catalog_confirmDelete: "Delete this? Items using it will not be affected.",

    catalog_pressEnterHint: "Press Enter to quickly add",
  },

  ur: {
    catalog_subtitle: "زمرہ جات، برانڈز اور گروپس کا انتظام کریں جو اشیاء کی درجہ بندی کے لیے استعمال ہوتے ہیں۔",

    catalog_categories: "زمرہ جات",
    catalog_brands: "برانڈز",
    catalog_groups: "گروپس",

    catalog_add: "شامل کریں",
    catalog_newCategoryPlaceholder: "نیا زمرہ نام...",
    catalog_newBrandPlaceholder: "نیا برانڈ نام...",
    catalog_newGroupPlaceholder: "نیا گروپ نام...",

    catalog_noCategoriesYet: "ابھی تک کوئی زمرہ موجود نہیں — اوپر ایک شامل کریں۔",
    catalog_noBrandsYet: "ابھی تک کوئی برانڈ موجود نہیں — اوپر ایک شامل کریں۔",
    catalog_noGroupsYet: "ابھی تک کوئی گروپ موجود نہیں — اوپر ایک شامل کریں۔",

    catalog_rename: "نام تبدیل کریں",
    catalog_delete: "حذف کریں",

    catalog_categoryAdded: "زمرہ شامل ہو گیا!",
    catalog_brandAdded: "برانڈ شامل ہو گیا!",
    catalog_groupAdded: "گروپ شامل ہو گیا!",
    catalog_failedToAdd: "شامل کرنے میں ناکامی ہوئی",

    catalog_renamed: "نام تبدیل ہو گیا!",
    catalog_failedToRename: "نام تبدیل کرنے میں ناکامی ہوئی",

    catalog_deleted: "حذف ہو گیا",
    catalog_failedToDelete: "حذف کرنے میں ناکامی ہوئی",

    catalog_confirmDelete: "کیا یہ حذف کریں؟ اس سے منسلک اشیاء متاثر نہیں ہوں گی۔",

    catalog_pressEnterHint: "فوری اضافے کے لیے Enter دبائیں",
  },
} as const;
