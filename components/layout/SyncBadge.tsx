"use client";

import { useState, useEffect, useCallback, useSyncExternalStore } from "react";
import { useSession } from "next-auth/react";
import { syncEngine } from "@/lib/sync-engine";
import type { SyncStatus } from "@/lib/sync-engine";
import { RefreshCw } from "lucide-react";

/**
 * Connectivity is read through `useSyncExternalStore` rather than held in
 * state, because it is a browser value the server cannot see and the hook is
 * the one API that lets SSR and the client disagree *deliberately*, via an
 * explicit server snapshot.
 *
 * This used to be `useState(typeof navigator !== "undefined" ? navigator.onLine : true)`,
 * written for a Node that had no `navigator` at all. Node 21+ defines a global
 * one — without `onLine` — so on the server that expression took the *first*
 * branch and evaluated to `undefined`: the badge server-rendered "Offline" with
 * its button disabled while the browser rendered "All synced" enabled, and React
 * threw a hydration mismatch on every dashboard load.
 *
 * Defined at module scope so the subscription is not torn down and rebuilt on
 * every render.
 */
function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}
const getOnline = () => navigator.onLine;
/** What SSR renders, and so what the client's first paint must also render. */
const getOnlineOnServer = () => true;

/**
 * SyncBadge — live sync status indicator.
 * Shows pending count + online/offline dot.
 * Polls every 30s when online. Click to force sync.
 */
export default function SyncBadge({ collapsed }: { collapsed: boolean }) {
  const { data: session } = useSession();
  const branchId = (session?.user as any)?.branchId ?? "";

  const [status, setStatus] = useState<SyncStatus>({ invoices: 0, grns: 0, ledger: 0, total: 0 });
  const online = useSyncExternalStore(subscribeOnline, getOnline, getOnlineOnServer);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    if (!branchId) return;
    const s = await syncEngine.getStatus();
    setStatus(s);
  }, [branchId]);

  useEffect(() => {
    if (!branchId) return;

    syncEngine.init(branchId, {
      onStatusChange: setStatus,
      onSyncComplete: () => setSyncing(false),
    });

    refresh();

    // Coming back online, re-count what is pending straight away rather than
    // leaving a stale figure on screen until the next poll.
    const onBackOnline = () => refresh();
    window.addEventListener("online", onBackOnline);

    // Poll every 30s when online
    const interval = setInterval(() => {
      if (navigator.onLine) refresh();
    }, 30_000);

    return () => {
      window.removeEventListener("online", onBackOnline);
      clearInterval(interval);
    };
  }, [branchId, refresh]);

  const handleSync = async () => {
    if (syncing || !online) return;
    setSyncing(true);
    await syncEngine.sync();
    await refresh();
    setSyncing(false);
  };

  const dot = online
    ? "bg-green-400"
    : "bg-red-500 animate-pulse";

  if (collapsed) {
    return (
      <button
        onClick={handleSync}
        title={online ? (status.total > 0 ? `${status.total} pending` : "All synced") : "Offline"}
        className="flex justify-center py-1"
      >
        <span className={`w-2.5 h-2.5 rounded-full ${dot}`} />
      </button>
    );
  }

  return (
    <button
      onClick={handleSync}
      disabled={!online || syncing}
      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs hover:bg-gray-700 transition-colors group"
    >
      {/* Online / offline dot */}
      <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />

      <span className="flex-1 text-left text-gray-400 group-hover:text-white">
        {!online
          ? "Offline"
          : syncing
          ? "Syncing…"
          : status.total > 0
          ? `${status.total} pending`
          : "All synced"}
      </span>

      {online && status.total > 0 && !syncing && (
        <RefreshCw className="w-3 h-3 text-yellow-400 shrink-0" />
      )}
      {syncing && (
        <RefreshCw className="w-3 h-3 text-teal-400 animate-spin shrink-0" />
      )}
    </button>
  );
}
