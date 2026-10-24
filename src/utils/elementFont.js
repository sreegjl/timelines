// per-element font size override. anything silly gets ignored, we have standards (low ones, but still)
export const ELEMENT_FONT_SIZE_MIN = 6;
export const ELEMENT_FONT_SIZE_MAX = 32;
export function resolveElementFontSize(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(ELEMENT_FONT_SIZE_MAX, Math.max(ELEMENT_FONT_SIZE_MIN, Math.round(n)));
}

// the card grows with its text, otherwise a 20px title in a 10px box is just sad
export function scaleEventHeight(baseHeight, size, baseSize) {
  if (!Number.isFinite(size) || !Number.isFinite(baseSize) || baseSize <= 0 || size === baseSize) return baseHeight;
  return Math.max(10, Math.round((baseHeight * size) / baseSize));
}

// css vars for one event card. mirrors the numbers layoutEvents uses so the measure and the look agree
export function getEventFontVars(value, baseFontSize = 10, baseHeight = 25) {
  const size = resolveElementFontSize(value);
  if (size == null || size === baseFontSize) return null;
  const height = scaleEventHeight(baseHeight, size, baseFontSize);
  return {
    "--event-font-size": `${size}px`,
    "--event-date-font-size": `${Math.max(6, size - 1)}px`,
    "--event-tag-font-size": `${Math.max(5, size - 2)}px`,
    "--event-tag-pad": `${Math.round(size * 0.6)}px`,
    "--event-date-gap": `${Math.max(2, Math.round(size * 0.4))}px`,
    "--event-font-scale": `${size / 10}`,
    "--event-height": `${height}px`,
    "--event-height-noyear": `${Math.max(10, height - 9)}px`,
    "--event-pad-v": `${Math.max(2, Math.round(height * 0.08))}px`,
  };
}

// spans live in fixed-height lanes, so big text gets politely capped per span size
const SPAN_FONT_CAP = { thin: 11, normal: 15, thick: 28 };
export function getSpanFontSize(span) {
  const size = resolveElementFontSize(span?.fontSize);
  if (size == null) return null;
  return Math.min(size, SPAN_FONT_CAP[span?.spanSize] ?? SPAN_FONT_CAP.normal);
}
