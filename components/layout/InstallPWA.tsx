"use client";

import { useState, useEffect } from "react";

/**
 * Shows an "Install App" button when the browser's beforeinstallprompt is available.
 * Hidden after install or if already installed.
 */
export default function InstallPWA() {
  const [prompt, setPrompt] = useState<any>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handler as EventListener);
    window.addEventListener("appinstalled", () => setInstalled(true));
    return () => {
      window.removeEventListener("beforeinstallprompt", handler as EventListener);
    };
  }, []);

  if (!prompt || installed) return null;

  const handleInstall = async () => {
    prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === "accepted") setInstalled(true);
    setPrompt(null);
  };

  return (
    <button
      onClick={handleInstall}
      title="Install as desktop app"
      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-teal-300 hover:text-white hover:bg-gray-700 transition-colors"
    >
      <span className="text-base">📲</span>
      <span>Install App</span>
    </button>
  );
}
