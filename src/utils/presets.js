// a preset is an outfit: type, color, icon, tags and property fields. character, location, suspicious cheese

export const PRESET_TYPES = ["event", "span", "era"];
export const MAX_PROPERTY_KEY_LENGTH = 60;
export const MAX_PROPERTY_VALUE_LENGTH = 500;

export const STARTER_PRESETS = [
  { id: "preset-character", name: "Character", type: "span", color: "#8E7CC3", icon: null, tags: ["character"], properties: ["Role", "Affiliation", "Born", "Died"] },
  { id: "preset-location", name: "Location", type: "event", color: "#6AA84F", icon: null, tags: ["location"], properties: ["Region", "Ruler", "Population"] },
  { id: "preset-battle", name: "Battle", type: "event", color: "#CC4125", icon: null, tags: ["battle"], properties: ["Belligerents", "Outcome", "Casualties"] },
];

const clean = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

// keys are trimmed and unique (first one wins, sorry second one), values stay as typed-ish
export function normalizeProperties(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const key = clean(item?.key, MAX_PROPERTY_KEY_LENGTH);
    if (!key) continue;
    const lower = key.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push({ key, value: String(item?.value ?? "").slice(0, MAX_PROPERTY_VALUE_LENGTH) });
  }
  return out;
}

export function normalizePresets(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const name = clean(raw?.name, 60);
    if (!name || !raw?.id || seen.has(raw.id)) continue;
    seen.add(raw.id);
    const preset = {
      id: String(raw.id),
      name,
      type: PRESET_TYPES.includes(raw.type) ? raw.type : "event",
      properties: normalizeProperties((raw.properties || []).map((key) => ({ key }))).map((p) => p.key),
    };
    if (typeof raw.color === "string" && raw.color) preset.color = raw.color;
    if (typeof raw.icon === "string" && raw.icon) preset.icon = raw.icon;
    const tags = Array.isArray(raw.tags) ? raw.tags.filter((t) => typeof t === "string" && t.trim()) : [];
    if (tags.length) preset.tags = [...new Set(tags)];
    out.push(preset);
  }
  return out;
}

export function makePresetId(name, presets = []) {
  const base = `preset-${String(name || "preset").toLowerCase().replace(/[^\w]+/g, "-").replace(/^-+|-+$/g, "") || "preset"}`;
  const taken = new Set(presets.map((p) => p.id));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

// fills in what's missing, but color and icon always change, that's the whole point of an outfit
export function applyPreset(element, preset) {
  if (!element || !preset) return element;
  const next = { ...element, preset: preset.id };
  if (preset.color) next.color = preset.color;
  if (preset.icon) next.icon = preset.icon;
  if (Array.isArray(preset.tags) && preset.tags.length && element.type !== "era") {
    const tags = Array.isArray(element.tags) ? element.tags : [];
    next.tags = [...new Set([...tags, ...preset.tags])];
  }
  const props = normalizeProperties(element.properties);
  const have = new Set(props.map((p) => p.key.toLowerCase()));
  for (const key of preset.properties || []) {
    if (!have.has(key.toLowerCase())) props.push({ key, value: "" });
  }
  if (props.length) next.properties = props;
  return next;
}

export function createPresetFromElement(element, name, presets = []) {
  const presetName = clean(name, 60);
  if (!element || !presetName) return null;
  const preset = {
    id: makePresetId(presetName, presets),
    name: presetName,
    type: PRESET_TYPES.includes(element.type) ? element.type : "event",
    properties: normalizeProperties(element.properties).map((p) => p.key),
  };
  if (element.color) preset.color = element.color;
  if (element.icon) preset.icon = element.icon;
  if (Array.isArray(element.tags) && element.tags.length && element.type !== "era") preset.tags = [...element.tags];
  return preset;
}

export function getPropertyKeysInUse(elements = [], presets = []) {
  const keys = new Map();
  const add = (key) => {
    const k = clean(key, MAX_PROPERTY_KEY_LENGTH);
    if (k && !keys.has(k.toLowerCase())) keys.set(k.toLowerCase(), k);
  };
  for (const el of elements) for (const p of Array.isArray(el?.properties) ? el.properties : []) add(p?.key);
  for (const preset of presets) for (const key of preset?.properties || []) add(key);
  return [...keys.values()].sort((a, b) => a.localeCompare(b));
}

// loose key matching for filters: "Eye Color", "eye_color" and "eye-color" are the same girl
export const normalizePropertyKey = (key) => String(key ?? "").toLowerCase().replace(/[\s_-]+/g, "");
