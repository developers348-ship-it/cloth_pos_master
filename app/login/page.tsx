import { prisma } from "@/lib/prisma";
import { Suspense } from "react";
import LoginForm from "./LoginForm";

export default async function LoginPage() {
  // Load store name dynamically for the login page
  const branch = await prisma.branch.findFirst({ orderBy: { createdAt: "asc" } });
  const storeName = branch?.name ?? "POS System";
  const storeAddress = [branch?.address, branch?.city].filter(Boolean).join(", ");

  // Suspense is required because LoginForm uses useSearchParams()
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-teal-600 to-teal-800 flex items-center justify-center">
        <div className="text-white text-sm opacity-60">Loading…</div>
      </div>
    }>
      <LoginForm storeName={storeName} storeAddress={storeAddress} />
    </Suspense>
  );
}
