-- Site-wide feature toggles, admin-controlled from Settings, stored on Branch
-- so they apply consistently to every device/browser instead of living in
-- per-device localStorage.
ALTER TABLE "Branch" ADD COLUMN "pwaOfflineEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Branch" ADD COLUMN "languageSwitcherEnabled" BOOLEAN NOT NULL DEFAULT true;
