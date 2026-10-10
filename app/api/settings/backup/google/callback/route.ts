import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authz";
import { CALLBACK_PATH, completeConnection, publicOrigin } from "@/lib/google-drive";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "backup_oauth_state";

function back(req: NextRequest, drive: string, message?: string) {
  const url = new URL("/dashboard/settings", publicOrigin(req));
  url.searchParams.set("tab", "backup");
  url.searchParams.set("drive", drive);
  if (message) url.searchParams.set("msg", message.slice(0, 300));
  const res = NextResponse.redirect(url);
  res.cookies.delete({ name: STATE_COOKIE, path: "/api/settings/backup/google" });
  return res;
}

/** GET — Google lands here after the consent screen, with `code` and `state`. */
export async function GET(req: NextRequest) {
  const gate = await requirePermission("SYSTEM_CONFIG");
  if (!gate.ok) return gate.response;

  const params = req.nextUrl.searchParams;
  if (params.get("error")) return back(req, "error", `Google said: ${params.get("error")}`);

  const expected = req.cookies.get(STATE_COOKIE)?.value;
  if (!expected || expected !== params.get("state")) {
    return back(req, "error", "The sign-in could not be verified. Start Connect again from Settings.");
  }
  const code = params.get("code");
  if (!code) return back(req, "error", "Google did not send a sign-in code.");

  try {
    await completeConnection(code, `${publicOrigin(req)}${CALLBACK_PATH}`);
    return back(req, "connected");
  } catch (error) {
    return back(req, "error", error instanceof Error ? error.message : String(error));
  }
}
