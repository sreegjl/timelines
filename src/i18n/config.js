export const FALLBACK_LOCALE = "en";

// Locales the app ships. nativeName is what the language picker shows.
export const SUPPORTED_LOCALES = [
  { code: "en", nativeName: "English" },
];

// The viewer shares components with the app, so their strings live in common/timeline.
// "app" and "settings" are desktop-only and never reach the viewer bundle.
export const APP_NAMESPACES = ["common", "app", "settings", "timeline"];
export const VIEWER_NAMESPACES = ["common", "timeline", "viewer"];

export const isSupportedLocale = (code) => SUPPORTED_LOCALES.some((l) => l.code === code);

// "pt-BR" exact, else "pt-PT" falls back to a shipped "pt", else English.
export const resolveLocale = (requested) => {
  if (!requested || typeof requested !== "string") return FALLBACK_LOCALE;
  if (isSupportedLocale(requested)) return requested;
  const base = requested.split("-")[0];
  if (isSupportedLocale(base)) return base;
  const sibling = SUPPORTED_LOCALES.find((l) => l.code.split("-")[0] === base);
  return sibling ? sibling.code : FALLBACK_LOCALE;
};
