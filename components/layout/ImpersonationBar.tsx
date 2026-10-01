"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { UserCog, Undo2, RefreshCw } from "lucide-react";
import toast from "react-hot-toast";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * The strip across the top of every dashboard page while an admin is signed in
 * as somebody else.
 *
 * It is deliberately loud and unmissable: the whole point of impersonating a
 * cashier is that the app looks like the cashier's, which is exactly the state
 * in which an admin can forget whose name the next sale will carry. Renders
 * nothing at all on an ordinary session, so it costs a normal login nothing.
 */
export default function ImpersonationBar() {
  const { data: session, update } = useSession();
  const { t, isUrdu } = useI18n();
  const [leaving, setLeaving] = useState(false);

  const user = session?.user as
    | { name?: string | null; role?: string; actor?: { name?: string | null; role?: string } | null }
    | undefined;
  const actor = user?.actor;

  if (!actor) return null;

  async function backToAdmin() {
    setLeaving(true);
    try {
      const res = await fetch("/api/impersonate", { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(String(data?.error ?? t("impersonating_switchFailed")));
        setLeaving(false);
        return;
      }
      // The token swap itself happens in the JWT callback. The reload after it
      // is deliberate and not a `router.push`: every server component, cached
      // fetch and provider on the page was built for the user they were.
      await update({ stopImpersonating: true });
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/dashboard/settings";
    } catch {
      toast.error(t("impersonating_switchFailed"));
      setLeaving(false);
    }
  }

  const role = (user?.role ?? "").replace("_", " ");
  const actorRole = (actor.role ?? "").replace("_", " ");

  return (
    <div className="bg-amber-500 text-amber-950 px-4 py-2 flex items-center gap-3 shadow-sm shrink-0">
      <UserCog className="w-4 h-4 shrink-0" />

      <div className={cn("flex-1 min-w-0 text-sm", isUrdu && "urdu-text")}>
        <span className="font-semibold">
          {t("impersonating_viewingAs")} {user?.name}
          {role && <span className="font-normal"> ({role})</span>}
        </span>
        <span className="opacity-80">
          {" — "}
          {t("impersonating_signedInAs")} {actor.name}
          {actorRole && ` (${actorRole})`}. {t("impersonating_hint")}
        </span>
      </div>

      <button
        onClick={backToAdmin}
        disabled={leaving}
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-950 text-amber-50 text-xs font-medium",
          "hover:bg-amber-900 transition-colors disabled:opacity-60 shrink-0",
          isUrdu && "urdu-text"
        )}
      >
        {leaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Undo2 className="w-3.5 h-3.5" />}
        {leaving ? t("impersonating_switching") : t("impersonating_backToAdmin")}
      </button>
    </div>
  );
}
