import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SessionProvider } from "next-auth/react";
import { Toaster } from "react-hot-toast";
import { I18nProvider } from "@/lib/i18n";
import { brandingShortName, resolveBrandingBranch } from "@/lib/branding";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * Tab title and manifest link, from the store's own settings.
 *
 * These were hard-coded to one shop ("Sidhey Sheikh Cloth Center POS"), so
 * renaming the store in Settings changed the receipts and the invoices but left
 * the browser tab, the install prompt and the iOS home-screen label naming the
 * previous owner. The tab icon is generated from the same name — see
 * `app/icon.tsx` — so leaving the title behind would have been half a rename.
 *
 * Costs one indexed query per page render. The dashboard is entirely dynamic
 * already; the login page gives up static optimisation for it, which is a fair
 * trade for a tab that says who the shop is.
 */
export async function generateMetadata(): Promise<Metadata> {
  const branch = await resolveBrandingBranch();
  const name = branch?.name?.trim() || "POS";
  return {
    title: `${name} POS`,
    description: [name, branch?.city].filter(Boolean).join(", ") + " — Point of Sale",
    // No `manifest:` field: `app/manifest.ts` makes Next emit
    // `<link rel="manifest" href="/manifest.webmanifest">` on its own, and it
    // overrides anything set here — the old explicit "/manifest.json" was
    // being silently rewritten, which is a confusing thing to leave in place.
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      // The home-screen label, where there is room for about a dozen
      // characters — the shop's initials rather than a clipped name.
      title: brandingShortName(name),
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#0d9488",
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-gray-50`}>
        <I18nProvider>
          <SessionProvider>
            {children}
            <Toaster
              position="top-right"
              toastOptions={{
                duration: 3000,
                style: { fontSize: "14px" },
              }}
            />
          </SessionProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
