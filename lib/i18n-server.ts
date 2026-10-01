import { cookies } from "next/headers";
import { translations, type Lang, type TranslationKey } from "./translations";

const STORAGE_KEY = "uf_pos_lang";

export async function getServerLang(): Promise<Lang> {
  const store = await cookies();
  const value = store.get(STORAGE_KEY)?.value;
  return value === "ur" ? "ur" : "en";
}

export function tFor(lang: Lang) {
  return (key: TranslationKey): string =>
    translations[lang][key] ?? translations.en[key] ?? key;
}
