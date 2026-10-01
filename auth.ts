import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { checkImpersonation, loadReturningActor } from "@/lib/impersonation-server";
import type { JWT } from "next-auth/jwt";

const prisma = new PrismaClient();

/**
 * The fields this app hangs off the JWT beyond next-auth's own. `actor` is set
 * only while an admin is signed in as somebody else — see the `jwt` callback.
 */
type Actor = { id: string; name?: string | null; email?: string | null; role?: string };

type AppToken = JWT & {
  id?: string;
  role?: string;
  branchId?: string | null;
  branchName?: string | null;
  actor?: Actor;
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Long-lived session so staff stay logged in on the shop terminal instead
  // of being kicked out after a short idle window or when the browser closes.
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 365 }, // 1 year
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
          include: {
            branches: {
              include: { branch: true },
            },
          },
        });

        if (!user || !user.isActive) return null;

        const valid = await bcrypt.compare(
          credentials.password as string,
          user.passwordHash
        );
        if (!valid) return null;

        // Default to first branch
        const defaultBranch = user.branches[0]?.branch ?? null;

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          branchId: defaultBranch?.id ?? null,
          branchName: defaultBranch?.name ?? null,
        };
      },
    }),
  ],
  callbacks: {
    /**
     * `token.actor` is what makes "login as user" work: while an admin is
     * impersonating someone, the identity fields hold the *target* — so every
     * guard, every sidebar entry and every invoice this token creates belongs
     * to that user, with no special cases anywhere else in the app — and
     * `actor` remembers the real admin so the banner can name them and the way
     * back is one click. Absent on an ordinary session.
     */
    async jwt({ token, user, trigger, session }) {
      const t = token as AppToken;
      if (user) {
        t.id = user.id;
        t.role = (user as any).role;
        t.branchId = (user as any).branchId;
        t.branchName = (user as any).branchName;
        // A fresh sign-in is always as yourself.
        delete t.actor;
      }
      // Allow branch switching
      if (trigger === "update" && session?.branchId) {
        t.branchId = session.branchId;
        t.branchName = session.branchName;
      }

      // Start impersonating. `POST /api/impersonate` has already checked this
      // and written the audit row, but the token is the thing that actually
      // grants access, so the same check runs again here — a client calling
      // `update()` directly must not get further than one calling the route.
      if (trigger === "update" && session?.impersonateUserId) {
        const check = await checkImpersonation(
          { id: String(t.id), role: String(t.role) },
          String(session.impersonateUserId),
          Boolean(t.actor)
        );
        if (check.ok) {
          t.actor = { id: String(t.id), name: t.name, email: t.email, role: t.role };
          t.id = check.target.id;
          t.name = check.target.name;
          t.email = check.target.email;
          t.role = check.target.role;
          // The target's own branch, so the sale lands where they work. They
          // may have none assigned, in which case the admin's stays put rather
          // than leaving the till with no branch to post to.
          t.branchId = check.target.branchId ?? t.branchId;
          t.branchName = check.target.branchName ?? t.branchName;
        }
      }

      // Back to admin. Their row is re-read rather than trusted from the token,
      // so a role or branch changed while they were away comes back correct;
      // if the account is gone or deactivated, the impersonation simply ends
      // and the next request finds no valid user.
      if (trigger === "update" && session?.stopImpersonating && t.actor) {
        const returning = await loadReturningActor(t.actor.id);
        if (returning) {
          t.id = returning.id;
          t.name = returning.name;
          t.email = returning.email;
          t.role = returning.role;
          t.branchId = returning.branchId ?? t.branchId;
          t.branchName = returning.branchName ?? t.branchName;
        }
        delete t.actor;
      }

      return t;
    },
    async session({ session, token }) {
      const t = token as AppToken;
      if (t) {
        session.user.id = t.id as string;
        session.user.name = t.name ?? session.user.name;
        session.user.email = t.email ?? session.user.email;
        (session.user as any).role = t.role;
        (session.user as any).branchId = t.branchId;
        (session.user as any).branchName = t.branchName;
        // Only set while impersonating — the banner and the "login as" button
        // both key off its presence.
        (session.user as any).actor = t.actor ?? null;
      }
      return session;
    },
  },
});
