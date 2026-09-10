import { setupI18n } from "@lingui/core";
import type { Messages } from "@lingui/core";
import { useLingui } from "@lingui/react";
import { useMemo } from "react";
import { de, en } from "./messages.js";
import type { MessageKey } from "./messages.js";

function compiledCatalog(messages: Messages): Messages {
  return Object.fromEntries(
    Object.entries(messages).map(([key, value]) => [
      key,
      typeof value === "string" ? [value] : value,
    ]),
  );
}
const catalogs = { en: compiledCatalog(en), de: compiledCatalog(de) };

export function resolveLanguage(locale: string): "en" | "de" {
  return locale.toLowerCase().split(/[-_]/u)[0] === "de" ? "de" : "en";
}
export function translator(locale: string): {
  t: (key: MessageKey, values?: Record<string, string | number>) => string;
  locale: string;
} {
  const language = resolveLanguage(locale);
  const instance = setupI18n({ locale: language, messages: catalogs });
  let formatLocale: string = language;
  if (/^(en|de)([-_]|$)/iu.test(locale)) {
    try {
      formatLocale =
        Intl.getCanonicalLocales(locale.replaceAll("_", "-"))[0] ?? language;
    } catch {
      /* Fall back to the supported base language. */
    }
  }
  return { t: (key, values) => instance._(key, values), locale: formatLocale };
}
export function useRelinkLocale(): ReturnType<typeof translator> {
  const { i18n } = useLingui();
  // React follows the host's activation event. Relink does not activate a global locale.
  return useMemo(() => translator(i18n.locale), [i18n.locale]);
}
