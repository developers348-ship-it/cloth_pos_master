import { prisma } from "@/lib/prisma";
import { getEffectivePermissions, invalidatePermissionsCache, requirePermission, PERMISSIONS_SETTING_KEY } from "@/lib/authz";
import { DEFAULT_PERMISSIONS } from "@/lib/permissions";
import { NextRequest, NextResponse } from "next/server";

/**
 * The editable role matrix, stored as JSON in `Setting["role_permissions"]`.
 *
 * The defaults are **not** duplicated here any more — they come from
 * `lib/permissions.ts`, which is also what `lib/authz.ts` enforces with and what
 * the client hook falls back to. Before Phase 8 this file kept its own hand-
 * copied copy, so a permission added in one place silently didn't exist in the
 * other.
 */

/**
 * GET /api/settings/permissions
 * Returns the active permissions map (defaults with any DB override layered on).
 *
 * Deliberately open to any signed-in user: the client needs it to decide which
 * buttons to render, and knowing that voiding an invoice needs MANAGER tells a
 * cashier nothing they can act on — the server still refuses them.
 */
export async function GET() {
  const setting = await prisma.setting.findUnique({ where: { key: PERMISSIONS_SETTING_KEY } });
  const permissions = await getEffectivePermissions();
  return NextResponse.json({ permissions, isDefault: !setting });
}

/**
 * PUT /api/settings/permissions
 * Saves a full permissions map. Body: { permissions: Record<string, string[]> }
 */
export async function PUT(req: NextRequest) {
  const gate = await requirePermission("SYSTEM_CONFIG");
  if (!gate.ok) return gate.response;

  const { permissions } = await req.json();
  if (!permissions || typeof permissions !== "object") {
    return NextResponse.json({ error: "Invalid permissions" }, { status: 400 });
  }

  const safe: Record<string, string[]> = {};
  for (const [key, roles] of Object.entries(permissions as Record<string, string[]>)) {
    // Unknown keys are dropped rather than stored: they can only come from a
    // stale client, and keeping them would make the saved matrix drift from the
    // set of permissions the app actually checks.
    if (!(key in DEFAULT_PERMISSIONS)) continue;
    const arr = Array.isArray(roles) ? roles.filter((r) => typeof r === "string") : [];
    // SUPER_ADMIN must always keep every permission — safety guard so a matrix
    // saved with a mistake can't lock the owner out of their own system.
    if (!arr.includes("SUPER_ADMIN")) arr.push("SUPER_ADMIN");
    safe[key] = arr;
  }

  await prisma.setting.upsert({
    where: { key: PERMISSIONS_SETTING_KEY },
    create: { key: PERMISSIONS_SETTING_KEY, value: JSON.stringify(safe) },
    update: { value: JSON.stringify(safe) },
  });
  invalidatePermissionsCache();

  return NextResponse.json({ ok: true, permissions: { ...DEFAULT_PERMISSIONS, ...safe } });
}

/**
 * DELETE /api/settings/permissions
 * Removes the override so the defaults apply again.
 */
export async function DELETE() {
  const gate = await requirePermission("SYSTEM_CONFIG");
  if (!gate.ok) return gate.response;

  await prisma.setting.deleteMany({ where: { key: PERMISSIONS_SETTING_KEY } });
  invalidatePermissionsCache();

  return NextResponse.json({ ok: true, isDefault: true, permissions: DEFAULT_PERMISSIONS });
}
