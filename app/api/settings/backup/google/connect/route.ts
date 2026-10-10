import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requirePermission } from "@/lib/authz";
import { CALLBACK_PATH, buildAuthUrl, loadSecrets, publicOrigin } from "@/lib/google-drive";

export const dynamic = "force-dynamic";

/**
 * GET — starts Google's consent screen. A random `state` is set in a short-lived
 * cookie and echoed back by Google; the callback refuses anything that doesn't
 * match, so a link someone else crafted can't attach *their* Drive to this shop.
 *
 * The redirect address Google returns to must be registered, exactly, in the
 * OAuth client — the Settings screen shows the one to copy.
 */
export async function GET(req: NextRequest) {
  const gate = await requirePermission("SYSTEM_CONFIG");
  if (!gate.ok) return gate.response;

  const secrets = await loadSecrets();
  if (!secrets.clientId || !secrets.clientSecret) {
    return NextResponse.redirect(new URL("/dashboard/settings?tab=backup&drive=noclient", publicOrigin(req)));
  }

  const state = randomBytes(16).toString("hex");
  const redirectUri = `${publicOrigin(req)}${CALLBACK_PATH}`;
  const res = NextResponse.redirect(buildAuthUrl(secrets.clientId, redirectUri, state));
  res.cookies.set("backup_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/api/settings/backup/google",
  });
  return res;
}
