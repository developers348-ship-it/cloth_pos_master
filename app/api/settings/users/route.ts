import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { requirePermission } from "@/lib/authz";
import { normalizeEmail, validateUserInput } from "@/lib/users";

/**
 * GET /api/settings/users
 * Returns all users with their branch assignments.
 */
export async function GET() {
  const gate = await requirePermission("VIEW_USERS");
  if (!gate.ok) return gate.response;

  const users = await prisma.user.findMany({
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    include: {
      branches: {
        include: { branch: { select: { id: true, name: true } } },
      },
    },
  });

  return NextResponse.json({
    // The signed-in user's own row is flagged so the UI can grey out the
    // actions that would lock them out of the app they are standing in.
    currentUserId: gate.userId,
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      isActive: u.isActive,
      createdAt: u.createdAt,
      branches: u.branches.map((ub) => ({ id: ub.branch.id, name: ub.branch.name })),
    })),
  });
}

/**
 * POST /api/settings/users
 * Creates a new user with a hashed password.
 * Body: { name, email, password, role, branchId }
 */
export async function POST(req: NextRequest) {
  const gate = await requirePermission("CREATE_USER");
  if (!gate.ok) return gate.response;

  // Creating a user always sets a role, so this is checked on top of
  // CREATE_USER unconditionally, unlike the edit route below where a role
  // change is one field among several.
  const roleGate = await requirePermission("ASSIGN_ROLES");
  if (!roleGate.ok) return roleGate.response;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const { name, email, password, role, branchId } = body;

  if (!name || !email || !password || !role || !branchId) {
    return NextResponse.json({ error: "All fields are required" }, { status: 400 });
  }

  const invalid = validateUserInput({ name, email, password, role });
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { id: true } });
  if (!branch) return NextResponse.json({ error: "That branch no longer exists" }, { status: 400 });

  const existing = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
  if (existing) {
    return NextResponse.json({ error: "A user with that email already exists" }, { status: 409 });
  }

  const user = await prisma.user.create({
    data: {
      name: String(name).trim(),
      email: normalizeEmail(email),
      passwordHash: await bcrypt.hash(password, 10),
      role,
      isActive: true,
      branches: { create: { branchId } },
    },
    include: { branches: { include: { branch: { select: { id: true, name: true } } } } },
  });

  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      branches: user.branches.map((ub) => ({ id: ub.branch.id, name: ub.branch.name })),
    },
  });
}
