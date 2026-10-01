"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import toast from "react-hot-toast";

type Props = { storeName: string; storeAddress: string };

export default function LoginForm({ storeName, storeAddress }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";

  const [form, setForm] = useState({ email: "", password: "" });
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await signIn("credentials", {
        email: form.email,
        password: form.password,
        redirect: false,
      });
      if (result?.error) {
        toast.error("Invalid email or password");
      } else {
        toast.success("Login successful");
        router.push(callbackUrl);
        router.refresh();
      }
    } catch {
      toast.error("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  // Abbreviate store name for badge
  const initials = storeName.split(" ").map(w => w[0]).slice(0, 3).join("").toUpperCase();

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-600 to-teal-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo / Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-full mb-4 shadow-lg">
            <span className="text-lg font-bold text-teal-700">{initials}</span>
          </div>
          <h1 className="text-2xl font-bold text-white leading-tight">{storeName}</h1>
          {storeAddress && (
            <p className="text-teal-300 text-sm mt-1">{storeAddress}</p>
          )}
          <p className="text-teal-200 text-xs mt-1">Point of Sale System</p>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-lg font-semibold text-gray-800 mb-6">Sign in to your account</h2>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                Email Address
              </label>
              <input id="email" type="email" required value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="admin@store.com"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm" />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <input id="password" type="password" required value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="••••••••"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm" />
            </div>
            <button type="submit" disabled={loading}
              className="w-full bg-teal-600 hover:bg-teal-700 text-white font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-60">
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>
          <p className="text-xs text-gray-400 text-center mt-5">
            {storeName} · POS v1.0
          </p>
        </div>
      </div>
    </div>
  );
}
