import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Sidebar from "@/components/layout/Sidebar";
import SwRegister from "@/components/layout/SwRegister";
import ImpersonationBar from "@/components/layout/ImpersonationBar";
import { StoreProvider } from "@/lib/store-context";
import { PermissionsProvider } from "@/lib/permissions-client";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <StoreProvider>
      <PermissionsProvider>
        <SwRegister />
        <div className="flex h-screen overflow-hidden bg-gray-50">
          <Sidebar />
          {/* The column exists so the "signed in as" banner can sit above the
              page and span its full width; it renders nothing when nobody is
              impersonating, leaving an ordinary session laid out as before. */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            <ImpersonationBar />
            <main className="flex-1 overflow-y-auto">
              {children}
            </main>
          </div>
        </div>
      </PermissionsProvider>
    </StoreProvider>
  );
}
