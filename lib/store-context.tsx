"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useSession } from "next-auth/react";

export type StoreSettings = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  website: string | null;
  logoUrl: string | null;
  footerTerms: string | null;
  /** Base px of the thermal slip - see lib/receipt-font.ts. */
  receiptFontSize: number;
  pwaOfflineEnabled: boolean;
  languageSwitcherEnabled: boolean;
};

type StoreContextType = {
  store: StoreSettings | null;
  loading: boolean;
  refresh: () => void;
};

const StoreContext = createContext<StoreContextType>({
  store: null,
  loading: true,
  refresh: () => {},
});

export function StoreProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const branchId = (session?.user as any)?.branchId;
  const [store, setStore] = useState<StoreSettings | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadStore() {
    if (!branchId) return;
    try {
      const res = await fetch(`/api/settings/store?branchId=${branchId}`);
      const data = await res.json();
      if (data.branch) setStore(data.branch);
    } catch {
      // silently fail — use cached
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStore();
  }, [branchId]);

  return (
    <StoreContext.Provider value={{ store, loading, refresh: loadStore }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore() {
  return useContext(StoreContext);
}
