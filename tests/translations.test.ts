import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { translations } from "@/lib/translations";

/**
 * Every `t("…")` in the app must resolve in **both** languages.
 *
 * `t()` falls back to returning the key itself, so a missing string doesn't
 * throw or log — it just renders `ledger_tabInstallments` at the user, which is
 * exactly how two of these reached the shop screen. This test walks the source
 * for literal `t("key")` calls and checks each one against the merged
 * dictionary, so the next missing string fails here instead of on the till.
 */

const ROOTS = ["app", "components", "lib"];
const CALL = /\bt\(\s*"([a-zA-Z0-9_]+)"\s*\)/g;
/** Keys held in a `label:` field and passed to `t()` elsewhere (roles matrix, ledger filters). */
const INDIRECT = /\blabel:\s*"((?:roles_|ledger_|reports_|settings_)[a-zA-Z0-9_]+)"/g;

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      sourceFiles(full, found);
    } else if (/\.tsx?$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

function usedKeys(): Map<string, string[]> {
  const byKey = new Map<string, string[]>();
  for (const root of ROOTS) {
    for (const file of sourceFiles(root)) {
      // The translation sources themselves define keys, they don't consume them.
      if (file.includes(join("lib", "translations"))) continue;
      const text = readFileSync(file, "utf8");
      for (const re of [CALL, INDIRECT]) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
          const list = byKey.get(m[1]) ?? [];
          if (!list.includes(file)) list.push(file);
          byKey.set(m[1], list);
        }
      }
    }
  }
  return byKey;
}

const used = usedKeys();
const en = translations.en as Record<string, string>;
const ur = translations.ur as Record<string, string>;

describe("translation coverage", () => {
  it("finds the keys the app actually uses", () => {
    // Guards the scanner itself: if the regex stops matching, everything below
    // would pass vacuously.
    expect(used.size).toBeGreaterThan(300);
  });

  it("has an English string for every key used in the app", () => {
    const missing = [...used].filter(([key]) => !en[key])
      .map(([key, files]) => `${key}  (${files.join(", ")})`);
    expect(missing, `missing English strings:\n${missing.join("\n")}`).toEqual([]);
  });

  it("has an Urdu string for every key used in the app", () => {
    const missing = [...used].filter(([key]) => !ur[key])
      .map(([key, files]) => `${key}  (${files.join(", ")})`);
    expect(missing, `missing Urdu strings:\n${missing.join("\n")}`).toEqual([]);
  });

  it("defines the same key set in both languages", () => {
    const onlyEn = Object.keys(en).filter((k) => !(k in ur));
    const onlyUr = Object.keys(ur).filter((k) => !(k in en));
    expect({ onlyEn, onlyUr }).toEqual({ onlyEn: [], onlyUr: [] });
  });

  it("has no blank strings", () => {
    const blank = [...Object.entries(en), ...Object.entries(ur)]
      .filter(([, value]) => typeof value !== "string" || value.trim() === "")
      .map(([key]) => key);
    expect(blank).toEqual([]);
  });
});
