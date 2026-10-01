/**
 * Client-side sync engine for Sidhey Sheikh Cloth Center POS.
 *
 * Finds records with syncStatus=PENDING and pushes them to SYNCED via the API.
 * Auto-triggers on the `online` event. Supports exponential backoff + retry.
 */

export type SyncResult = {
  synced: number;
  failed: number;
  pendingBefore: number;
};

export type SyncStatus = {
  invoices: number;
  grns: number;
  ledger: number;
  total: number;
};

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 2000;

class SyncEngine {
  private branchId: string = "";
  private retryCount = 0;
  private retryTimeout: ReturnType<typeof setTimeout> | null = null;
  private onStatusChange?: (s: SyncStatus) => void;
  private onSyncComplete?: (r: SyncResult) => void;

  init(branchId: string, opts?: {
    onStatusChange?: (s: SyncStatus) => void;
    onSyncComplete?: (r: SyncResult) => void;
  }) {
    this.branchId = branchId;
    this.onStatusChange = opts?.onStatusChange;
    this.onSyncComplete = opts?.onSyncComplete;

    // Auto-sync when browser comes back online
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => {
        this.retryCount = 0;
        this.sync();
      });
    }
  }

  async getStatus(): Promise<SyncStatus> {
    if (!this.branchId) return { invoices: 0, grns: 0, ledger: 0, total: 0 };
    try {
      const res = await fetch(`/api/sync/status?branchId=${this.branchId}`);
      const data = await res.json();
      const status: SyncStatus = {
        invoices: data.invoices ?? 0,
        grns: data.grns ?? 0,
        ledger: data.ledger ?? 0,
        total: data.total ?? 0,
      };
      this.onStatusChange?.(status);
      return status;
    } catch {
      return { invoices: 0, grns: 0, ledger: 0, total: 0 };
    }
  }

  async sync(): Promise<SyncResult> {
    if (!this.branchId || !navigator.onLine) {
      return { synced: 0, failed: 0, pendingBefore: 0 };
    }

    const status = await this.getStatus();
    const pendingBefore = status.total;

    if (pendingBefore === 0) {
      this.onSyncComplete?.({ synced: 0, failed: 0, pendingBefore: 0 });
      return { synced: 0, failed: 0, pendingBefore: 0 };
    }

    try {
      const res = await fetch("/api/sync/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId: this.branchId }),
      });

      if (!res.ok) throw new Error("Sync push failed");

      const data = await res.json();
      const result: SyncResult = {
        synced: data.synced ?? 0,
        failed: 0,
        pendingBefore,
      };
      this.retryCount = 0;
      await this.getStatus(); // refresh badge
      this.onSyncComplete?.(result);
      return result;
    } catch {
      return this._scheduleRetry(pendingBefore);
    }
  }

  private _scheduleRetry(pendingBefore: number): SyncResult {
    if (this.retryCount >= MAX_RETRIES) {
      return { synced: 0, failed: pendingBefore, pendingBefore };
    }
    const delay = Math.min(BASE_DELAY_MS * 2 ** this.retryCount, 30_000);
    this.retryCount++;
    if (this.retryTimeout) clearTimeout(this.retryTimeout);
    this.retryTimeout = setTimeout(() => this.sync(), delay);
    return { synced: 0, failed: 0, pendingBefore };
  }
}

// Singleton
export const syncEngine = new SyncEngine();
