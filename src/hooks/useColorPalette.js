import { createContext, useContext, useEffect, useState } from "react";
import { getAppSettings, saveAppSettings } from "../utils/appSettings";

export const PALETTE_MAX = 16;
const HEX_RE = /^#[0-9a-f]{6}$/i;

// Colors used by the open timeline, for the picker's "In this timeline" row
export const TimelineColorsContext = createContext([]);
export const useTimelineColors = () => useContext(TimelineColorsContext);

// Element, break, tag and group colors, most used first
export function collectTimelineColors(timelineData) {
  const counts = new Map();
  const add = (color) => {
    if (typeof color !== "string" || !HEX_RE.test(color)) return;
    const key = color.toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  };
  (timelineData?.elements || []).forEach((el) => {
    add(el.color);
    if (Array.isArray(el.breaks)) el.breaks.forEach((brk) => add(brk?.color));
  });
  Object.values(timelineData?.file?.tagColors || {}).forEach(add);
  (timelineData?.file?.groups || []).forEach((group) => add(group.bgColor));
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, PALETTE_MAX)
    .map(([color]) => color);
}

// applyTheme writes theme colors as inline custom properties on the root
export function readThemeColors() {
  const style = document.documentElement.style;
  const colors = new Set();
  for (let i = 0; i < style.length; i += 1) {
    const prop = style[i];
    if (!prop.startsWith("--")) continue;
    const value = style.getPropertyValue(prop).trim().toLowerCase();
    if (HEX_RE.test(value)) colors.add(value);
  }
  return [...colors].slice(0, PALETTE_MAX);
}

// Shared across every open picker so a change in one shows in all
let favorites = null;
let loading = null;
const listeners = new Set();

const emit = () => listeners.forEach((fn) => fn(favorites));

const loadFavorites = () => {
  if (!loading) {
    loading = getAppSettings().then((settings) => {
      const saved = Array.isArray(settings?.favoriteColors) ? settings.favoriteColors : [];
      favorites = saved.filter((c) => typeof c === "string" && HEX_RE.test(c)).map((c) => c.toLowerCase()).slice(0, PALETTE_MAX);
      emit();
    });
  }
  return loading;
};

const setFavorites = (next) => {
  favorites = next;
  emit();
  saveAppSettings({ favoriteColors: next }).catch(console.error);
};

export function useFavoriteColors() {
  const [list, setList] = useState(() => favorites || []);

  useEffect(() => {
    listeners.add(setList);
    if (favorites) setList(favorites);
    else loadFavorites();
    return () => listeners.delete(setList);
  }, []);

  const addFavorite = (hex) => {
    const color = String(hex || "").toLowerCase();
    if (!favorites || !HEX_RE.test(color) || favorites.includes(color) || favorites.length >= PALETTE_MAX) return;
    setFavorites([...favorites, color]);
  };

  const removeFavorite = (hex) => {
    if (!favorites) return;
    setFavorites(favorites.filter((c) => c !== String(hex).toLowerCase()));
  };

  return { favorites: list, addFavorite, removeFavorite, isFull: list.length >= PALETTE_MAX };
}
