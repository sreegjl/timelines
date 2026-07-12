import themeIndex from "../config/theme.json";

const themeModules = import.meta.glob("../config/themes/*.json", { eager: true });

export const formatCollectionName = (collection) => String(collection || "")
  .split(/[_-]+/)
  .filter(Boolean)
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(" ");

export const themeOptionLabel = (key, theme) => {
  const name = theme?.name || key;
  const collection = String(theme?.collection || "").toLowerCase();
  if (!collection || collection === "bundled" || collection === "featured") return name;
  return `${formatCollectionName(collection)} - ${name}`;
};

export const loadThemeConfig = () => {
  const themes = {};

  Object.entries(themeModules).forEach(([path, module]) => {
    const data = module?.default || module;
    if (!data) return;
    const fileName = path.split("/").pop() || "";
    const key = fileName.replace(".json", "");
    if (!key) return;
    themes[key] = data;
  });

  return {
    activeTheme: themeIndex.activeTheme,
    themes,
  };
};
