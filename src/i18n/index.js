import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { FALLBACK_LOCALE, resolveLocale } from "./config";

// Vite splits each locale JSON into its own chunk so a bundle only fetches what it uses.
const localeModules = import.meta.glob("../locales/*/*.json");

const modulePath = (locale, namespace) => `../locales/${locale}/${namespace}.json`;

const loadBundle = async (locale, namespace) => {
  const loader = localeModules[modulePath(locale, namespace)];
  if (!loader) return false;
  if (i18next.hasResourceBundle(locale, namespace)) return true;
  try {
    const mod = await loader();
    i18next.addResourceBundle(locale, namespace, mod.default || mod, true, true);
    return true;
  } catch (error) {
    console.error(`Failed to load locale ${locale}/${namespace}:`, error);
    return false;
  }
};

// English is always loaded alongside so a partial translation falls back key by key.
const loadLocale = async (locale, namespaces) => {
  const wanted = locale === FALLBACK_LOCALE ? [locale] : [locale, FALLBACK_LOCALE];
  await Promise.all(wanted.flatMap((l) => namespaces.map((ns) => loadBundle(l, ns))));
};

// Browser preference is only a first guess; an explicit setting always wins.
export const detectLocale = (saved) => resolveLocale(saved || navigator.language || FALLBACK_LOCALE);

export async function initI18n({ namespaces, locale }) {
  const resolved = resolveLocale(locale);
  await i18next.use(initReactI18next).init({
    lng: resolved,
    fallbackLng: FALLBACK_LOCALE,
    ns: namespaces,
    defaultNS: "common",
    resources: {},
    interpolation: { escapeValue: false },
    returnEmptyString: false,
    react: { useSuspense: false },
  });
  await loadLocale(resolved, namespaces);
  document.documentElement.lang = resolved;
  return i18next;
}

export async function changeLocale(locale) {
  const resolved = resolveLocale(locale);
  const namespaces = i18next.options.ns || [];
  await loadLocale(resolved, Array.isArray(namespaces) ? namespaces : [namespaces]);
  await i18next.changeLanguage(resolved);
  document.documentElement.lang = resolved;
  return resolved;
}

export default i18next;
