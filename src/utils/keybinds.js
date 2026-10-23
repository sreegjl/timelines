import { getAppSettings, saveAppSettings } from "./appSettings";

export const DEFAULT_KEYBINDS = {
  search: { label: "Search", keys: ["Ctrl", "F"] },
  play: { label: "Play / Pause", keys: ["Space"] },
  undo: { label: "Undo", keys: ["Ctrl", "Z"] },
  redo: { label: "Redo", keys: ["Ctrl", "Y"] },
  delete: { label: "Delete", keys: ["Delete"] },
  selectPrevious: { label: "Select Previous", keys: ["ArrowLeft"] },
  selectNext: { label: "Select Next", keys: ["ArrowRight"] },
  selectTypeDown: { label: "Select Type Down", keys: ["ArrowDown"] },
  selectTypeUp: { label: "Select Type Up", keys: ["ArrowUp"] },
  newEvent: { label: "New Event", keys: ["Ctrl", "Shift", "E"] },
  newSpan: { label: "New Span", keys: ["Ctrl", "Shift", "S"] },
  newEra: { label: "New Era", keys: ["Ctrl", "Shift", "R"] },
  viewTimeline: { label: "Timeline View", keys: ["Alt", "1"] },
  viewMap: { label: "Map View", keys: ["Alt", "2"] },
  viewSpreadsheet: { label: "Table View", keys: ["Alt", "3"] },
  viewCalendar: { label: "Calendar View", keys: ["Alt", "4"] },
};

export function cloneDefaultKeybinds() {
  return Object.fromEntries(
    Object.entries(DEFAULT_KEYBINDS).map(([id, bind]) => [
      id,
      { ...bind, keys: [...bind.keys] },
    ])
  );
}

export function matchesKeybind(event, bind) {
  if (!bind?.keys?.length) return false;
  const keys = bind.keys.map((key) => key.toLowerCase());
  const needsCtrl = keys.includes("ctrl");
  const needsAlt = keys.includes("alt");
  const needsShift = keys.includes("shift");
  const mainKey = keys.find((key) => !["ctrl", "alt", "shift"].includes(key));
  if (!mainKey) return false;
  const isMac = navigator.platform.includes("Mac");
  const ctrlOrMeta = isMac ? event.metaKey : event.ctrlKey;
  if (needsCtrl !== ctrlOrMeta) return false;
  if (needsAlt !== event.altKey) return false;
  if (needsShift !== event.shiftKey) return false;
  const eventKey = event.key === " " ? "space" : event.key.toLowerCase();
  return eventKey === mainKey;
}

function isLegacyKeybindMap(keybinds) {
  if (!keybinds || typeof keybinds !== "object") return false;
  return Object.values(keybinds).some(
    (value) => value && typeof value === "object" && !Array.isArray(value)
  );
}

function serializeKeybinds(keybinds) {
  return Object.fromEntries(
    Object.entries(DEFAULT_KEYBINDS).map(([id, bind]) => [
      id,
      Array.isArray(keybinds?.[id]?.keys)
        ? [...keybinds[id].keys]
        : [...bind.keys],
    ])
  );
}

function normalizeKeybinds(savedKeybinds) {
  const keybinds = cloneDefaultKeybinds();
  if (!savedKeybinds || typeof savedKeybinds !== "object") return keybinds;

  for (const [id, savedKeys] of Object.entries(savedKeybinds)) {
    if (!keybinds[id] || !Array.isArray(savedKeys)) continue;
    keybinds[id] = { ...keybinds[id], keys: [...savedKeys] };
  }

  return keybinds;
}

export async function loadKeybinds() {
  const settings = await getAppSettings();
  if (isLegacyKeybindMap(settings?.keybinds)) {
    const nextSettings = { ...settings };
    delete nextSettings.keybinds;
    await saveAppSettings(nextSettings);
    return cloneDefaultKeybinds();
  }
  return normalizeKeybinds(settings?.keybinds);
}

export async function saveKeybinds(keybinds) {
  const settings = await getAppSettings();
  await saveAppSettings({
    ...settings,
    keybinds: serializeKeybinds(keybinds),
  });
}
