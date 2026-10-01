import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authz";
import { getUnitConfig, saveUnitConfig } from "@/lib/unit-settings";

/**
 * The gaz/metre lengths.
 *
 * GET is open to any signed-in user because every stock display converts
 * through these; gating the read would blank the sales screen for a cashier.
 * The write carries EDIT_STORE_SETTINGS like the rest of the settings page.
 */

export async function GET() {
  const cfg = await getUnitConfig();
  return NextResponse.json({
    ...cfg,
    // Derived, never stored — see lib/units.ts on why the two factors are not
    // editable in their own right.
    gazToMtr: cfg.inchesPerGaz / cfg.inchesPerMtr,
    mtrToGaz: cfg.inchesPerMtr / cfg.inchesPerGaz,
  });
}

export async function PUT(req: NextRequest) {
  const gate = await requirePermission("EDIT_STORE_SETTINGS");
  if (!gate.ok) return gate.response;

  const body = await req.json();
  const inchesPerGaz = Number(body.inchesPerGaz);
  const inchesPerMtr = Number(body.inchesPerMtr);

  // A zero or negative length makes every conversion a division by zero or a
  // sign flip, and it would be written to stock quantities before anyone
  // noticed. Refuse rather than clamp.
  for (const [label, n] of [
    ["Inches per gaz", inchesPerGaz],
    ["Inches per metre", inchesPerMtr],
  ] as const) {
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json({ error: `${label} must be greater than 0` }, { status: 400 });
    }
  }

  await saveUnitConfig({ inchesPerGaz, inchesPerMtr });
  return NextResponse.json({
    inchesPerGaz,
    inchesPerMtr,
    gazToMtr: inchesPerGaz / inchesPerMtr,
    mtrToGaz: inchesPerMtr / inchesPerGaz,
  });
}
