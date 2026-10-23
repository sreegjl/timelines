import { formatYear, withApproxLabel, formatApproxRange } from "./timelineUtils";
import { displayDateTimeLabel } from "./dateUtils";

// marker svgs shared by the flat map and the globe, so both get the same little pins
export function buildMarkerSvg(color, selected, markerType = "pin") {
  const stroke = selected
    ? getComputedStyle(document.documentElement).getPropertyValue("--selection-color").trim() || "#5282DB"
    : "white";
  const strokeWidth = selected ? 4 : 1.5;
  let svg = "";
  let iconSize = [24, 36];
  let iconAnchor = [12, 36];
  let tooltipAnchor = [14, -18];

  if (markerType === "circle") {
    iconSize = [24, 24];
    iconAnchor = [12, 12];
    tooltipAnchor = [0, -12];
    svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" style="cursor:pointer;display:block;">
        <circle cx="12" cy="12" r="9" fill="${color}" stroke="${stroke}" stroke-width="${strokeWidth}"/>
        <circle cx="12" cy="12" r="3.5" fill="white" opacity="0.7"/>
      </svg>`;
  } else if (markerType === "square") {
    iconSize = [24, 24];
    iconAnchor = [12, 12];
    tooltipAnchor = [0, -12];
    svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" style="cursor:pointer;display:block;">
        <rect x="4" y="4" width="16" height="16" rx="2" fill="${color}" stroke="${stroke}" stroke-width="${strokeWidth}"/>
        <circle cx="12" cy="12" r="3.5" fill="white" opacity="0.7"/>
      </svg>`;
  } else if (markerType === "diamond") {
    iconSize = [24, 24];
    iconAnchor = [12, 12];
    tooltipAnchor = [0, -12];
    svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" style="cursor:pointer;display:block;">
        <path d="M12 2 L22 12 L12 22 L2 12 Z" fill="${color}" stroke="${stroke}" stroke-width="${strokeWidth}"/>
        <circle cx="12" cy="12" r="3.2" fill="white" opacity="0.7"/>
      </svg>`;
  } else if (markerType === "triangle") {
    iconSize = [24, 24];
    iconAnchor = [12, 18];
    tooltipAnchor = [0, -14];
    svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" style="cursor:pointer;display:block;">
        <path d="M12 3 L22 20 H2 Z" fill="${color}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>
        <circle cx="12" cy="14" r="3" fill="white" opacity="0.7"/>
      </svg>`;
  } else {
    iconSize = [20, 30];
    iconAnchor = [10, 30];
    tooltipAnchor = [0, -14];
    svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="30" viewBox="0 0 24 36" style="cursor:pointer;display:block;">
        <rect x="0" y="0" width="24" height="36" fill="transparent"/>
        <path d="M12 0C5.373 0 0 5.373 0 12c0 9 12 24 12 24s12-15 12-24C24 5.373 18.627 0 12 0z"
          fill="${color}" stroke="${stroke}" stroke-width="${strokeWidth}"/>
        <circle cx="12" cy="12" r="5" fill="white" opacity="0.7"/>
      </svg>`;
  }

  return { svg, iconSize, iconAnchor, tooltipAnchor };
}

export const DEFAULT_COLOR = "#6b7280";
export const TYPE_LABEL = { event: "Event", span: "Span", era: "Era" };
export const DEFAULT_MARKER_TYPE = "pin";
export const DEFAULT_MARKER_TYPES = {
  event: "pin",
  span: "circle",
  era: "diamond",
};

export function resolveElementColor(el, spanById) {
  if (el.type === "event") {
    const parentId = el.parents?.[0];
    const parentSpan = parentId ? spanById.get(parentId) : null;
    if (parentSpan?.color) return parentSpan.color;
  }
  if (el.color) return el.color;
  return DEFAULT_COLOR;
}

export function resolveMarkerType(elType, fileConfig) {
  if (elType === "span") return fileConfig?.mapSpanMarker || DEFAULT_MARKER_TYPES.span;
  if (elType === "era") return fileConfig?.mapEraMarker || DEFAULT_MARKER_TYPES.era;
  return fileConfig?.mapEventMarker || DEFAULT_MARKER_TYPES.event;
}

export function isMarkerVisibleAtViewportYear(el, viewportYear, fileConfig) {
  if (!fileConfig?.mapLimitToViewportYear || !Number.isFinite(viewportYear)) return true;

  if (el.type === "event") {
    return Number.isFinite(el.date) && Math.abs(el.date - viewportYear) < 1e-6;
  }

  const start = Number.isFinite(el.start) ? el.start : null;
  const end = Number.isFinite(el.end) ? el.end : null;
  if (start == null && end == null) return false;
  if (start == null) return viewportYear <= end;
  if (end == null) return viewportYear >= start;
  return viewportYear >= start && viewportYear <= end;
}

export function formatElementDate(el, fileConfig) {
  const { negID, posID, approxID, useCalendar, hideDecimals } = fileConfig ?? {};
  if (el.type === "event") {
    const year = displayDateTimeLabel(el.dateLabel, el.time) ?? (el.date != null ? formatYear(el.date, negID, posID, useCalendar === true, hideDecimals) : null);
    return withApproxLabel(year ?? "", approxID, el.approximate === true);
  }
  const start = displayDateTimeLabel(el.startLabel, el.startTime) ?? (el.start != null ? formatYear(el.start, negID, posID, useCalendar === true, hideDecimals) : null);
  const end = displayDateTimeLabel(el.endLabel, el.endTime) ?? (el.end != null ? formatYear(el.end, negID, posID, useCalendar === true, hideDecimals) : null);
  if (start && end) return formatApproxRange(el, start, end, approxID);
  if (start) return withApproxLabel(start, approxID, el.approxStart === true);
  return withApproxLabel(end ?? "", approxID, el.approxEnd === true);
}

// Wrap into [-180, 180] so clicks on the repeated world copies stay valid
export function normalizeLng(lng) {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

export function roundCoord(value) {
  return Math.round(value * 1e6) / 1e6;
}

export const DEFAULT_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const DEFAULT_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export function isOpenStreetMapTileUrl(url) {
  if (!url) return true;
  return /^https:\/\/(?:[a-z0-9-]+\.)*tile\.openstreetmap\.org\//i.test(url);
}

