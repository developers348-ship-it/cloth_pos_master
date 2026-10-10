import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authz";
import { readDriveBackup, readLocalBackup } from "@/lib/backup-jobs";
import { FORMAT_MIME, formatOfFileName } from "@/lib/backup-schedule";

export const dynamic = "force-dynamic";

/** GET ?source=local&name=… | ?source=drive&id=… — streams a stored backup to the browser. */
export async function GET(req: NextRequest) {
  const gate = await requirePermission("DATABASE_BACKUP");
  if (!gate.ok) return gate.response;

  const p = req.nextUrl.searchParams;
  try {
    let name: string;
    let bytes: Buffer;
    if (p.get("source") === "drive") {
      ({ name, bytes } = await readDriveBackup(p.get("id") ?? ""));
    } else {
      name = p.get("name") ?? "";
      bytes = await readLocalBackup(name);
    }
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": FORMAT_MIME[formatOfFileName(name) ?? "json"],
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
