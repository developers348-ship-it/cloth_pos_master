"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { translations, type Lang, type TranslationKey } from "./translations";

type I18nContextType = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: TranslationKey) => string;
  isUrdu: boolean;
};

const STORAGE_KEY = "uf_pos_lang";

const I18nContext = createContext<I18nContextType>({
  lang: "en",
  setLang: () => {},
  t: (key) => key,
  isUrdu: false,
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");

  // Load saved preference on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as Lang | null;
    if (saved === "en" || saved === "ur") {
      setLangState(saved);
      document.cookie = `${STORAGE_KEY}=${saved}; path=/; max-age=31536000`;
    }
  }, []);

  // Apply font to <html> element. Layout direction always stays LTR —
  // only the Urdu font + per-text right-alignment (via .urdu-text) change.
  useEffect(() => {
    const html = document.documentElement;
    html.setAttribute("dir", "ltr");
    if (lang === "ur") {
      html.setAttribute("lang", "ur");
      html.classList.add("urdu-ui");
    } else {
      html.setAttribute("lang", "en");
      html.classList.remove("urdu-ui");
    }
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    localStorage.setItem(STORAGE_KEY, l);
    document.cookie = `${STORAGE_KEY}=${l}; path=/; max-age=31536000`;
  }, []);

  const t = useCallback(
    (key: TranslationKey): string => translations[lang][key] ?? translations.en[key] ?? key,
    [lang]
  );

  return (
    <I18nContext.Provider value={{ lang, setLang, t, isUrdu: lang === "ur" }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
