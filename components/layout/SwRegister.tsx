"use client";

import { useEffect } from "react";
import { useStore } from "@/lib/store-context";

/**
 * Registers (or fully tears down) the service worker at /sw.js based on the
 * site-wide "PWA/Offline" toggle in Settings — a DB-backed setting on Branch,
 * not a per-browser preference, so turning it off actually disables the
 * offline/PWA machinery for everyone instead of just hiding a badge.
 *
 * **Never in development.** /sw.js serves `/_next/static/` cache-first, which is
 * right in production (every build hashes its filenames, so a new build is a
 * new URL) but wrong under `next dev`, where chunk URLs are reused as their
 * contents change. The browser then keeps serving yesterday's JavaScript: the
 * symptom is a screen that renders raw translation keys, or a fix that appears
 * not to have taken. Any registration left over from a previous run is torn
 * down and its caches deleted, so a browser that already has one recovers on
 * the next load.
 */
async function unregisterAll() {
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(regs.map((reg) => reg.unregister()));
  // Unregistering stops the worker controlling the page, but its caches
  // outlive it — clear them too, or a later re-register serves the stale
  // bundle straight back.
  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }
}

export default function SwRegister() {
  const { store, loading } = useStore();

  useEffect(() => {
    if (loading || typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production" || store?.pwaOfflineEnabled === false) {
      unregisterAll().catch(() => {
        // Tearing down is best-effort; a failure here must not break the page.
      });
      return;
    }

    navigator.serviceWorker.register("/sw.js").catch(() => {
      // SW registration failure is non-fatal
    });
  }, [store, loading]);

  return null;
}
