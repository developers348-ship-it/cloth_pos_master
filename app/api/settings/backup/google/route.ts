import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authz";
import { disconnect, getStatus, saveClient } from "@/lib/google-drive";

export const dynamic = "force-dynamic";

/**
 * GET    — connection status. Never returns the secret or the token.
 * PUT    — { clientId, clientSecret? } save the OAuth client. The secret is only
 *          replaced when one is sent, since the form never has it to send back.
 * DELETE — disconnect; `?forget=1` also forgets the Client ID and Secret.
 *
 * Changing credentials needs SYSTEM_CONFIG (Super Admin by default).
 */
export async function GET() {
  const gate = await requirePermission("DATABASE_BACKUP");
  if (!gate.ok) return gate.response;
  return NextResponse.json(await getStatus());
}

export async function PUT(req: NextRequest) {
  const gate = await requirePermission("SYSTEM_CONFIG");
  if (!gate.ok) return gate.response;

  const body = await req.json().catch(() => null);
  const clientId = typeof body?.clientId === "string" ? body.clientId.trim() : "";
  const clientSecret = typeof body?.clientSecret === "string" ? body.clientSecret.trim() : "";
  if (!clientId) return NextResponse.json({ error: "Enter the Client ID." }, { status: 400 });

  const status = await getStatus();
  if (!clientSecret && !status.hasSecret) {
    return NextResponse.json({ error: "Enter the Client Secret." }, { status: 400 });
  }

  await saveClient(clientId, clientSecret || undefined);
  return NextResponse.json(await getStatus());
}

export async function DELETE(req: NextRequest) {
  const gate = await requirePermission("SYSTEM_CONFIG");
  if (!gate.ok) return gate.response;
  await disconnect(new URL(req.url).searchParams.get("forget") === "1");
  return NextResponse.json(await getStatus());
}
