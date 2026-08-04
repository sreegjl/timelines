const parseHexRGB = (hex) => {
  if (typeof hex !== "string") return null;
  const v = hex.trim();
  const short = /^#([0-9a-f]{3})$/i.exec(v);
  if (short) {
    const [r, g, b] = short[1].split("").map((c) => parseInt(c + c, 16));
    return [r, g, b];
  }
  const full = /^#([0-9a-f]{6})$/i.exec(v);
  if (full) {
    return [parseInt(full[1].slice(0, 2), 16), parseInt(full[1].slice(2, 4), 16), parseInt(full[1].slice(4, 6), 16)];
  }
  return null;
};

export const withAlpha = (hex, alpha) => {
  const rgb = parseHexRGB(hex);
  if (rgb) return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
  return typeof hex === "string" ? hex : `rgba(0, 0, 0, ${alpha})`;
};

export const blendColors = (hex1, hex2, weight1 = 0.5) => {
  const c1 = parseHexRGB(hex1);
  const c2 = parseHexRGB(hex2);
  if (!c1 || !c2) return hex1 || hex2 || "#888888";
  const w = Math.min(1, Math.max(0, weight1));
  const r = Math.round(c1[0] * w + c2[0] * (1 - w));
  const g = Math.round(c1[1] * w + c2[1] * (1 - w));
  const b = Math.round(c1[2] * w + c2[2] * (1 - w));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
};

// h is 0-360, s and v are 0-1
export const hexToHsv = (hex) => {
  const rgb = parseHexRGB(hex) || [128, 128, 128];
  const [r, g, b] = rgb.map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max ? d / max : 0, v: max };
};

export const hsvToHex = (h, s, v) => {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rgb;
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return `#${rgb.map((n) => Math.round((n + m) * 255).toString(16).padStart(2, "0")).join("")}`;
};

const isValidHexColor = (color) => /^#[0-9A-Fa-f]{6}$/.test(color);

export const normalizeColor = (color) => {
  if (!color) return "#808080";
  if (isValidHexColor(color)) return color;
  const cleaned = color.replace(/[^0-9A-Fa-f#]/g, "");
  if (isValidHexColor(cleaned)) return cleaned;
  return "#808080";
};
