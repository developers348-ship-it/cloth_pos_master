"use client";

import { useEffect, useState } from "react";
import { DEFAULT_UNIT_CONFIG, type UnitConfig } from "@/lib/units";

/**
 * The gaz/metre lengths, for screens that convert while you type — the GRN's
 * live preview and the sales screen's available-quantity line.
 *
 * One fetch per page load, shared between every caller through a module-level
 * promise: the sales screen renders this alongside each of a few dozen search
 * results, and a request apiece would be absurd. The values change about once
 * in the life of a shop, so there is nothing to invalidate against.
 *
 * Renders with the 36/40 defaults until the real values land. That is safe
 * because it is the *display* that briefly uses them — every figure that gets
 * stored is converted again on the server, which reads the settings directly.
 */

let inflight: Promise<UnitConfig> | null = null;

function load(): Promise<UnitConfig> {
  if (!inflight) {
    inflight = fetch("/api/settings/units")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("units"))))
      .then((d) => ({
        inchesPerGaz: Number(d.inchesPerGaz) || DEFAULT_UNIT_CONFIG.inchesPerGaz,
        inchesPerMtr: Number(d.inchesPerMtr) || DEFAULT_UNIT_CONFIG.inchesPerMtr,
      }))
      .catch(() => {
        // Let a failed load be retried by the next mount rather than pinning
        // the defaults in place for the life of the tab.
        inflight = null;
        return DEFAULT_UNIT_CONFIG;
      });
  }
  return inflight;
}

/** Call after saving the settings so open tabs pick the new lengths up. */
export function invalidateUnitConfig() {
  inflight = null;
}

export function useUnitConfig(): UnitConfig {
  const [cfg, setCfg] = useState<UnitConfig>(DEFAULT_UNIT_CONFIG);

  useEffect(() => {
    let alive = true;
    load().then((c) => {
      if (alive) setCfg(c);
    });
    return () => {
      alive = false;
    };
  }, []);

  return cfg;
}
