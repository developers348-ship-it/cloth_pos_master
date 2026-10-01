"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { DEFAULT_PERMISSIONS, isAllowed } from "@/lib/permissions";

/**
 * Client-side half of the permission system — the same matrix the server
 * enforces with, so a button is never offered for something the route behind it
 * will refuse. It is a UI convenience, not the security boundary:
 * `requirePermission()` in lib/authz.ts is what actually protects the data.
 *
 * The matrix is fetched once per page load and shared through context rather
 * than refetched per component. `isAllowed` is imported from lib/permissions.ts
 * so both halves resolve a key identically — including the SUPER_ADMIN override
 * and the fail-closed treatment of an unknown key.
 */

type Matrix = Record<string, string[]>;

type PermissionsValue = {
  /** May the signed-in user do this? */
  can: (permission: string) => boolean;
  role: string | undefined;
  /** False until the stored override has been fetched. */
  loaded: boolean;
};

const PermissionsContext = createContext<PermissionsValue | null>(null);

export function PermissionsProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const [matrix, setMatrix] = useState<Matrix>(DEFAULT_PERMISSIONS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/settings/permissions")
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        // Per-key layering, matching lib/authz.ts: an override saved before a
        // permission existed must not deny it to everyone.
        if (d?.permissions) setMatrix({ ...DEFAULT_PERMISSIONS, ...d.permissions });
        setLoaded(true);
      })
      // Falling back to the compiled defaults keeps the UI usable if the fetch
      // fails; the server still has the final say on every action.
      .catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, []);

  const value = useMemo<PermissionsValue>(
    () => ({ can: (permission: string) => isAllowed(matrix, role, permission), role, loaded }),
    [matrix, role, loaded]
  );

  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}

export function usePermissions(): PermissionsValue {
  const ctx = useContext(PermissionsContext);
  // Outside the provider (a stray render, a test) nothing is permitted rather
  // than everything — the same fail-closed stance as the server guard.
  if (!ctx) return { can: () => false, role: undefined, loaded: false };
  return ctx;
}
