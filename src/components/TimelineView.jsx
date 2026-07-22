import { useEffect, useLayoutEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle, Fragment, useCallback, lazy, Suspense, useDeferredValue } from "react";
import { createPortal } from "react-dom";
import {
  pickStep,
  buildSpanChildPlacement,
  buildSpanMergePlacement,
  calcSpanBandHeight,
  layoutSpans,
  layoutEvents,
  formatYear,
  calculateDetailLevel,
  getReadableTextColor,
  MONTH_LABELS,
} from "../utils/timelineUtils";
import { parseTimelineInput, snapToMonthGrid, snapToDayGrid, fractionalYearToDate, daysInMonth, todayFractionalYear, displayDateLabel } from "../utils/dateUtils";
import { withAlpha, blendColors } from "../utils/colorUtils";
import { parseFilterQuery, matchesFilter, tokenizeFilterQuery } from "../utils/filterUtils";
import { FileJson, Image, Video, Settings, Plus, Minus, CopyPlus, Trash2, Edit2, ListFilter, Play, Pause, Tag, Eye, EyeOff, Target, Map as MapIcon, GanttChartSquare, Table2, ExternalLink, HelpCircle, Maximize2, X, History } from "lucide-react";
import { ICON_MAP } from "../config/elementIcons";

const FILTER_HISTORY_KEY = "timelines-filter-query-history";
const FILTER_HISTORY_MAX = 8;

const FILTER_TYPE_TERMS = ["is:event", "is:span", "is:era", "has:coords"];
const FILTER_DATE_OPS = [[">", ">"], [">=", "≥"], ["<", "<"], ["<=", "≤"]];
const FILTER_OP_GLYPH = { ">": ">", ">=": "≥", "<": "<", "<=": "≤" };

const HTML2CANVAS_COLOR_PROPERTIES = [
  "color",
  "background-color",
  "background-image",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "outline-color",
  "text-decoration-color",
  "-webkit-text-stroke-color",
  "box-shadow",
  "text-shadow",
  "fill",
  "stroke",
];
const UNSUPPORTED_COLOR_FUNCTION = /(?:color|color-mix|lab|lch|oklab|oklch)\(/i;

// html2canvas 1.4 can't parse color-mix()/color(srgb ...) values, so rasterize them to rgba() in its detached clone
const normalizeHtml2CanvasColors = (clonedDocument, clonedRoot) => {
  const canvas = clonedDocument.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context || !clonedRoot) return;

  const cache = new Map();
  const toRgba = (value) => {
    if (cache.has(value)) return cache.get(value);
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
    const resolved = `rgba(${r}, ${g}, ${b}, ${Math.round((a / 255) * 1000) / 1000})`;
    cache.set(value, resolved);
    return resolved;
  };

  const replaceColorFunctions = (value) => {
    let output = value;
    let searchFrom = 0;
    while (searchFrom < output.length) {
      const match = output.slice(searchFrom).match(UNSUPPORTED_COLOR_FUNCTION);
      if (!match) break;
      const start = searchFrom + match.index;
      let depth = 0;
      let end = -1;
      for (let i = start; i < output.length; i += 1) {
        if (output[i] === "(") depth += 1;
        else if (output[i] === ")") {
          depth -= 1;
          if (depth === 0) {
            end = i + 1;
            break;
          }
        }
      }
      if (end < 0) break;
      const token = output.slice(start, end);
      const replacement = toRgba(token);
      output = `${output.slice(0, start)}${replacement}${output.slice(end)}`;
      searchFrom = start + replacement.length;
    }
    return output;
  };

  const elements = [clonedRoot, ...clonedRoot.querySelectorAll("*")];
  for (const element of elements) {
    const styles = clonedDocument.defaultView?.getComputedStyle(element);
    if (!styles) continue;
    for (const property of HTML2CANVAS_COLOR_PROPERTIES) {
      const value = styles.getPropertyValue(property);
      if (UNSUPPORTED_COLOR_FUNCTION.test(value)) {
        element.style.setProperty(property, replaceColorFunctions(value), "important");
      }
    }
  }
};

const simplifyTimelinePreview = (clonedDocument, clonedTimeline) => {
  const walker = clonedDocument.createTreeWalker(
    clonedTimeline,
    clonedDocument.defaultView?.NodeFilter?.SHOW_TEXT ?? 4,
  );
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  for (const node of textNodes) node.nodeValue = "";

  for (const element of clonedTimeline.querySelectorAll(
    "img, svg, .event-thumbnail-tile, .event-thumbnail-banner, .event-thumbnail-square, .event-thumbnail-circle",
  )) {
    element.remove();
  }

  for (const item of clonedTimeline.querySelectorAll(".event, .span-item, .era-item")) {
    item.replaceChildren();
    item.classList.remove(
      "is-selected",
      "has-source-link",
      "has-thumbnail",
      "has-thumbnail-banner",
      "has-thumbnail-square",
      "has-thumbnail-circle",
    );
  }

  for (const element of [clonedTimeline, ...clonedTimeline.querySelectorAll("*")]) {
    const backgroundImage = clonedDocument.defaultView?.getComputedStyle(element).backgroundImage;
    if (backgroundImage?.includes("url(")) {
      element.style.setProperty("background-image", "none", "important");
    }
  }
};

const filterChipTerm = (chip) => {
  let term;
  if (chip.kind === "date") term = `${chip.op}${chip.value}`;
  else if (chip.kind === "tag") term = `#${chip.value}`;
  else if (chip.kind === "text") term = /[\s|()~"<>]/.test(chip.value) ? `"${chip.value}"` : chip.value;
  else term = chip.value; // "type" kind holds the literal term: is:event / has:coords
  return (chip.negated ? "~" : "") + term;
};

const filterChipLabel = (chip) =>
  chip.kind === "date" ? `${FILTER_OP_GLYPH[chip.op] ?? chip.op} ${chip.value}`
    : chip.kind === "tag" ? `#${chip.value}`
    : chip.value;

const buildChipQuery = (chips) =>
  chips.map((c, i) => (i > 0 && c.join === "or" ? "| " : "") + filterChipTerm(c)).join(" ");

const chipsFromQuery = (query, nextId) => {
  const chips = [];
  let join = "and";
  let negated = false;
  for (const tok of tokenizeFilterQuery(query)) {
    if (tok.t === "OR") { join = "or"; continue; }
    if (tok.t === "NOT") { negated = true; continue; }
    if (tok.t !== "LEAF") continue;
    let chip;
    if (tok.kind === "type") chip = { kind: "type", value: `is:${tok.value}` };
    else if (tok.kind === "has") chip = { kind: "type", value: `has:${tok.value}` };
    else if (tok.kind === "tag") chip = { kind: "tag", value: tok.value };
    else if (tok.kind === "date") chip = { kind: "date", op: tok.op, value: tok.value };
    else if (tok.kind === "contains") chip = { kind: "text", value: `contains:${tok.value}` };
    else chip = { kind: "text", value: tok.value };
    chips.push({ id: nextId(), negated, join: chips.length === 0 ? "and" : join, ...chip });
    join = "and";
    negated = false;
  }
  return chips;
};
const MapView = lazy(() => import("./MapView"));
import "../styles/04-timeline.css";
import "../styles/07-modals-menus.css";

function assignEraLanes(eras, bandHeight, bandGap) {
  if (eras.length === 0) return new Map();
  const byId = new Map(eras.map((e) => [e.id, e]));
  const stride = bandHeight + bandGap;
  const dur = (e) => e.end - e.start;
  const overlaps = (a, b) => a.start < b.end && a.end > b.start;
  const getEraHeight = (era) => {
    const size = era?.eraSize || "normal";
    if (size === "extra-thick") return bandHeight * 3;
    if (size === "thick") return bandHeight * 2;
    return bandHeight;
  };
  const verticalOverlap = (topA, heightA, topB, heightB) =>
    topA < topB + heightB && topA + heightA > topB;

  // Implicit parent = the shortest strictly-longer era that overlaps this one.
  // Overlapping eras are stacked automatically: shorter above longer, touching.
  const implicitParentOf = new Map();
  for (const era of eras) {
    let parent = null;
    for (const other of eras) {
      if (other.id === era.id) continue;
      if (!overlaps(era, other)) continue;
      if (dur(other) <= dur(era)) continue;
      if (!parent || dur(other) < dur(parent)) parent = other;
    }
    if (parent) implicitParentOf.set(era.id, parent);
  }

  // Height above the root's own top edge used by its deepest implicit child chain.
  const aboveHeightOf = new Map();
  const getAboveHeight = (era) => {
    if (aboveHeightOf.has(era.id)) return aboveHeightOf.get(era.id);
    const children = eras.filter((e) => implicitParentOf.get(e.id)?.id === era.id);
    const h = children.length === 0
      ? 0
      : Math.max(...children.map((child) => getEraHeight(child) + getAboveHeight(child)));
    aboveHeightOf.set(era.id, h);
    return h;
  };
  eras.forEach(getAboveHeight);

  const visited = new Set();
  const ordered = [];
  const visit = (era) => {
    if (visited.has(era.id)) return;
    const parent = implicitParentOf.get(era.id);
    if (parent) visit(parent);
    visited.add(era.id);
    ordered.push(era);
  };
  [...eras].sort((a, b) => a.start - b.start).forEach(visit);

  // All root eras share the same base offset so they sit in the same bottommost lane.
  const commonRootBottom = Math.max(0, ...eras
    .filter((e) => !implicitParentOf.has(e.id))
    .map((e) => getEraHeight(e)));

  const offsetOf = new Map();

  for (const era of ordered) {
    const eraHeight = getEraHeight(era);
    const parent = implicitParentOf.get(era.id);
    if (parent && offsetOf.has(parent.id)) {
      // Place touching directly above implicit parent; resolve conflicts by going higher.
      let targetOffset = offsetOf.get(parent.id) - eraHeight;
      while (true) {
        let conflict = false;
        for (const [otherId, otherOffset] of offsetOf) {
          const other = byId.get(otherId);
          if (!other || !overlaps(era, other)) continue;
          const otherHeight = getEraHeight(other);
          if (verticalOverlap(targetOffset, eraHeight, otherOffset, otherHeight)) {
            conflict = true;
            targetOffset = otherOffset - eraHeight;
            break;
          }
        }
        if (!conflict) break;
      }
      offsetOf.set(era.id, targetOffset);
    } else {
      // Root era: find first lane-aligned offset where the era and all its
      // implicit children have room to move upward without needing fake lane gaps.
      let offset = commonRootBottom - eraHeight;
      while (true) {
        let valid = true;
        for (const [otherId, otherOffset] of offsetOf) {
          if (!valid) break;
          const other = byId.get(otherId);
          if (!other || !overlaps(era, other)) continue;
          const otherHeight = getEraHeight(other);
          if (verticalOverlap(offset, eraHeight, otherOffset, otherHeight)) {
            valid = false;
          }
        }
        if (valid) break;
        offset += stride;
      }
      offsetOf.set(era.id, offset);
    }
  }

  const minOffset = Math.min(...offsetOf.values());
  if (minOffset < 0) offsetOf.forEach((v, k) => offsetOf.set(k, v - minOffset));
  return offsetOf;
}

function OverflowTags({ tags, tagColors, getReadableTextColor: readableColor }) {
  const containerRef = useRef(null);
  const [visibleCount, setVisibleCount] = useState(tags.length);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const tagEls = Array.from(el.querySelectorAll('.pinned-tag-item'));
    if (tagEls.length < 2) return;
    const firstTop = tagEls[0].getBoundingClientRect().top;
    let firstLineCount = 0;
    for (const tagEl of tagEls) {
      if (Math.abs(tagEl.getBoundingClientRect().top - firstTop) < 1) firstLineCount++;
      else break;
    }
    if (firstLineCount < tags.length) {
      const newVisible = Math.max(1, firstLineCount - 1);
      if (newVisible !== visibleCount) setVisibleCount(newVisible);
    }
  }, [tags.length, visibleCount]); // parent key remounts when tags change

  const overflow = tags.length - visibleCount;

  return (
    <span className="pinned-tags" ref={containerRef}>
      {tags.slice(0, visibleCount).map((tag) => (
        <span
          key={tag}
          className="pinned-tag pinned-tag-item"
          style={tagColors?.[tag] ? { background: tagColors[tag], color: readableColor(tagColors[tag]) } : undefined}
        >
          {tag}
        </span>
      ))}
      {overflow > 0 && <span className="pinned-tag pinned-tag-overflow">+{overflow}</span>}
    </span>
  );
}

const TimelineView = forwardRef(function TimelineView({
  selectedId,
  onSelect,
  timelineData,
  onZoomChange,
  onHeightChange,
  onAddEvent,
  onAddSpan,
  onAddEra,
  onOpenSettings,
  onDelete,
  onDuplicateElement,
  onEditElement,
  downloadPngTrigger,
  exportPngOptions,
  onExportPng,
  onExportVideo,
  rightPanelWidth = 0,
  isRightPanelOpen = false,
  leftPanelWidth = 0,
  isLeftPanelOpen = false,
  activeTags = [],
  hiddenTags = [],
  allTags = [],
  onToggleTag,
  onToggleHiddenTag,
  onClearTags,
  pinnedTags = [],
  onTogglePinnedTag,
  onViewportYearChange,
  tagColors = {},
  keybinds = {},
  onSetViewMode,
  readOnly = false,
}, ref) {
  const isMac = navigator.userAgent?.includes("Mac");
  const fmtKey = (bind) => {
    if (!bind?.keys?.length) return "";
    return bind.keys.map((k) => k === "Ctrl" ? (isMac ? "Cmd" : "Ctrl") : k === "Alt" ? (isMac ? "Option" : "Alt") : k).join("+");
  };
  const btnTip = (label, bind) => {
    const s = fmtKey(bind);
    return s ? `${label} (${s})` : label;
  };

  const containerRef = useRef(null);
  const timelineRef = useRef(null);
  const gridLabelsRef = useRef(null);
  const scaleRef = useRef(1);
  const translateRef = useRef({ x: 0, y: 0 });
  const prevCalculatedHeightRef = useRef(null);
  const isPanningRef = useRef(false);
  const lastPanPositionRef = useRef({ x: 0, y: 0 });
  const [contextMenu, setContextMenu] = useState(null);
  const [filterMenu, setFilterMenu] = useState(null);
  const [filterModalOpen, setFilterModalOpen] = useState(false);
  const [filterChips, setFilterChips] = useState([]);
  const [filterText, setFilterText] = useState("");
  const [filterDateOp, setFilterDateOp] = useState(">=");
  const [filterDateVal, setFilterDateVal] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [filterHistory, setFilterHistory] = useState(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(FILTER_HISTORY_KEY) ?? "[]");
      return Array.isArray(stored) ? stored.filter((q) => typeof q === "string").slice(0, FILTER_HISTORY_MAX) : [];
    } catch { return []; }
  });
  const filterInputRef = useRef(null);
  const filterQueryRef = useRef("");
  const filterChipIdRef = useRef(0);

  const chipsQuery = useMemo(() => buildChipQuery(filterChips), [filterChips]);
  const parsedChipQuery = useMemo(() => parseFilterQuery(chipsQuery), [chipsQuery]);
  const fullFilterQuery = useMemo(() => {
    const extraTags = activeTags
      .filter((t) => !filterChips.some((c) => c.kind === "tag" && !c.negated && c.value.toLowerCase() === t.toLowerCase()))
      .map((t) => `#${t}`);
    return [chipsQuery, ...extraTags].filter(Boolean).join(" ");
  }, [chipsQuery, filterChips, activeTags]);
  const shownElementCount = useMemo(() => {
    const elements = timelineData?.elements ?? [];
    return parsedChipQuery ? elements.filter((el) => matchesFilter(el, parsedChipQuery)).length : elements.length;
  }, [timelineData?.elements, parsedChipQuery]);
  const hasAnyFilter = filterChips.length > 0 || activeTags.length > 0 || hiddenTags.length > 0;
  const [showMap, setShowMap] = useState(false);
  const mapViewRef = useRef(null);
  const [sliderValue, setSliderValue] = useState(0);
  const [sliderYearLabel, setSliderYearLabel] = useState("");
  const [currentScale, setCurrentScale] = useState(1);
  const [isPlaying, setIsPlaying] = useState(false);
  const filterMenuRef = useRef(null);
  const filterButtonRef = useRef(null);
  const animationFrameRef = useRef(null);
  const lastPlayTimeRef = useRef(null);
  const sliderInputRef = useRef(false);
  const lastViewportYearRef = useRef(null);
  const [mapViewportYear, setMapViewportYear] = useState(null);
  const deferredMapViewportYear = useDeferredValue(mapViewportYear);
  const lastSliderLabelRef = useRef("");
  const sliderRafRef = useRef(null);
  const zoomVelocityRef = useRef(0);
  const zoomMomentumRafRef = useRef(null);
  const zoomMomentumOriginRef = useRef({ x: 0, y: 0 });
  const panVelocityRef = useRef({ x: 0, y: 0 });
  const panMomentumRafRef = useRef(null);
  const pendingSliderValueRef = useRef(null);
  const sliderValueRef = useRef(0);
  const sliderElementRef = useRef(null);
  const yearLabelRef = useRef(null);
  const viewportIndicatorRef = useRef(null);
  const lastGridScaleRef = useRef(null);
  const zoomButtonOffset = isRightPanelOpen ? rightPanelWidth + 20 : 20;
  const sliderOffset = (isLeftPanelOpen ? leftPanelWidth : 0) - (isRightPanelOpen ? rightPanelWidth : 0);

  const publishViewportYear = useCallback((nextYear) => {
    setMapViewportYear((current) => (current === nextYear ? current : nextYear));
    onViewportYearChange?.(nextYear);
  }, [onViewportYearChange]);

  const mapElements = useMemo(() => {
    if (!showMap) return [];
    const hiddenGroupIds = new Set(
      (timelineData?.file?.groups ?? []).filter((g) => g.visible === false).map((g) => g.id)
    );
    return (timelineData?.elements ?? []).filter(
      (el) => (!el.groupId || !hiddenGroupIds.has(el.groupId)) &&
        (!parsedChipQuery || matchesFilter(el, parsedChipQuery))
    );
  }, [showMap, timelineData?.file?.groups, timelineData?.elements, parsedChipQuery]);

  const {
    file,
    groupLayouts,
    spanChildPlacement,
    spanMergePlacement,
    finalSpans,
    finalEvents,
    finalEras,
    PX_PER_YEAR,
    timelineWidth,
    yearToPx,
    calculatedHeight,
    BASE_LINE_Y,
    normalizedScaleSections,
    compressedMin,
    compressedMax,
    TIMELINE_PADDING,
    decompressYear,
    evFontSize,
  } = useMemo(() => {
    const file = timelineData.file;
    const passesQuery = (el) => !parsedChipQuery || matchesFilter(el, parsedChipQuery);
    const events = timelineData.elements.filter(e => e.type === "event" && passesQuery(e));
    const spans = timelineData.elements.filter(e => e.type === "span" && passesQuery(e));
    const eras = timelineData.elements.filter(e => e.type === "era" && passesQuery(e));
    const useCalendar = file?.useCalendar === true;
    const hasDayPrecision = (label) => {
      if (!label || typeof label !== "string") return false;
      const parts = label.split("/").map((part) => part.trim()).filter(Boolean);
      return parts.length === 3;
    };
    const adjustDate = (value, label) => {
      if (!useCalendar) return value;
      if (!Number.isFinite(value)) return value;
      if (hasDayPrecision(label)) return value;
      const scaled = value * 12;
      const isOnMonthGrid = Math.abs(scaled - Math.round(scaled)) < 1e-6;
      if (!isOnMonthGrid) return value;
      return snapToMonthGrid(value);
    };
    const resolveDate = (value, label) => {
      if (!label || typeof label !== "string") {
        return adjustDate(value, label);
      }
      const parsed = parseTimelineInput(label);
      if (Number.isFinite(parsed.value)) {
        return adjustDate(parsed.value, label);
      }
      return adjustDate(value, label);
    };

    const DEFAULT_GROUP = {
      id: "g-main",
      title: "Main",
      order: 0,
      stack: 0,
      visible: true,
      locked: false,
    };
    const DEFAULT_BELOW_GROUP = {
      id: "g-main-below",
      title: "Main (Below)",
      order: 1,
      stack: 1,
      visible: true,
      locked: false,
      belowLine: true,
    };
    const sourceGroups = Array.isArray(file?.groups) && file.groups.length > 0 ? file.groups : [DEFAULT_GROUP];
    let disabledGroupIdMap = null;
    const configuredGroups = (() => {
      if (!file?.disableGroups) return sourceGroups;
      const hasBelowLineSource = sourceGroups.some((g) => g?.belowLine);
      disabledGroupIdMap = new Map(
        sourceGroups.map((g, index) => [
          g?.id || `g-${index}`,
          hasBelowLineSource && g?.belowLine ? DEFAULT_BELOW_GROUP.id : DEFAULT_GROUP.id,
        ])
      );
      return hasBelowLineSource ? [DEFAULT_GROUP, DEFAULT_BELOW_GROUP] : [DEFAULT_GROUP];
    })();
    const groups = configuredGroups.map((group, index) => ({
      ...group,
      id: group?.id || `g-${index}`,
      order: Number.isFinite(group?.order) ? group.order : index,
      stack: Number.isFinite(group?.stack) ? group.stack : index,
      visible: group?.visible !== false,
    }));
    const visibleGroupIds = new Set(
      groups.filter((group) => group.visible !== false).map((group) => group.id)
    );
    const groupIdSet = new Set(groups.map((group) => group.id));
    const defaultGroupId = groups[0]?.id || "g-main";
    const getSafeGroupId = (groupId) => {
      if (disabledGroupIdMap) return disabledGroupIdMap.get(groupId) ?? defaultGroupId;
      return groupIdSet.has(groupId) ? groupId : defaultGroupId;
    };

    const adjustedEvents = events.map((event) => ({
      ...event,
      groupId: getSafeGroupId(event.groupId),
      date: resolveDate(event.date, event.dateLabel),
    }));
    const adjustedSpans = spans.map((span) => ({
      ...span,
      groupId: getSafeGroupId(span.groupId),
      start: resolveDate(span.start, span.startLabel),
      end: resolveDate(span.end, span.endLabel),
    }));
    const visibleAdjustedEvents = adjustedEvents.filter((event) => visibleGroupIds.has(event.groupId));
    const visibleAdjustedSpans = adjustedSpans.filter((span) => visibleGroupIds.has(span.groupId));
    const adjustedEras = eras.map((era) => ({
      ...era,
      start: resolveDate(era.start, era.startLabel),
      end: resolveDate(era.end, era.endLabel),
    }));

    const allYears = [
      ...adjustedEvents.map((e) => e.date),
      ...adjustedSpans.flatMap((s) => [s.start, s.end]),
      ...adjustedEras.flatMap((e) => [e.start, e.end]),
    ];

    const rawMin = Math.min(...allYears);
    const rawMax = Math.max(...allYears);

    const minYear = file?.start ?? rawMin;
    const maxYear = file?.end ?? rawMax;

    const parseScaleValue = (value) => {
      if (typeof value === "number") return value;
      if (typeof value === "string") {
        const parsed = parseTimelineInput(value);
        return Number.isFinite(parsed.value) ? parsed.value : null;
      }
      return null;
    };

    const normalizeScaleSections = (sections, legacyBreaks, min, max) => {
      // Support old breaks format as scale=0 sections
      let raw = Array.isArray(sections) && sections.length > 0
        ? sections
        : Array.isArray(legacyBreaks) && legacyBreaks.length > 0
          ? legacyBreaks.map((b) => ({ ...b, scale: 0 }))
          : [];
      if (raw.length === 0) return [];

      const cleaned = raw
        .map((item) => {
          const startRaw = parseScaleValue(item?.start);
          const endRaw = parseScaleValue(item?.end);
          if (!Number.isFinite(startRaw) || !Number.isFinite(endRaw)) return null;
          const start = Math.min(startRaw, endRaw);
          const end = Math.max(startRaw, endRaw);
          if (start === end) return null;
          const clippedStart = Math.max(min, start);
          const clippedEnd = Math.min(max, end);
          if (clippedEnd <= clippedStart) return null;
          const scale = Math.max(0, Math.min(2, Number(item?.scale) || 0));
          return { start: clippedStart, end: clippedEnd, scale, showBreak: item?.showBreak !== false };
        })
        .filter(Boolean)
        .sort((a, b) => a.start - b.start);

      // Merge overlapping sections with the same scale
      const merged = [];
      cleaned.forEach((current) => {
        const last = merged[merged.length - 1];
        if (!last || current.start > last.end || current.scale !== last.scale) {
          merged.push({ ...current });
        } else {
          last.end = Math.max(last.end, current.end);
        }
      });
      return merged;
    };

    const isLogScale = (file?.scaleType || "default") === "logarithmic";
    const logFactor = Math.max(1, Number(file?.logScaleFactor) || 10);
    const logSpan = maxYear - minYear;

    const normalizedScaleSections = isLogScale
      ? []
      : normalizeScaleSections(file?.scaleSections, file?.breaks, minYear, maxYear);

    const compressYear = (year) => {
      if (isLogScale) {
        if (logSpan <= 0) return year;
        const t = (year - minYear) / logSpan;
        return minYear + logSpan * (1 - Math.log1p(logFactor * (1 - t)) / Math.log1p(logFactor));
      }
      let adjustment = 0;
      for (const section of normalizedScaleSections) {
        const duration = section.end - section.start;
        if (year >= section.end) {
          adjustment += duration * (1 - section.scale);
          continue;
        }
        if (year > section.start) {
          const partial = year - section.start;
          return year - adjustment - partial * (1 - section.scale);
        }
        break;
      }
      return year - adjustment;
    };

    const compressedMin = compressYear(minYear);
    const compressedMax = compressYear(maxYear);
    const range = Math.max(1e-9, compressedMax - compressedMin);

    const decompressYear = (compressedYear) => {
      if (isLogScale) {
        if (logSpan <= 0) return compressedYear;
        const u = (compressedYear - minYear) / logSpan;
        return minYear + logSpan * (1 - (Math.pow(1 + logFactor, 1 - u) - 1) / logFactor);
      }
      let adjustment = 0;
      for (const section of normalizedScaleSections) {
        const duration = section.end - section.start;
        const sectionStartCompressed = section.start - adjustment;
        const sectionCompressedWidth = duration * section.scale;
        if (compressedYear >= sectionStartCompressed + sectionCompressedWidth) {
          adjustment += duration * (1 - section.scale);
          continue;
        }
        if (compressedYear > sectionStartCompressed) {
          const offset = compressedYear - sectionStartCompressed;
          return section.start + (section.scale > 0 ? offset / section.scale : 0);
        }
        break;
      }
      return compressedYear + adjustment;
    };

    // Calculate detail level automatically based on range
    // The detailLevel setting will be used as a multiplier later
    const baseDetailLevel = calculateDetailLevel(range);
    const detailMultiplier = file?.detailLevel ?? 1;
    const PX_PER_YEAR = baseDetailLevel * detailMultiplier;
    const TIMELINE_PADDING = 200; // px padding on each end
    const timelineWidth = range * PX_PER_YEAR + (TIMELINE_PADDING * 2);

    const yearToPx = (year) =>
      (compressYear(year) - compressedMin) * PX_PER_YEAR + TIMELINE_PADDING;

    if (showMap) {
      return {
        file,
        groupLayouts: [],
        spanChildPlacement: {},
        spanMergePlacement: {},
        finalSpans: [],
        finalEvents: [],
        finalEras: [],
        PX_PER_YEAR,
        timelineWidth,
        yearToPx,
        calculatedHeight: 1000,
        BASE_LINE_Y: 500,
        normalizedScaleSections,
        compressedMin,
        compressedMax,
        TIMELINE_PADDING,
        decompressYear,
      };
    }

    // spans
    const SPAN_HEIGHT = 23;
    const hasBelowLineGroups = groups.some((g) => g.visible !== false && g.belowLine);
    const SPAN_OFFSET = hasBelowLineGroups ? 34 : 14;
    const SPAN_GAP = 6;
    const SPAN_VERTICAL_GAP = 2;

    // events
    let evWidth = file?.eventWidth;
    let evFontSize = file?.eventFontSize;
    if (evWidth == null && file?.compactEvents) { evWidth = 130; evFontSize = 7; }
    evWidth = evWidth ?? 150;
    evFontSize = evFontSize ?? 10;
    const evHeight = Math.round(evWidth / 6);

    const paddingV = Math.max(2, Math.round(evHeight * 0.08));
    const paddingH = Math.round(evWidth * 0.053);
    const evBorderRadius = Math.round(evWidth * 0.053);
    const noYearHeight = Math.max(10, evHeight - 9);
    const evDateFontSize = Math.max(6, evFontSize - 1);
    const evTagFontSize = Math.max(5, evFontSize - 2);
    const evTagPad = Math.round(evFontSize * 0.6);
    const evDateGap = Math.max(2, Math.round(evFontSize * 0.4));
    const evTileWidth = Math.round(evWidth * 0.193);
    const evBannerHeight = Math.round(evWidth * 0.32);

    const root = document.documentElement;
    root.style.setProperty('--event-width', `${evWidth}px`);
    root.style.setProperty('--event-height', `${evHeight}px`);
    root.style.setProperty('--event-height-noyear', `${noYearHeight}px`);
    root.style.setProperty('--event-pad-v', `${paddingV}px`);
    root.style.setProperty('--event-pad-h', `${paddingH}px`);
    root.style.setProperty('--event-radius', `${evBorderRadius}px`);
    root.style.setProperty('--event-font-size', `${evFontSize}px`);
    root.style.setProperty('--event-date-font-size', `${evDateFontSize}px`);
    root.style.setProperty('--event-date-gap', `${evDateGap}px`);
    root.style.setProperty('--event-tag-font-size', `${evTagFontSize}px`);
    root.style.setProperty('--event-tag-pad', `${evTagPad}px`);
    root.style.setProperty('--event-tile-width', `${evTileWidth}px`);
    root.style.setProperty('--event-banner-height', `${evBannerHeight}px`);
    root.style.setProperty('--event-font-scale', `${evFontSize / 10}`);

    const EVENT_WIDTH = evWidth + 10;
    const EVENT_GAP = 15;
    const LANE_SPACING = evHeight + paddingV * 2 + 4 + 4;
    const BOX_OFFSET = 50;
    const EVENT_MIN_HEIGHT = 29;

    // eras
    const ERA_OFFSET = 34;
    const ERA_BAND_HEIGHT = 27; // must match .era-item height so fill/stack math lines up exactly

    // Resolve the font for event measurement (file.font overrides theme/default)
    const fileFontSetting = file.font;
    const fallbackFont = '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    let resolvedFont;
    if (fileFontSetting && String(fileFontSetting).toLowerCase() !== "default") {
      const safeName = String(fileFontSetting).replace(/([\\"])/g, "\\$1");
      resolvedFont = `"${safeName}", ${fallbackFont}`;
    } else {
      resolvedFont = getComputedStyle(document.documentElement).getPropertyValue("--app-font-family").trim() || fallbackFont;
    }

    const groupsByStack = groups
      .filter((group) => group.visible !== false)
      .sort((a, b) => {
      const stackDiff = (a.stack ?? 0) - (b.stack ?? 0); // bottom -> top
      if (stackDiff !== 0) return stackDiff;
      return (a.order ?? 0) - (b.order ?? 0);
    });
    const globalSpanChildPlacement = buildSpanChildPlacement(
      visibleAdjustedSpans,
      timelineData?.file?.branchOrdering || "later-first"
    );
    const globalSpanMergePlacement = buildSpanMergePlacement(visibleAdjustedSpans);

    // First pass: calculate with temporary BASE_LINE_Y to determine content extent
    const TEMP_BASE_LINE_Y = 500;
    const interGroupGap = 14;
    const GROUP_BAND_PADDING_Y = 8;
    const EMPTY_GROUP_HEIGHT = EVENT_MIN_HEIGHT;
    const tempGroupLayoutsRaw = groupsByStack.map((group, index) => {
      const spansInGroup = visibleAdjustedSpans.filter((span) => span.groupId === group.id);
      const eventsInGroup = visibleAdjustedEvents.filter((event) => event.groupId === group.id);
      const spanIdsInGroup = new Set(spansInGroup.map((span) => span.id));
      const groupSpanChildPlacement = Object.fromEntries(
        Object.entries(globalSpanChildPlacement).filter(
          ([childId, placement]) => spanIdsInGroup.has(childId) && spanIdsInGroup.has(placement.parentId)
        )
      );
      const groupSpanMergePlacement = Object.fromEntries(
        Object.entries(globalSpanMergePlacement).filter(
          ([childId, placement]) => spanIdsInGroup.has(childId) && spanIdsInGroup.has(placement.parentId)
        )
      );

      const isBelowLine = group.belowLine === true;
      const { finalSpans: tempSpans, spanLaneEnds } = layoutSpans({
        spans: spansInGroup,
        yearToPx,
        BASE_LINE_Y: TEMP_BASE_LINE_Y,
        SPAN_HEIGHT,
        SPAN_OFFSET,
        SPAN_GAP,
        SPAN_VERTICAL_GAP,
        spanChildPlacement: groupSpanChildPlacement,
        timelineStart: file.start,
        timelineEnd: file.end,
        belowLine: isBelowLine,
      });
      const spanBandHeight = calcSpanBandHeight(
        spanLaneEnds.length,
        SPAN_OFFSET,
        SPAN_HEIGHT,
        SPAN_VERTICAL_GAP
      );
      const tempEvents = layoutEvents({
        events: eventsInGroup,
        yearToPx,
        BASE_LINE_Y: TEMP_BASE_LINE_Y,
        spanBandHeight,
        EVENT_WIDTH,
        EVENT_GAP,
        LANE_SPACING,
        BOX_OFFSET,
        fixedEventHeight: Boolean(file.fixedEventHeight),
        eventWidth: evWidth,
        eventFontSize: evFontSize,
        fontFamily: resolvedFont,
        pinnedTags,
        negID: file.negID,
        posID: file.posID,
        useCalendar: useCalendar,
        hideDecimals: file.hideDecimals,
        belowLine: isBelowLine,
      });
      const spanBottoms = tempSpans.map((span) => span.top + (span.spanHeight ?? 20));
      const eventBottoms = tempEvents.map((event) => event.top + (event._boxHeight || 29));
      const itemTops = [...tempSpans.map((span) => span.top), ...tempEvents.map((event) => event.top)];
      const itemBottoms = [...spanBottoms, ...eventBottoms];
      const hasItems = itemTops.length > 0 && itemBottoms.length > 0;
      const contentTop = hasItems
        ? Math.min(...itemTops)
        : isBelowLine ? TEMP_BASE_LINE_Y + 20 : TEMP_BASE_LINE_Y - (EMPTY_GROUP_HEIGHT + 20);
      const contentBottom = hasItems
        ? Math.max(...itemBottoms)
        : isBelowLine ? TEMP_BASE_LINE_Y + EMPTY_GROUP_HEIGHT + 20 : TEMP_BASE_LINE_Y - 20;
      const contentHeight = hasItems
        ? Math.max(EVENT_MIN_HEIGHT, (contentBottom - contentTop) + GROUP_BAND_PADDING_Y * 2)
        : EMPTY_GROUP_HEIGHT;

      return {
        id: group.id,
        title: group.title || group.id,
        order: group.order,
        stack: group.stack,
        bgColor: group.bgColor,
        hideBand: Boolean(group.hideBand),
        visible: group.visible !== false,
        belowLine: isBelowLine,
        yOffset: 0,
        index,
        spansInGroup,
        eventsInGroup,
        spanBandHeight,
        spanChildPlacement: groupSpanChildPlacement,
        spanMergePlacement: groupSpanMergePlacement,
        hasItems,
        contentTop,
        contentBottom,
        contentHeight,
      };
    });

    const aboveLineRaw = tempGroupLayoutsRaw.filter((g) => !g.belowLine);
    const belowLineRaw = tempGroupLayoutsRaw.filter((g) => g.belowLine);

    let cumulativeAbove = 0;
    const aboveLineLayouts = aboveLineRaw.map((group) => {
      const next = {
        ...group,
        yOffset: -cumulativeAbove,
        topExtent: group.contentTop - cumulativeAbove,
      };
      cumulativeAbove += group.contentHeight + interGroupGap;
      return next;
    });

    let cumulativeBelow = 0;
    const belowLineLayouts = belowLineRaw.map((group) => {
      const next = {
        ...group,
        yOffset: +cumulativeBelow,
        bottomExtent: group.contentBottom + cumulativeBelow,
      };
      cumulativeBelow += group.contentHeight + interGroupGap;
      return next;
    });

    const tempGroupLayouts = [...aboveLineLayouts, ...belowLineLayouts]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    // Calculate dynamic timeline height based on temporary layout
    const aboveLineTopExtents = aboveLineLayouts.map((g) => g.topExtent).filter(Number.isFinite);
    const maxGroupTop = aboveLineTopExtents.length > 0
      ? Math.min(...aboveLineTopExtents)
      : TEMP_BASE_LINE_Y;
    const tempEraTop = TEMP_BASE_LINE_Y + ERA_OFFSET;
    const maxEraTop = eras.length > 0 ? tempEraTop : TEMP_BASE_LINE_Y;

    const topExtent = Math.min(maxGroupTop, maxEraTop);
    const aboveBaseline = TEMP_BASE_LINE_Y - topExtent;
    const ERA_GAP = 0;
    const eraOffsets = assignEraLanes(adjustedEras, ERA_BAND_HEIGHT, ERA_GAP);
    const maxEraBottom = adjustedEras.length > 0
      ? Math.max(...adjustedEras.map((era) => {
          const sizeMultiplier = era.eraSize === "extra-thick" ? 3 : era.eraSize === "thick" ? 2 : 1;
          return (eraOffsets.get(era.id) ?? 0) + ERA_BAND_HEIGHT * sizeMultiplier;
        }))
      : 0;

    const belowLineBottomExtents = belowLineLayouts.map((g) => g.bottomExtent).filter(Number.isFinite);
    const belowLineGroupsExtent = belowLineBottomExtents.length > 0
      ? Math.max(...belowLineBottomExtents) - TEMP_BASE_LINE_Y
      : 0;

    const eraSpace = adjustedEras.length > 0
      ? ERA_OFFSET + maxEraBottom + 8
      : 0;
    const belowBaseline = belowLineGroupsExtent + eraSpace
      + (belowLineGroupsExtent === 0 && eraSpace === 0 ? 30 : 0);

    const calculatedHeight = aboveBaseline + belowBaseline;
    const BASE_LINE_Y = calculatedHeight;

    const groupLayoutsRaw = tempGroupLayouts.map((group) => {
      const { finalSpans: rawFinalSpans } = layoutSpans({
        spans: group.spansInGroup,
        yearToPx,
        BASE_LINE_Y,
        SPAN_HEIGHT,
        SPAN_OFFSET,
        SPAN_GAP,
        SPAN_VERTICAL_GAP,
        spanChildPlacement: group.spanChildPlacement,
        timelineStart: file.start,
        timelineEnd: file.end,
        belowLine: group.belowLine,
      });

      const rawFinalEvents = layoutEvents({
        events: group.eventsInGroup,
        yearToPx,
        BASE_LINE_Y,
        spanBandHeight: group.spanBandHeight,
        EVENT_WIDTH,
        EVENT_GAP,
        LANE_SPACING,
        BOX_OFFSET,
        fixedEventHeight: Boolean(file.fixedEventHeight),
        eventWidth: evWidth,
        eventFontSize: evFontSize,
        fontFamily: resolvedFont,
        pinnedTags,
        negID: file.negID,
        posID: file.posID,
        useCalendar: useCalendar,
        hideDecimals: file.hideDecimals,
        belowLine: group.belowLine,
      });

      const finalSpans = rawFinalSpans.map((span) => ({
        ...span,
        groupId: group.id,
        top: span.top + group.yOffset,
      }));
      const finalEvents = rawFinalEvents.map((event) => ({
        ...event,
        groupId: group.id,
        top: event.top + group.yOffset,
      }));

      return {
        ...group,
        finalSpans,
        finalEvents,
      };
    });

    const getGroupExtent = (group) => {
      const MIN_GROUP_BAND_HEIGHT = EVENT_MIN_HEIGHT;
      const tops = [
        ...group.finalSpans.map((span) => span.top),
        ...group.finalEvents.map((event) => event.top),
      ];
      const bottoms = [
        ...group.finalSpans.map((span) => span.top + (span.spanHeight ?? 20)),
        ...group.finalEvents.map((event) => event.top + (event._boxHeight || 29)),
      ];
      if (tops.length === 0 || bottoms.length === 0) {
        const center = group.belowLine
          ? BASE_LINE_Y + group.yOffset + 20
          : BASE_LINE_Y + group.yOffset - 20;
        const half = Math.round(EVENT_MIN_HEIGHT / 2);
        return { top: center - half, bottom: center + half };
      }
      const rawTop = Math.min(...tops) - GROUP_BAND_PADDING_Y;
      const rawBottom = Math.max(...bottoms) + GROUP_BAND_PADDING_Y;
      const rawHeight = Math.max(1, rawBottom - rawTop);
      if (rawHeight >= MIN_GROUP_BAND_HEIGHT) {
        return { top: rawTop, bottom: rawBottom };
      }
      const extra = MIN_GROUP_BAND_HEIGHT - rawHeight;
      return {
        top: rawTop - extra / 2,
        bottom: rawBottom + extra / 2,
      };
    };

    const stackSort = (a, b) => {
      const stackDiff = (a.stack ?? 0) - (b.stack ?? 0);
      if (stackDiff !== 0) return stackDiff;
      return (a.order ?? 0) - (b.order ?? 0);
    };
    const aboveByStack = groupLayoutsRaw.filter((g) => !g.belowLine).sort(stackSort);
    const belowByStack = groupLayoutsRaw.filter((g) => g.belowLine).sort(stackSort);

    const extentById = new Map(
      groupLayoutsRaw.map((group) => [group.id, getGroupExtent(group)])
    );

    const shiftGroup = (group, delta) => {
      group.yOffset += delta;
      group.finalSpans = group.finalSpans.map((span) => ({ ...span, top: span.top + delta }));
      group.finalEvents = group.finalEvents.map((event) => ({ ...event, top: event.top + delta }));
      const ext = extentById.get(group.id);
      if (ext) extentById.set(group.id, { top: ext.top + delta, bottom: ext.bottom + delta });
    };

    // Above-line: push higher-stack groups upward to avoid overlap
    for (let i = 1; i < aboveByStack.length; i += 1) {
      const lowerGroup = aboveByStack[i - 1];
      const upperGroup = aboveByStack[i];
      const lowerExtent = extentById.get(lowerGroup.id);
      const upperExtent = extentById.get(upperGroup.id);
      if (!lowerExtent || !upperExtent) continue;
      const maxUpperBottom = lowerExtent.top - interGroupGap;
      if (upperExtent.bottom > maxUpperBottom) {
        shiftGroup(upperGroup, -(upperExtent.bottom - maxUpperBottom));
      }
    }

    // Below-line: push higher-index groups downward to avoid overlap
    for (let i = 1; i < belowByStack.length; i += 1) {
      const upperGroup = belowByStack[i - 1];
      const lowerGroup = belowByStack[i];
      const upperExtent = extentById.get(upperGroup.id);
      const lowerExtent = extentById.get(lowerGroup.id);
      if (!upperExtent || !lowerExtent) continue;
      const minLowerTop = upperExtent.bottom + interGroupGap;
      if (lowerExtent.top < minLowerTop) {
        shiftGroup(lowerGroup, minLowerTop - lowerExtent.top);
      }
    }

    const groupLayoutsByStack = [...aboveByStack, ...belowByStack];
    groupLayoutsByStack.forEach((group) => {
      const extent = extentById.get(group.id);
      group.extentTop = extent?.top;
      group.extentBottom = extent?.bottom;
    });

    const groupLayouts = [...groupLayoutsByStack].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const spanChildPlacement = globalSpanChildPlacement;
    const spanMergePlacement = globalSpanMergePlacement;
    const finalSpans = [];
    const finalEvents = [];
    groupLayouts.forEach((group) => {
      finalSpans.push(...group.finalSpans);
      finalEvents.push(...group.finalEvents);
    });

    const tlStartPx = file.start != null ? yearToPx(file.start) : null;
    const tlEndPx = file.end != null ? yearToPx(file.end) : null;
    const ERA_FUZZ = 24; 
    const finalEras = adjustedEras.map((era) => {
      const rawLeft = yearToPx(era.start);
      const rawRight = yearToPx(era.end);
      const clampedLeft = tlStartPx != null ? Math.max(rawLeft, tlStartPx) : rawLeft;
      const clampedRight = tlEndPx != null ? Math.min(rawRight, tlEndPx) : rawRight;
      const laneOffset = eraOffsets.get(era.id) ?? 0;
      const sizeMultiplier = era.eraSize === "extra-thick" ? 3 : era.eraSize === "thick" ? 2 : 1;
      const top = Math.floor(BASE_LINE_Y + belowLineGroupsExtent + ERA_OFFSET + laneOffset);
      const left = Math.floor(clampedLeft);
      const width = Math.ceil(clampedRight) - left;
      const height = ERA_BAND_HEIGHT * sizeMultiplier;
      const fuzzStart = era.fuzzyStart === true && clampedLeft === rawLeft ? ERA_FUZZ : 0;
      const fuzzEnd = era.fuzzyEnd === true && clampedRight === rawRight ? ERA_FUZZ : 0;
      let fuzz = null;
      if (fuzzStart || fuzzEnd) {
        const fuzzWidth = width + fuzzStart + fuzzEnd;
        let fadeInPx = fuzzStart * 2;
        let fadeOutPx = fuzzEnd * 2;
        if (fadeInPx + fadeOutPx > fuzzWidth) {
          const scale = fuzzWidth / (fadeInPx + fadeOutPx);
          fadeInPx *= scale;
          fadeOutPx *= scale;
        }
        fuzz = { left: left - fuzzStart, width: fuzzWidth, fadeInPx, fadeOutPx };
      }
      return {
        ...era,
        height,
        left,
        width,
        top,
        fuzz,
      };
    }).filter((era) => era.width > 0);
    // abutting fuzzy edges: keep the earlier era solid under the later one's fade-in so the crossfade stays opaque
    for (const era of finalEras) {
      if (!era.fuzz?.fadeOutPx) continue;
      const endPx = yearToPx(era.end);
      const next = finalEras.find((o) => o !== era && o.fuzz?.fadeInPx > 0
        && Math.abs(yearToPx(o.start) - endPx) < 0.5
        && (eraOffsets.get(o.id) ?? 0) === (eraOffsets.get(era.id) ?? 0));
      if (next) era.fuzz.fadeOutPx = 0;
    }
    // later fuzz layers paint on top so fade-ins blend over the solid underlap
    finalEras.sort((a, b) => a.start - b.start);

    return {
      file,
      groupLayouts,
      spanChildPlacement,
      spanMergePlacement,
      finalSpans,
      finalEvents,
      finalEras,
      PX_PER_YEAR,
      timelineWidth,
      yearToPx,
      calculatedHeight,
      BASE_LINE_Y,
      normalizedScaleSections,
      compressedMin,
      compressedMax,
      TIMELINE_PADDING,
      decompressYear,
      evFontSize,
    };
  }, [timelineData, pinnedTags, showMap, parsedChipQuery]);

  const ticks = useMemo(() => {
    const minYear = file?.start;
    const maxYear = file?.end;
    if (!Number.isFinite(minYear) || !Number.isFinite(maxYear) || maxYear < minYear) {
      return [];
    }

    const nextTicks = [];
    const safeScale = Math.max(currentScale, 0.01);
    const screenPxPerYear = PX_PER_YEAR * safeScale;
    const screenPxPerMonth = screenPxPerYear / 12;
    const screenPxPerDay = screenPxPerYear / 365.2425;
    const useCalendar = file?.useCalendar === true && minYear >= 0 && maxYear <= 9999;
    const tickDensityMult = Math.max(0.01, file?.tickDensity ?? 1);
    const targetTickPx = 24 / tickDensityMult;
    const targetDayTickPx = 72 / tickDensityMult;
    const targetMonthTickPx = 96 / tickDensityMult;
    const targetYearTickPx = useCalendar ? targetTickPx : 96 / tickDensityMult;
    const maxDayInterval = 7;
    const epsilon = 1e-6;
    const visibleSegments = [];
    let cursor = minYear;
    normalizedScaleSections.forEach((section) => {
      const start = Math.max(minYear, section.start);
      const end = Math.min(maxYear, section.end);
      if (end <= start + epsilon) return;
      if (cursor < start - epsilon) {
        visibleSegments.push({ start: cursor, end: start, scale: 1 });
      }
      visibleSegments.push({ start, end, scale: section.scale });
      cursor = Math.max(cursor, end);
    });
    if (cursor < maxYear - epsilon) {
      visibleSegments.push({ start: cursor, end: maxYear, scale: 1 });
    }
    if (visibleSegments.length === 0) {
      visibleSegments.push({ start: minYear, end: maxYear, scale: 1 });
    }

    const pushTick = (tick) => {
      const value = Number(tick.value);
      if (!Number.isFinite(value) || value < minYear - epsilon || value > maxYear + epsilon) return;
      const normalizedValue = Number(value.toFixed(9));
      const last = nextTicks[nextTicks.length - 1];
      if (last && Math.abs(last.value - normalizedValue) < 1e-6) return;
      nextTicks.push({ ...tick, value: normalizedValue });
    };

    if (file?.scaleType === "logarithmic") {
      const lf = Math.max(1, Number(file?.logScaleFactor) || 10);
      const ls = maxYear - minYear;
      const logDecompress = (c) => {
        if (ls <= 0) return c;
        const u = (c - minYear) / ls;
        return minYear + ls * (1 - (Math.pow(1 + lf, 1 - u) - 1) / lf);
      };
      const compFineStep = targetYearTickPx / Math.max(PX_PER_YEAR * safeScale, 1e-9) / 10;
      for (let compPos = minYear; compPos <= maxYear + epsilon; compPos += compFineStep) {
        const clampedComp = Math.min(compPos, maxYear);
        const realYear = logDecompress(clampedComp);
        const absYear = Math.max(Math.abs(realYear), 1);
        const magnitude = Math.floor(Math.log10(absYear));
        const roundTo = Math.pow(10, Math.max(0, magnitude - 2));
        const niceTick = Math.round(realYear / roundTo) * roundTo;
        pushTick({ value: niceTick });
      }
      nextTicks.sort((a, b) => a.value - b.value);
      return nextTicks;
    }

    for (const segment of visibleSegments) {
      if (segment.scale <= 0) continue;
      const localScreenPxPerYear = screenPxPerYear * segment.scale;
      const localScreenPxPerMonth = screenPxPerMonth * segment.scale;
      const localScreenPxPerDay = screenPxPerDay * segment.scale;

      if (useCalendar) {
        const dayInterval = Math.max(1, Math.ceil(targetDayTickPx / Math.max(localScreenPxPerDay, 0.000001)));
        if (dayInterval <= maxDayInterval) {
          const start = fractionalYearToDate(segment.start);
          const dateCursor = new Date(Date.UTC(start.year, start.month - 1, start.day));
          for (let i = 0; i < 5000; i += 1) {
            const y = dateCursor.getUTCFullYear();
            const m = dateCursor.getUTCMonth() + 1;
            const d = dateCursor.getUTCDate();
            const value = y + (m - 1) / 12 + (d - 1) / (daysInMonth(y, m) * 12);
            if (value > segment.end + epsilon) break;
            if (value >= segment.start - epsilon) {
              pushTick({ value, label: `${MONTH_LABELS[m - 1]} ${d}` });
            }
            dateCursor.setUTCDate(dateCursor.getUTCDate() + dayInterval);
          }
          continue;
        }

        const monthInterval = Math.max(1, Math.ceil(targetMonthTickPx / Math.max(localScreenPxPerMonth, 0.000001)));
        if (monthInterval <= 12) {
          const start = fractionalYearToDate(segment.start);
          const end = fractionalYearToDate(segment.end);
          const startAbsMonth = start.year * 12 + (start.month - 1);
          const endAbsMonth = end.year * 12 + (end.month - 1);
          for (let absMonth = startAbsMonth; absMonth <= endAbsMonth; absMonth += monthInterval) {
            const y = Math.floor(absMonth / 12);
            const monthIndex = absMonth % 12;
            const value = y + monthIndex / 12;
            if (value < segment.start - epsilon || value > segment.end + epsilon) continue;
            pushTick({ value, label: `${MONTH_LABELS[monthIndex]} ${y}` });
          }
          continue;
        }
      }

      let step = pickStep(targetYearTickPx / Math.max(localScreenPxPerYear, 0.000001));
      if (Math.max(Math.abs(minYear), Math.abs(maxYear)) >= 100) step = Math.max(1, step);
      const startTick = Math.ceil(segment.start / step) * step;
      for (let y = startTick; y <= segment.end + epsilon; y += step) {
        if (y < segment.start - epsilon || y > segment.end + epsilon) continue;
        pushTick({ value: y });
      }
    }

    nextTicks.sort((a, b) => a.value - b.value);
    return nextTicks;
  }, [file, PX_PER_YEAR, currentScale, normalizedScaleSections]);

  const finalSpanById = useMemo(
    () => new Map(finalSpans.map((span) => [span.id, span])),
    [finalSpans]
  );
  const groupLayoutById = useMemo(
    () => new Map(groupLayouts.map((group) => [group.id, group])),
    [groupLayouts]
  );
  const extensionParentRoundedSet = useMemo(() => {
    const ids = new Set();
    finalSpans.forEach((childSpan) => {
      const placement = spanChildPlacement[childSpan.id];
      if (!placement || placement.mode !== "extend") return;
      const parentSpan = finalSpanById.get(placement.parentId);
      if (!parentSpan) return;
      const childH = childSpan.spanHeight ?? 20;
      const parentH = parentSpan.spanHeight ?? 20;
      const parentIsLarger = parentH > childH + 0.1;
      if (parentIsLarger && parentSpan.spanSize !== "thin") {
        ids.add(parentSpan.id);
      }
    });
    return ids;
  }, [finalSpans, spanChildPlacement, finalSpanById]);
  const spanRenderTopById = useMemo(() => {
    const tops = new Map(finalSpans.map((span) => [span.id, span.top]));
    const adjacency = new Map();
    finalSpans.forEach((span) => adjacency.set(span.id, new Set()));
    finalSpans.forEach((span) => {
      const placement = spanChildPlacement[span.id];
      if (!placement || placement.mode !== "extend") return;
      const parentId = placement.parentId;
      if (!adjacency.has(parentId)) return;
      adjacency.get(span.id)?.add(parentId);
      adjacency.get(parentId)?.add(span.id);
    });

    const visited = new Set();
    finalSpans.forEach((startSpan) => {
      if (visited.has(startSpan.id)) return;
      const stack = [startSpan.id];
      const componentIds = [];
      while (stack.length > 0) {
        const id = stack.pop();
        if (!id || visited.has(id)) continue;
        visited.add(id);
        componentIds.push(id);
        adjacency.get(id)?.forEach((nextId) => {
          if (!visited.has(nextId)) stack.push(nextId);
        });
      }
      if (componentIds.length <= 1) return;

      const componentSpans = componentIds
        .map((id) => finalSpanById.get(id))
        .filter(Boolean);
      if (componentSpans.length <= 1) return;

      // Keep the largest span fixed in its lane; center smaller spans around it.
      const anchor = componentSpans.reduce((best, current) => {
        const bestH = best?.spanHeight ?? 20;
        const currentH = current?.spanHeight ?? 20;
        return currentH > bestH ? current : best;
      }, componentSpans[0]);
      const anchorH = anchor?.spanHeight ?? 20;
      const anchorTop = tops.get(anchor.id) ?? anchor.top;
      const anchorCenter = anchorTop + anchorH / 2;

      componentSpans.forEach((span) => {
        const spanH = span.spanHeight ?? 20;
        if (span.id === anchor.id || spanH >= anchorH - 0.1) {
          tops.set(span.id, span.top);
          return;
        }
        tops.set(span.id, anchorCenter - spanH / 2);
      });
    });

    return tops;
  }, [finalSpans, spanChildPlacement, finalSpanById]);
  const groupBandBoxes = useMemo(() => {
    return groupLayouts.map((group) => {
      if (Number.isFinite(group.extentTop) && Number.isFinite(group.extentBottom)) {
        const top = Math.max(0, group.extentTop);
        const height = Math.max(1, group.extentBottom - group.extentTop);
        return {
          groupId: group.id,
          top,
          height,
        };
      }

      const fallbackHeight = 29;
      const centerY = BASE_LINE_Y + group.yOffset - 28;
      const top = Math.max(0, centerY - Math.round(fallbackHeight * 0.58));
      return {
        groupId: group.id,
        top,
        height: fallbackHeight,
      };
    });
  }, [groupLayouts, BASE_LINE_Y]);
  const groupBandBottomById = useMemo(() => {
    const map = new Map();
    groupBandBoxes.forEach((box) => {
      if (!box?.groupId) return;
      map.set(box.groupId, box.top + box.height);
    });
    return map;
  }, [groupBandBoxes]);
  const renderLegacyLayers = file?.debugLegacyLayers === true;

  useLayoutEffect(() => {
    const timelineEl = timelineRef.current;
    if (!timelineEl) return;
    const spanNodes = timelineEl.querySelectorAll(".span-item");
    spanNodes.forEach((spanNode) => {
      // Measure with years visible so the decision is consistent.
      spanNode.classList.remove("hide-span-years");
      const titleNode = spanNode.querySelector(".span-title");
      const yearsNode = spanNode.querySelector(".span-years");
      if (!titleNode || !yearsNode) return;
      const isTitleTruncated = titleNode.scrollWidth - titleNode.clientWidth > 1;
      spanNode.classList.toggle("hide-span-years", isTitleTruncated);
    });
  }, [
    finalSpans,
    groupLayouts,
    renderLegacyLayers,
    selectedId,
    file?.useCalendar,
    file?.hideDecimals,
    file?.negID,
    file?.posID,
  ]);

  // Notify parent of height changes
  useEffect(() => {
    if (onHeightChange) {
      onHeightChange(calculatedHeight);
    }
  }, [calculatedHeight, onHeightChange]);

  useEffect(() => {
    // Skip during animation - year label is updated directly via DOM
    if (isPlaying) return;

    const container = containerRef.current;
    if (!container) return;
    const scale = scaleRef.current;
    const { maxX, range } = getPanBounds(container);
    const panPosition = maxX - (sliderValue / 100) * range;
    const viewportWidth = container.clientWidth;
    const centerPx = -panPosition + viewportWidth / 2;
    const timelineX = centerPx / scale;
    const compressedYear =
      (timelineX - TIMELINE_PADDING) / PX_PER_YEAR + compressedMin;
    const clampedCompressed = Math.min(
      Math.max(compressedYear, compressedMin),
      compressedMax
    );
    const rawYear = decompressYear(clampedCompressed);
    const showCalendar = file?.useCalendar === true;
    const snappedYear = showCalendar ? snapToDayGrid(rawYear) : Math.round(rawYear);
    if (snappedYear !== lastViewportYearRef.current) {
      lastViewportYearRef.current = snappedYear;
      publishViewportYear(snappedYear);
    }
    const nextLabel = formatYear(snappedYear, file.negID, file.posID, showCalendar, file.hideDecimals);
    if (nextLabel !== lastSliderLabelRef.current) {
      lastSliderLabelRef.current = nextLabel;
      setSliderYearLabel(nextLabel);
    }
  }, [
    sliderValue,
    isPlaying,
    currentScale,
    timelineWidth,
    PX_PER_YEAR,
    compressedMin,
    compressedMax,
    TIMELINE_PADDING,
    decompressYear,
    file,
    publishViewportYear,
  ]);

  // Keep the timeline anchored when height changes
  useLayoutEffect(() => {
    const prev = prevCalculatedHeightRef.current;
    if (prev !== null && prev !== calculatedHeight) {
      const scale = scaleRef.current;
      translateRef.current.y += (prev - calculatedHeight) * scale;
      applyTransform();
    }
    prevCalculatedHeightRef.current = calculatedHeight;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calculatedHeight]);

  const applyTransform = ({ skipLabels = false } = {}) => {
    const timelineEl = timelineRef.current;
    if (!timelineEl) return;

    const { x, y } = translateRef.current;
    const scale = scaleRef.current;
    timelineEl.style.transformOrigin = "0 0";
    timelineEl.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    const overlay = gridLabelsRef.current;
    if (overlay) {
      overlay.style.transform = `translateX(${x}px)`;
      if (!skipLabels && lastGridScaleRef.current !== scale) {
        const labels = overlay.children;
        for (let i = 0; i < labels.length; i++) {
          const el = labels[i];
          const basePx = Number(el.dataset.px);
          el.style.left = `${basePx * scale + 4}px`;
        }
        lastGridScaleRef.current = scale;
      }
    }
  };

  const queueSliderValue = (nextValue) => {
    pendingSliderValueRef.current = nextValue;
    if (sliderRafRef.current) return;
    sliderRafRef.current = requestAnimationFrame(() => {
      sliderRafRef.current = null;
      const value = pendingSliderValueRef.current;
      pendingSliderValueRef.current = null;
      if (typeof value === "number") {
        const delta = Math.abs(value - sliderValueRef.current);
        if (delta >= 0.001) {
          sliderValueRef.current = value;
          setSliderValue(value);
        }
      }
    });
  };

  const getPanBounds = (container) => {
    const scale = scaleRef.current;
    const scaledTimelineWidth = timelineWidth * scale;
    const viewportWidth = container.clientWidth;
    const baseMaxPan = Math.max(0, scaledTimelineWidth - viewportWidth);
    const extra = Math.max(0, viewportWidth / 2 - TIMELINE_PADDING * scale);
    return {
      minX: -baseMaxPan - extra,
      maxX: extra,
      range: baseMaxPan + extra * 2,
    };
  };



  const zoomToPoint = (zoomFactor, mouseX, mouseY, { commitState = true, skipLabels = false } = {}) => {
    const container = containerRef.current;
    if (!container) return;

    const oldScale = scaleRef.current;
    const rect = container.getBoundingClientRect();
    const localX = mouseX - rect.left;
    const localY = mouseY - rect.top;

    const canvasX = (localX - translateRef.current.x) / oldScale;
    const canvasY = (localY - translateRef.current.y) / oldScale;

    const newScale = Math.min(Math.max(oldScale * zoomFactor, 0.1), 5);
    scaleRef.current = newScale;

    translateRef.current.x = localX - canvasX * newScale;
    translateRef.current.y = localY - canvasY * newScale;

    const { minX, maxX } = getPanBounds(container);
    translateRef.current.x = Math.min(maxX, Math.max(minX, translateRef.current.x));

    applyTransform({ skipLabels });
    if (commitState) {
      setCurrentScale(newScale);
      if (onZoomChange) onZoomChange(newScale);
    }
  };

  const panTimelineFromWheelRef = useRef(null);
  const zoomTimelineFromWheelRef = useRef(null);
  // Stable wrappers so MapView (and its WheelShortcutHandler effect) never re-run due to new function refs
  const stablePanTimelineFromWheel = useCallback((...args) => panTimelineFromWheelRef.current?.(...args), []);
  const stableZoomTimelineFromWheel = useCallback((...args) => zoomTimelineFromWheelRef.current?.(...args), []);

  const panTimelineFromWheel = ({ deltaX = 0, deltaY = 0, shiftKey = false }) => {
    const container = containerRef.current;
    if (!container) return;

    if (shiftKey) {
      panVelocityRef.current.y += deltaY * 0.3;
    } else if (Math.abs(deltaX) > Math.abs(deltaY)) {
      panVelocityRef.current.x += deltaX * 0.3;
    } else {
      panVelocityRef.current.x += deltaY * 0.3;
    }

    if (shiftKey) {
      translateRef.current.y -= deltaY;
    } else if (Math.abs(deltaX) > Math.abs(deltaY)) {
      translateRef.current.x -= deltaX;
    } else {
      translateRef.current.x -= deltaY;
    }

    const { minX, maxX, range } = getPanBounds(container);
    translateRef.current.x = Math.min(maxX, Math.max(minX, translateRef.current.x));
    applyTransform();

    if (!isPlaying && range > 0) {
      const panPercentage = ((maxX - translateRef.current.x) / range) * 100;
      queueSliderValue(Math.min(100, Math.max(0, panPercentage)));
    }

    if (panMomentumRafRef.current) cancelAnimationFrame(panMomentumRafRef.current);
    const tick = () => {
      panVelocityRef.current.x *= 0.75;
      panVelocityRef.current.y *= 0.75;
      if (Math.abs(panVelocityRef.current.x) < 0.1 && Math.abs(panVelocityRef.current.y) < 0.1) {
        panMomentumRafRef.current = null;
        return;
      }
      const c = containerRef.current;
      if (!c) { panMomentumRafRef.current = null; return; }
      translateRef.current.x -= panVelocityRef.current.x;
      translateRef.current.y -= panVelocityRef.current.y;
      const { minX: mn, maxX: mx, range: r } = getPanBounds(c);
      translateRef.current.x = Math.min(mx, Math.max(mn, translateRef.current.x));
      applyTransform();
      if (!isPlaying && r > 0) {
        const pct = ((mx - translateRef.current.x) / r) * 100;
        queueSliderValue(Math.min(100, Math.max(0, pct)));
      }
      panMomentumRafRef.current = requestAnimationFrame(tick);
    };
    panMomentumRafRef.current = requestAnimationFrame(tick);
  };

  const zoomTimelineFromWheel = ({ deltaY = 0, clientX, clientY }) => {
    zoomVelocityRef.current += deltaY * 0.3;
    zoomMomentumOriginRef.current = { x: clientX, y: clientY };

    zoomToPoint(Math.pow(0.999, deltaY), clientX, clientY);

    if (zoomMomentumRafRef.current) cancelAnimationFrame(zoomMomentumRafRef.current);
    const tick = () => {
      zoomVelocityRef.current *= 0.75;
      if (Math.abs(zoomVelocityRef.current) < 0.1) {
        zoomMomentumRafRef.current = null;
        applyTransform();
        setCurrentScale(scaleRef.current);
        if (onZoomChange) onZoomChange(scaleRef.current);
        return;
      }
      const { x, y } = zoomMomentumOriginRef.current;
      zoomToPoint(Math.pow(0.999, zoomVelocityRef.current), x, y, { commitState: false });
      zoomMomentumRafRef.current = requestAnimationFrame(tick);
    };
    zoomMomentumRafRef.current = requestAnimationFrame(tick);
  };
  panTimelineFromWheelRef.current = panTimelineFromWheel;
  zoomTimelineFromWheelRef.current = zoomTimelineFromWheel;

  const handleZoomIn = () => {
    if (showMap) { mapViewRef.current?.zoomIn(); return; }
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    zoomToPoint(1.1, rect.left + rect.width / 2, rect.top + rect.height / 2);
  };

  const handleZoomOut = () => {
    if (showMap) { mapViewRef.current?.zoomOut(); return; }
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    zoomToPoint(0.9, rect.left + rect.width / 2, rect.top + rect.height / 2);
  };

  const handleToggleFilterMenu = (e) => {
    e.stopPropagation();
    if (filterMenu) {
      setFilterMenu(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setFilterMenu({
      x: rect.left,
      y: rect.bottom + 4,
      align: "left",
      anchorLeft: rect.left,
      ready: false,
    });
  };

  useEffect(() => {
    if (!filterMenu || !filterMenuRef.current) return;
    const menuRect = filterMenuRef.current.getBoundingClientRect();
    const padding = 8;
    const maxX = window.innerWidth - menuRect.width - padding;
    const maxY = window.innerHeight - menuRect.height - padding;
    const preferredX = filterMenu.align === "left" && Number.isFinite(filterMenu.anchorLeft)
      ? filterMenu.anchorLeft - menuRect.width
      : filterMenu.x;
    const nextX = Math.min(Math.max(padding, preferredX), Math.max(padding, maxX));
    const nextY = Math.min(Math.max(padding, filterMenu.y), Math.max(padding, maxY));
    if (nextX !== filterMenu.x || nextY !== filterMenu.y || !filterMenu.ready) {
      setFilterMenu((prev) =>
        prev ? { ...prev, x: nextX, y: nextY, ready: true } : prev
      );
    }
  }, [filterMenu]);

  // Close filter menu when clicking outside or pressing Escape
  useEffect(() => {
    if (!filterMenu) return;

    const handleClickOutside = (e) => {
      const clickedInsideMenu = filterMenuRef.current?.contains(e.target);
      const clickedFilterButton = filterButtonRef.current?.contains(e.target);
      if (!clickedInsideMenu && !clickedFilterButton) {
        setFilterMenu(null);
      }
    };
    const handleKeyDown = (e) => { if (e.key === "Escape") setFilterMenu(null); };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [filterMenu]);

  useEffect(() => {
    if (!filterModalOpen) return;
    const handleKeyDown = (e) => { if (e.key === "Escape") setFilterModalOpen(false); };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [filterModalOpen]);

  const commitFilterHistory = useCallback((q) => {
    const query = (q ?? "").trim();
    if (!query) return;
    setFilterHistory((prev) => {
      // Drop entries the new query extends, so growing one filter doesn't fill history with its drafts
      const next = [query, ...prev.filter((x) => x !== query && !query.startsWith(x))].slice(0, FILTER_HISTORY_MAX);
      try { window.localStorage.setItem(FILTER_HISTORY_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }, []);

  const removeFilterHistory = useCallback((q) => {
    setFilterHistory((prev) => {
      const next = prev.filter((x) => x !== q);
      try { window.localStorage.setItem(FILTER_HISTORY_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }, []);

  useEffect(() => { filterQueryRef.current = chipsQuery; }, [chipsQuery]);
  const filterUiOpen = Boolean(filterMenu) || filterModalOpen;
  useEffect(() => {
    if (!filterUiOpen && filterQueryRef.current.trim()) commitFilterHistory(filterQueryRef.current);
  }, [filterUiOpen, commitFilterHistory]);

  // Commit-on-close alone loses filters the user clears before closing
  useEffect(() => {
    if (!filterUiOpen) return undefined;
    const query = chipsQuery.trim();
    if (!query) return undefined;
    const timer = setTimeout(() => commitFilterHistory(query), 1500);
    return () => clearTimeout(timer);
  }, [chipsQuery, filterUiOpen, commitFilterHistory]);

  const nextChipId = () => { filterChipIdRef.current += 1; return `chip-${filterChipIdRef.current}`; };
  const addFilterChip = (chip) =>
    setFilterChips((prev) => [...prev, { id: nextChipId(), negated: false, join: "and", ...chip }]);
  const removeFilterChip = (id) => setFilterChips((prev) => prev.filter((c) => c.id !== id));
  const toggleChipNegate = (id) =>
    setFilterChips((prev) => prev.map((c) => (c.id === id ? { ...c, negated: !c.negated } : c)));
  const toggleChipJoin = (id) =>
    setFilterChips((prev) => prev.map((c) => (c.id === id ? { ...c, join: c.join === "or" ? "and" : "or" } : c)));
  const toggleTypeChip = (value) =>
    setFilterChips((prev) =>
      prev.some((c) => c.kind === "type" && c.value === value)
        ? prev.filter((c) => !(c.kind === "type" && c.value === value))
        : [...prev, { id: nextChipId(), kind: "type", value, negated: false, join: "and" }]);
  const toggleTagChip = (tag) =>
    setFilterChips((prev) =>
      prev.some((c) => c.kind === "tag" && c.value.toLowerCase() === tag.toLowerCase())
        ? prev.filter((c) => !(c.kind === "tag" && c.value.toLowerCase() === tag.toLowerCase()))
        : [...prev, { id: nextChipId(), kind: "tag", value: tag, negated: false, join: "and" }]);
  const addDateChip = () => {
    const v = filterDateVal.trim();
    if (!v) return;
    addFilterChip({ kind: "date", op: filterDateOp, value: v });
    setFilterDateVal("");
  };
  const clearFilterChips = () => { setFilterChips([]); setFilterText(""); setFilterDateVal(""); };
  const clearAllFilters = () => { clearFilterChips(); onClearTags?.(); };

  const renderFilterMenuContent = (isModal) => {
    const hasOr = filterChips.some((c, i) => i > 0 && c.join === "or");
    const historyNeedle = filterText.trim().toLowerCase();
    const historyMatches = filterHistory.filter((q) => !historyNeedle || q.toLowerCase().includes(historyNeedle));
    return (
    <>
      <div className="fm-header">
        <span className="fm-header-title"><ListFilter size={12} /> Filters</span>
        {isModal ? (
          <button
            type="button"
            className="fm-header-btn"
            onClick={() => setFilterModalOpen(false)}
            title="Close"
            aria-label="Close filters"
          >
            <X size={14} />
          </button>
        ) : (
          <button
            type="button"
            className="fm-header-btn"
            onClick={() => { setFilterMenu(null); setFilterModalOpen(true); }}
            title="Expand"
            aria-label="Open filters in a larger panel"
          >
            <Maximize2 size={16} />
          </button>
        )}
      </div>
      <div className="fm-query-section">
        <div className="fm-field-wrap">
        <div
          className="fm-field"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) { e.preventDefault(); filterInputRef.current?.focus(); }
          }}
        >
          {filterChips.map((chip, i) => {
            const startsGroup = i === 0 || chip.join === "or";
            const endsGroup = i === filterChips.length - 1 || filterChips[i + 1].join === "or";
            return (
            <Fragment key={chip.id}>
              {i > 0 && (
                <button
                  type="button"
                  className="fm-join"
                  title="Toggle AND / OR"
                  onClick={() => toggleChipJoin(chip.id)}
                >{chip.join === "or" ? "OR" : "AND"}</button>
              )}
              {hasOr && startsGroup && !endsGroup && <span className="fm-paren">(</span>}
              <span className={`fm-fchip fm-fchip-${chip.kind}${chip.negated ? " is-negated" : ""}`}>
                <button
                  type="button"
                  className="fm-fchip-label"
                  title={chip.negated ? "Include (remove ~)" : "Exclude (~)"}
                  onClick={() => toggleChipNegate(chip.id)}
                >{filterChipLabel(chip)}</button>
                <button
                  type="button"
                  className="fm-fchip-remove"
                  aria-label="Remove filter"
                  onClick={() => removeFilterChip(chip.id)}
                >×</button>
              </span>
              {hasOr && endsGroup && !startsGroup && <span className="fm-paren">)</span>}
            </Fragment>
            );
          })}
          <input
            ref={filterInputRef}
            autoFocus
            className="fm-field-input"
            placeholder={filterChips.length ? "Filter…" : "Filter elements…"}
            value={filterText}
            onChange={(e) => { setFilterText(e.target.value); setHistoryOpen(true); }}
            onFocus={() => setHistoryOpen(true)}
            onClick={() => setHistoryOpen(true)}
            onBlur={() => setHistoryOpen(false)}
            spellCheck={false}
            autoComplete="off"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const v = filterText.trim().replace(/^"+|"+$/g, "");
                if (v) { addFilterChip({ kind: "text", value: v }); setFilterText(""); }
                setHistoryOpen(false);
                return;
              }
              if (e.key === "Backspace" && !filterText && filterChips.length) {
                setFilterChips((prev) => prev.slice(0, -1));
                return;
              }
              if (e.key === "Escape" && historyOpen) { e.stopPropagation(); setHistoryOpen(false); return; }
              if (e.key === "Escape" && filterText) { e.stopPropagation(); setFilterText(""); }
            }}
          />
        </div>
        {historyOpen && historyMatches.length > 0 && (
          <div className="fm-history-dropdown">
            <div className="fm-history-dropdown-header"><History size={10} /> Recent filters</div>
            {historyMatches.map((q) => (
              <div key={q} className="fm-history-item">
                <button
                  type="button"
                  className="fm-history-item-text"
                  title={q}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setFilterChips(chipsFromQuery(q, nextChipId));
                    setFilterText("");
                    setHistoryOpen(false);
                    filterInputRef.current?.focus();
                  }}
                >{q}</button>
                <button
                  type="button"
                  className="fm-history-item-x"
                  title="Remove from history"
                  aria-label={`Remove "${q}" from history`}
                  onMouseDown={(e) => { e.preventDefault(); removeFilterHistory(q); }}
                >×</button>
              </div>
            ))}
          </div>
        )}
        </div>
        <div className="fm-chip-row">
          <span className="fm-chip-label">TYPE</span>
          {FILTER_TYPE_TERMS.map((value) => {
            const active = filterChips.some((c) => c.kind === "type" && c.value === value);
            return (
              <button
                key={value}
                type="button"
                className={`fm-chip${active ? " is-active" : ""}`}
                aria-pressed={active}
                onClick={() => toggleTypeChip(value)}
              >{value.replace(":", ": ")}</button>
            );
          })}
        </div>
        <div className="fm-chip-row">
          <span className="fm-chip-label">DATE</span>
          <div className="fm-date-ops">
            {FILTER_DATE_OPS.map(([op, glyph]) => (
              <button
                key={op}
                type="button"
                className={`fm-date-op${filterDateOp === op ? " is-active" : ""}`}
                aria-pressed={filterDateOp === op}
                onClick={() => setFilterDateOp(op)}
              >{glyph}</button>
            ))}
          </div>
          <input
            className="fm-date-input"
            placeholder="year / date"
            value={filterDateVal}
            onChange={(e) => setFilterDateVal(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            onKeyDown={(e) => { if (e.key === "Enter") addDateChip(); }}
          />
          <button
            type="button"
            className="fm-date-add"
            title="Add date filter"
            disabled={!filterDateVal.trim()}
            onClick={addDateChip}
          >+</button>
        </div>
      </div>
      <div className="fm-tags-header">
        <span className="fm-tags-title">TAGS</span>
        <span className="fm-tags-subtitle">CLICK TO CHIP</span>
        <span className="fm-tags-count">{allTags.length} tags</span>
      </div>
      <div className="filter-menu-dropdown">
        {allTags.length === 0 && (
          <div className="filter-menu-empty">No tags found</div>
        )}
        {allTags.map((tag) => {
          const hasTagChip = filterChips.some((c) => c.kind === "tag" && c.value.toLowerCase() === tag.toLowerCase());
          const isShown = activeTags.includes(tag);
          const isHidden = hiddenTags.includes(tag);
          const isPinned = pinnedTags.includes(tag);
          const count = timelineData?.elements?.filter((el) => el.tags?.includes(tag)).length || 0;
          return (
            <div
              key={tag}
              className={`sb-tag-row${isHidden ? " is-hidden" : ""}${hasTagChip ? " is-selected" : ""}`}
              onClick={() => toggleTagChip(tag)}
              title={hasTagChip ? "Remove tag chip" : "Add tag chip"}
            >
              <span className="sb-tag-name"><span className="sb-tag-hash">#</span>{tag}</span>
              <span className="sb-tag-count">{count}</span>
              <div className="sb-tag-actions">
                <button
                  type="button"
                  className={`filter-menu-icon-btn filter-menu-hide-btn${isHidden ? " is-active" : ""}`}
                  onClick={(e) => { e.stopPropagation(); onToggleHiddenTag?.(tag); }}
                  title={isHidden ? "Show tag" : "Hide tag"}
                >
                  {isHidden ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
                <button
                  type="button"
                  className={`filter-menu-icon-btn filter-menu-show-btn${isShown ? " is-active" : ""}`}
                  onClick={(e) => { e.stopPropagation(); onToggleTag?.(tag); }}
                  title={isShown ? "Disable spotlight filter" : "Spotlight this tag"}
                >
                  <Target size={12} />
                </button>
                <button
                  type="button"
                  className={`filter-menu-icon-btn filter-menu-pin-btn${isPinned ? " is-pinned" : ""}`}
                  onClick={(e) => { e.stopPropagation(); onTogglePinnedTag?.(tag); }}
                  title={isPinned ? "Remove label" : "Use as label"}
                >
                  <Tag size={12} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="fm-preview">
        <span className="fm-preview-label">QUERY</span>
        <code className="fm-preview-text">{fullFilterQuery || "No active filter"}</code>
      </div>
      <div className="fm-footer">
        <button
          className="fm-footer-clear"
          type="button"
          onClick={clearAllFilters}
        >
          Clear
        </button>
        <span className="fm-footer-count">
          <strong>{shownElementCount}</strong> shown
        </span>
        <a
          className="fm-footer-syntax"
          title="Filter syntax help"
          href="https://www.timelines.studio/wiki/Searching"
          target="_blank"
          rel="noopener noreferrer"
        >
          <HelpCircle size={11} /> syntax
        </a>
      </div>
    </>
    );
  };

  // Reset viewport when switching to a different timeline
  const prevFileIdRef = useRef(file?.id);
  useEffect(() => {
    if (file?.id && file.id !== prevFileIdRef.current) {
      translateRef.current = { x: 0, y: 0 };
      scaleRef.current = 1;
      prevCalculatedHeightRef.current = null;
    }
    prevFileIdRef.current = file?.id;
  }, [file?.id]);

  // DPI + zoom/pan effect
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Initialize: position the timeline line in the upper-center of the viewport
    if (translateRef.current.x === 0 && translateRef.current.y === 0) {
      translateRef.current.y = container.clientHeight * 0.55 - BASE_LINE_Y;
      applyTransform();
    }

    // Notify parent of initial zoom
    if (onZoomChange) {
      onZoomChange(scaleRef.current);
    }

    // Zoom to cursor with transforms
    const handleWheel = (e) => {
      if (e.target?.closest?.(".timeline-context-menu")) {
        return;
      }

      const insideLeaflet = e.target.closest(".leaflet-container");
      if (insideLeaflet) {
        if (e.altKey) {
          e.preventDefault();
          e.stopPropagation();
          panTimelineFromWheel({
            deltaX: e.deltaX,
            deltaY: e.deltaY,
            shiftKey: e.shiftKey,
          });
        } else if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          e.stopPropagation();
          zoomTimelineFromWheel({
            deltaY: e.deltaY,
            clientX: e.clientX,
            clientY: e.clientY,
          });
        }
        return;
      }

      if (!(e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        panTimelineFromWheel({
          deltaX: e.deltaX,
          deltaY: e.deltaY,
          shiftKey: e.shiftKey,
        });
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      zoomTimelineFromWheel({
        deltaY: e.deltaY,
        clientX: e.clientX,
        clientY: e.clientY,
      });
    };

    // Pan with mouse drag
    const handleMouseDown = (e) => {
      const isMiddleClick = e.button === 1;
      const isLeftClick = e.button === 0;
      const isShiftPan = isLeftClick && e.shiftKey;
      const interactiveSelector = [
        ".event",
        ".span-item",
        ".era-item",
        ".leaflet-container",
        ".timeline-canvas-bar",
        ".timeline-canvas-button",
        ".timeline-slider",
        ".timeline-slider-container",
        ".timeline-context-menu",
      ].join(", ");
      const clickedInteractive = e.target.closest(interactiveSelector);
      const clickedFormControl = e.target.closest("input, textarea, button, select, a");
      const allowLeftDrag = isLeftClick && !clickedInteractive && !clickedFormControl;

      // Allow middle mouse, shift+left, or left-drag on empty canvas.
      if (isMiddleClick || isShiftPan || allowLeftDrag) {
        e.preventDefault();
        isPanningRef.current = true;
        lastPanPositionRef.current = { x: e.clientX, y: e.clientY };
        container.style.cursor = 'grabbing';
      }
    };

    const handleMouseMove = (e) => {
      if (!isPanningRef.current) return;

      const dx = e.clientX - lastPanPositionRef.current.x;
      const dy = e.clientY - lastPanPositionRef.current.y;

      translateRef.current.x += dx;
      translateRef.current.y += dy;

      // Clamp horizontal pan to timeline bounds
      const { minX, maxX, range } = getPanBounds(container);
      translateRef.current.x = Math.min(maxX, Math.max(minX, translateRef.current.x));

      lastPanPositionRef.current = { x: e.clientX, y: e.clientY };
      applyTransform();

      // Update slider when panning horizontally
      if (!isPlaying && range > 0) {
        const panPercentage = ((maxX - translateRef.current.x) / range) * 100;
        queueSliderValue(Math.min(100, Math.max(0, panPercentage)));
      }
    };

    const handleMouseUp = () => {
      if (isPanningRef.current) {
        isPanningRef.current = false;
        container.style.cursor = '';
      }
    };

    // No preventDefault on touchstart so taps still become clicks (selection)
    const touchExcludeSelector = [
      ".leaflet-container",
      ".timeline-canvas-bar",
      ".timeline-slider-container",
      ".timeline-context-menu",
      "input", "textarea", "button", "select", "a",
    ].join(", ");
    let touchPanning = false;
    let pinching = false;
    let lastTouch = { x: 0, y: 0 };
    let pinchDist = 0;
    let pinchMid = { x: 0, y: 0 };
    const midpointOf = (a, b) => ({ x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 });
    const distanceOf = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);

    const applyTouchPan = (dx, dy) => {
      translateRef.current.x += dx;
      translateRef.current.y += dy;
      const { minX, maxX, range } = getPanBounds(container);
      translateRef.current.x = Math.min(maxX, Math.max(minX, translateRef.current.x));
      applyTransform();
      if (!isPlaying && range > 0) {
        const panPercentage = ((maxX - translateRef.current.x) / range) * 100;
        queueSliderValue(Math.min(100, Math.max(0, panPercentage)));
      }
    };

    const handleTouchStart = (e) => {
      if (e.target.closest(touchExcludeSelector)) return;
      if (e.touches.length === 2) {
        pinching = true;
        touchPanning = false;
        pinchDist = distanceOf(e.touches[0], e.touches[1]);
        pinchMid = midpointOf(e.touches[0], e.touches[1]);
      } else if (e.touches.length === 1) {
        touchPanning = true;
        lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    };

    const handleTouchMove = (e) => {
      if (pinching && e.touches.length >= 2) {
        e.preventDefault();
        const dist = distanceOf(e.touches[0], e.touches[1]);
        const mid = midpointOf(e.touches[0], e.touches[1]);
        if (pinchDist > 0 && dist > 0) {
          zoomToPoint(dist / pinchDist, mid.x, mid.y, { commitState: false });
        }
        applyTouchPan(mid.x - pinchMid.x, mid.y - pinchMid.y);
        pinchDist = dist;
        pinchMid = mid;
      } else if (touchPanning && e.touches.length === 1) {
        e.preventDefault();
        const t = e.touches[0];
        applyTouchPan(t.clientX - lastTouch.x, t.clientY - lastTouch.y);
        lastTouch = { x: t.clientX, y: t.clientY };
      }
    };

    const handleTouchEnd = (e) => {
      if (pinching && e.touches.length < 2) {
        pinching = false;
        setCurrentScale(scaleRef.current);
        if (onZoomChange) onZoomChange(scaleRef.current);
        if (e.touches.length === 1) {
          touchPanning = true;
          lastTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }
      }
      if (e.touches.length === 0) touchPanning = false;
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    container.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    container.addEventListener("touchstart", handleTouchStart, { passive: true });
    container.addEventListener("touchmove", handleTouchMove, { passive: false });
    container.addEventListener("touchend", handleTouchEnd);
    container.addEventListener("touchcancel", handleTouchEnd);

    return () => {
      container.removeEventListener("wheel", handleWheel);
      container.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", handleTouchEnd);
      container.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [onZoomChange, timelineWidth, isPlaying]);

  // Pan to selected item with smooth animation
  useLayoutEffect(() => {
    if (showMap || !selectedId) return;

    const container = containerRef.current;
    const timelineEl = timelineRef.current;
    if (!container || !timelineEl) return;

    // reapply transform when exiting map
    applyTransform();

    const dom = timelineEl.querySelector(`[data-id="${selectedId}"]`);
    if (!dom) return;

    // Get element position in timeline coordinates
    const rect = dom.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    const isSpan = dom.classList.contains('span-item');

    // Calculate target position
    let elementTargetX, elementTargetY;

    if (isSpan) {
      // For spans, go to the start (left edge)
      elementTargetX = rect.left - containerRect.left;
      elementTargetY = rect.top + rect.height / 2 - containerRect.top;
    } else {
      // For events and eras, center the element
      elementTargetX = rect.left + rect.width / 2 - containerRect.left;
      elementTargetY = rect.top + rect.height / 2 - containerRect.top;
    }

    const rightOffset = isRightPanelOpen ? rightPanelWidth : 0;
    const leftOffset = isLeftPanelOpen ? leftPanelWidth : 0;
    const viewportCenterX = leftOffset + (containerRect.width - leftOffset - rightOffset) / 2;
    const viewportCenterY = containerRect.height / 2;

    // Calculate target translate values
    let targetX = translateRef.current.x + (viewportCenterX - elementTargetX);
    const targetY = translateRef.current.y + (viewportCenterY - elementTargetY);

    // Clamp target position to scroll bounds
    const { minX, maxX } = getPanBounds(container);
    targetX = Math.min(maxX, Math.max(minX, targetX));

    // Animate to target position
    const startX = translateRef.current.x;
    const startY = translateRef.current.y;
    const duration = 500; // ms
    const startTime = performance.now();

    const animate = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Ease out cubic for smooth deceleration
      const easeProgress = 1 - Math.pow(1 - progress, 3);

      translateRef.current.x = startX + (targetX - startX) * easeProgress;
      translateRef.current.y = startY + (targetY - startY) * easeProgress;

      applyTransform();

      // Update scrollbar during animation
      if (!isPlaying) {
        const { maxX, range } = getPanBounds(container);

        if (range > 0) {
          const panPercentage = ((maxX - translateRef.current.x) / range) * 100;
          queueSliderValue(Math.min(100, Math.max(0, panPercentage)));
        }
      }

      if (progress < 1) {
        rafId = requestAnimationFrame(animate);
      }
    };

    let rafId = requestAnimationFrame(animate);
    return () => { if (rafId) cancelAnimationFrame(rafId); };
  }, [selectedId, showMap, isRightPanelOpen, isLeftPanelOpen]);

  // Scrollbar position to selected element's year in map view
  useEffect(() => {
    if (!showMap || !selectedId) return;
    const el = timelineData?.elements?.find((e) => e.id === selectedId);
    if (!el) return;
    const targetYear = el.type === "event" ? el.date : el.start;
    if (!Number.isFinite(targetYear)) return;
    const container = containerRef.current;
    if (!container) return;
    const { maxX, range } = getPanBounds(container);
    if (range <= 0) return;
    const yearPx = yearToPx(targetYear);
    const viewportWidth = container.clientWidth;
    const targetX = Math.min(maxX, Math.max(maxX - range, viewportWidth / 2 - yearPx * scaleRef.current));
    const pct = Math.min(100, Math.max(0, (maxX - targetX) / range * 100));
    queueSliderValue(pct);
  }, [selectedId, showMap]);

  // Close context menu on click outside or Escape
  useEffect(() => {
    if (!contextMenu) return;

    const handleClickOutside = (e) => {
      const menu = document.querySelector('.timeline-context-menu');
      if (menu && !menu.contains(e.target)) {
        setContextMenu(null);
      }
    };
    const handleKeyDown = (e) => { if (e.key === "Escape") setContextMenu(null); };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  const handleContextMenu = (e) => {
    if (readOnly) return;
    const target = e.target;
    if (target?.closest?.(".leaflet-container")) {
      return;
    }
    const elementNode = target.closest('.event, .span-item, .era-item');
    const elementId = elementNode?.getAttribute('data-id');
    const element = elementId
      ? timelineData.elements.find((el) => el.id === elementId)
      : null;

    let groupId = null;
    let clickYear = null;
    const timelineEl = timelineRef.current;
    if (timelineEl) {
      const timelineRect = timelineEl.getBoundingClientRect();
      const scale = scaleRef.current || 1;
      const clickYInTimeline = (e.clientY - timelineRect.top) / scale;
      const matched = groupBandBoxes.find(
        (box) => clickYInTimeline >= box.top && clickYInTimeline <= box.top + box.height
      );
      groupId = matched?.groupId || null;
      const clickXInTimeline = (e.clientX - timelineRect.left) / scale;
      const compressed = (clickXInTimeline - TIMELINE_PADDING) / PX_PER_YEAR + compressedMin;
      const clamped = Math.min(Math.max(compressed, compressedMin), compressedMax);
      const rawClickYear = decompressYear(clamped);
      clickYear = file?.useCalendar === true ? snapToDayGrid(rawClickYear) : Math.round(rawClickYear);
    }

    e.preventDefault();

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      element,
      groupId,
      clickYear,
    });
  };

  const handleMapContextMenu = useCallback(({ x, y, lat, lng }) => {
    if (readOnly) return;
    setContextMenu({
      x,
      y,
      element: null,
      groupId: null,
      clickYear: null,
      lat,
      lng,
    });
  }, [readOnly]);

  const handleMenuAction = (action) => {
    setContextMenu(null);
    action();
  };

  const handleDownloadJSON = () => {
    const dataStr = JSON.stringify(timelineData, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${file?.id || 'timeline'}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDownloadPNG = async () => {
    const timelineEl = timelineRef.current;
    if (!timelineEl) return;

    try {
      // Dynamically import html2canvas
      const html2canvas = (await import('html2canvas')).default;

      // Store the current transform
      const currentTransform = timelineEl.style.transform;
      const currentTransformOrigin = timelineEl.style.transformOrigin;

      const root = document.documentElement;
      const originalPrimaryBg = getComputedStyle(root).getPropertyValue('--app-bg').trim();

      // Temporarily remove transform
      timelineEl.style.transform = 'none';
      timelineEl.style.transformOrigin = '';

      // Set --app-bg to transparent or custom color if requested
      if (exportPngOptions?.transparentBg) {
        root.style.setProperty('--app-bg', 'transparent');
      } else if (exportPngOptions?.customBg) {
        root.style.setProperty('--app-bg', exportPngOptions.customBg);
      }

      const requestedStartYear = Number(exportPngOptions?.exportStartYear);
      const requestedEndYear = Number(exportPngOptions?.exportEndYear);
      const hasCustomRange = Number.isFinite(requestedStartYear) && Number.isFinite(requestedEndYear);
      const targetW = exportPngOptions?.targetWidth;
      const minRequestedYear = hasCustomRange ? Math.min(requestedStartYear, requestedEndYear) : null;
      const maxRequestedYear = hasCustomRange ? Math.max(requestedStartYear, requestedEndYear) : null;
      const sourceStartPxBase = hasCustomRange ? yearToPx(minRequestedYear) : 0;
      const sourceEndPxBase = hasCustomRange ? yearToPx(maxRequestedYear) : timelineEl.scrollWidth;
      const sourceWidthPxBase = Math.max(1, sourceEndPxBase - sourceStartPxBase);

      let scale = 2;
      if (targetW) {
        // For fixed export presets, use range width as the zoom window so output width stays at targetW.
        scale = hasCustomRange
          ? targetW / sourceWidthPxBase
          : targetW / timelineEl.scrollWidth;
      }

      const bgColor = exportPngOptions?.transparentBg
        ? null
        : (exportPngOptions?.customBg || originalPrimaryBg);

      const targetH = exportPngOptions?.targetHeight;

      const elFullWidth = timelineEl.scrollWidth;
      const exportHeight = calculatedHeight + 100;
      // Clamp so canvas pixel dimensions stay within browser limits
      const MAX_CANVAS_DIM = 16384;
      const maxScale = Math.min(
        MAX_CANVAS_DIM / elFullWidth,
        MAX_CANVAS_DIM / exportHeight,
      );
      const safeScale = Math.min(scale, maxScale);
      const canvas = await html2canvas(timelineEl, {
        backgroundColor: bgColor,
        scale: safeScale,
        logging: false,
        width: elFullWidth,
        height: exportHeight,
        windowWidth: elFullWidth,
        windowHeight: exportHeight,
        onclone: normalizeHtml2CanvasColors,
      });

      if (exportPngOptions?.transparentBg || exportPngOptions?.customBg) {
        root.style.setProperty('--app-bg', originalPrimaryBg);
      }

      timelineEl.style.transform = currentTransform;
      timelineEl.style.transformOrigin = currentTransformOrigin;

      let finalCanvas = canvas;
      const fillColor = exportPngOptions?.customBg || originalPrimaryBg;
      if (hasCustomRange) {
        const pxStart = sourceStartPxBase * scale;
        const pxEnd = sourceEndPxBase * scale;
        const sourceStart = Math.max(0, Math.min(finalCanvas.width, Math.round(pxStart)));
        const sourceEnd = Math.max(0, Math.min(finalCanvas.width, Math.round(pxEnd)));
        const sourceWidth = Math.max(1, sourceEnd - sourceStart);

        if (sourceWidth > 0) {
          const croppedCanvas = document.createElement('canvas');
          croppedCanvas.width = sourceWidth;
          croppedCanvas.height = finalCanvas.height;
          const cropCtx = croppedCanvas.getContext('2d');
          cropCtx.drawImage(
            finalCanvas,
            sourceStart,
            0,
            sourceWidth,
            finalCanvas.height,
            0,
            0,
            sourceWidth,
            finalCanvas.height
          );
          finalCanvas = croppedCanvas;
        }
      }

      // In fixed presets, custom-range capture already maps to target width (zoom behavior).
      // Keep a fallback resize for non-range exports and rounding differences.
      if (targetW && (!hasCustomRange || Math.abs(finalCanvas.width - targetW) > 1)) {
        const resizedCanvas = document.createElement('canvas');
        resizedCanvas.width = targetW;
        resizedCanvas.height = Math.max(1, Math.round((finalCanvas.height * targetW) / finalCanvas.width));
        const resizedCtx = resizedCanvas.getContext('2d');

        if (exportPngOptions?.transparentBg) {
          resizedCtx.clearRect(0, 0, resizedCanvas.width, resizedCanvas.height);
        } else {
          resizedCtx.fillStyle = fillColor;
          resizedCtx.fillRect(0, 0, resizedCanvas.width, resizedCanvas.height);
        }

        resizedCtx.drawImage(finalCanvas, 0, 0, resizedCanvas.width, resizedCanvas.height);
        finalCanvas = resizedCanvas;
      }

      // If target height is taller than the rendered canvas, pad and center vertically
      if (targetH && finalCanvas.height < targetH) {
        const outCanvas = document.createElement('canvas');
        outCanvas.width = finalCanvas.width;
        outCanvas.height = targetH;
        const ctx = outCanvas.getContext('2d');

        if (exportPngOptions?.transparentBg) {
          ctx.clearRect(0, 0, outCanvas.width, targetH);
        } else {
          ctx.fillStyle = fillColor;
          ctx.fillRect(0, 0, outCanvas.width, targetH);
        }

        // Center the timeline vertically in padded output.
        const yOffset = Math.round((targetH - finalCanvas.height) / 2);
        ctx.drawImage(finalCanvas, 0, yOffset);
        finalCanvas = outCanvas;
      }


      // Draw title watermark if requested
      const titleStyle = exportPngOptions?.titleStyle || 'title-logo';
      const canRenderTitleWatermark =
        exportPngOptions?.showTitle &&
        (titleStyle === 'logo-only' || Boolean(exportPngOptions?.title));
      if (canRenderTitleWatermark) {
        const w = finalCanvas.width;
        const h = finalCanvas.height;
        const outCanvas = document.createElement('canvas');
        outCanvas.width = w;
        outCanvas.height = h;
        const ctx = outCanvas.getContext('2d');
        ctx.drawImage(finalCanvas, 0, 0);

        const fontSize = Math.max(14, Math.round(w * 0.018));
        const padding = Math.round(fontSize * 1.5);
        const computedStyle = getComputedStyle(document.documentElement);
        const themeFont = computedStyle.getPropertyValue('--app-font-family').trim() || 'Inter, system-ui, sans-serif';
        const themeColor = computedStyle.getPropertyValue('--text-primary').trim() || '#888';
        ctx.font = `700 ${fontSize}px ${themeFont}`;
        ctx.fillStyle = themeColor;

        const pos = exportPngOptions.titlePosition || 'bottom-right';
        const showText = titleStyle !== 'logo-only';
        const showLogo = titleStyle !== 'title-only';
        const titleText = showText ? exportPngOptions.title : '';
        const metrics = ctx.measureText(titleText);
        const logoHeight = Math.round(fontSize * 0.8);
        const logoWidth = (67 / 25) * logoHeight;
        const logoGap = Math.round(fontSize * 0.35);
        const logoBaselineOffset = fontSize * 0.08;
        const totalWidth = metrics.width + (showLogo ? ((showText ? logoGap : 0) + logoWidth) : 0);
        let x, y;

        if (pos.includes('left')) x = padding;
        else if (pos.includes('center')) x = (w - totalWidth) / 2;
        else x = w - totalWidth - padding;

        if (pos.includes('top')) y = padding + fontSize;
        else y = h - padding;

        if (showText) {
          ctx.fillText(titleText, x, y);
        }

        if (showLogo) {
          const logoX = x + metrics.width + (showText ? logoGap : 0);
          const logoY = y - logoHeight + logoBaselineOffset;
          const scale = logoHeight / 25;
          ctx.save();
          ctx.translate(logoX, logoY);
          ctx.scale(scale, scale);
          ctx.fillRect(0, 8.89844, 28.2656, 6.80469);
          ctx.fillRect(35.0703, 0, 31.9297, 7.32812);
          ctx.fillRect(35.0703, 16.75, 31.9297, 7.32812);
          ctx.beginPath();
          ctx.moveTo(35.0703, 0);
          ctx.lineTo(35.0703, 24.0781);
          ctx.lineTo(33.2656, 24.0781);
          ctx.bezierCurveTo(30.5042, 24.0781, 28.2656, 21.8395, 28.2656, 19.0781);
          ctx.lineTo(28.2656, 5);
          ctx.bezierCurveTo(28.2656, 2.23858, 30.5042, 0, 33.2656, 0);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
        finalCanvas = outCanvas;
      }

      finalCanvas.toBlob((blob) => {
        if (!blob) {
          console.error('Failed to generate PNG — canvas may be too large for this resolution.');
          return;
        }
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const exportFilename = exportPngOptions?.filename || file?.id || 'timeline';
        link.download = `${exportFilename}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }, 'image/png');
    } catch (error) {
      console.error('Error generating PNG:', error);
    }
  };

  const applySliderValue = (value) => {
    if (!Number.isFinite(value)) return;
    if (Math.abs(value - sliderValueRef.current) < 0.01) return;
    sliderValueRef.current = value;
    sliderInputRef.current = true;
    setSliderValue(value);

    const container = containerRef.current;
    if (!container) return;

    const { minX: _minX, maxX, range } = getPanBounds(container);
    const panPosition = maxX - (value / 100) * range;

    translateRef.current.x = panPosition;
    applyTransform();
  };

  const handleSliderChange = (e) => {
    if (e?.nativeEvent && e.nativeEvent.isTrusted === false) return;
    applySliderValue(parseFloat(e.target.value));
  };

  // Touch drags never reach the range input (its thumb is hidden), so map touch X to a value directly
  const handleSliderTouch = (e) => {
    const touch = e.touches[0];
    const rect = sliderElementRef.current?.getBoundingClientRect();
    if (!touch || !rect || rect.width <= 0) return;
    applySliderValue(Math.min(100, Math.max(0, ((touch.clientX - rect.left) / rect.width) * 100)));
  };

  const handlePlayPause = useCallback(() => {
    if (isPlaying) {
      // Sync React state with current DOM values when pausing
      setSliderValue(sliderValueRef.current);
      if (yearLabelRef.current) {
        setSliderYearLabel(yearLabelRef.current.textContent || "");
      }
      if (lastViewportYearRef.current !== null) {
        publishViewportYear(lastViewportYearRef.current);
      }
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying, publishViewportYear]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      const target = e.target;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      const bind = keybinds.play ?? { keys: ["Space"] };
      const keys = bind.keys.map((k) => k.toLowerCase());
      const mainKey = keys.find((k) => !["ctrl","alt","shift"].includes(k));
      if (!mainKey) return;
      const eventKey = e.key === " " ? "space" : e.key.toLowerCase();
      if (eventKey !== mainKey) return;
      const needsCtrl = keys.includes("ctrl");
      const needsAlt = keys.includes("alt");
      const needsShift = keys.includes("shift");
      const isMac = navigator.platform.includes("Mac");
      if (needsCtrl !== (isMac ? e.metaKey : e.ctrlKey)) return;
      if (needsAlt !== e.altKey) return;
      if (needsShift !== e.shiftKey) return;
      e.preventDefault();
      handlePlayPause();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handlePlayPause, keybinds]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      const target = e.target;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key?.toLowerCase();
      const code = e.code?.toLowerCase();
      if (key === "=" || key === "+" || code === "equal" || code === "numpadadd") {
        e.preventDefault();
        handleZoomIn();
      } else if (key === "-" || key === "_" || code === "minus" || code === "numpadsubtract") {
        e.preventDefault();
        handleZoomOut();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleZoomIn, handleZoomOut]);

  // Stop animation and select an element
  const handleSelect = (id) => {
    if (isPlaying) {
      // Stop animation and sync state
      setSliderValue(sliderValueRef.current);
      if (yearLabelRef.current) {
        setSliderYearLabel(yearLabelRef.current.textContent || "");
      }
      if (lastViewportYearRef.current !== null) {
        publishViewportYear(lastViewportYearRef.current);
      }
      setIsPlaying(false);
    }
    onSelect?.(id);
  };

  // Animation effect
  useEffect(() => {
    if (!isPlaying) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      lastPlayTimeRef.current = null;
      return;
    }

    // Capture values at animation start to avoid dependency issues
    const capturedPxPerYear = PX_PER_YEAR;
    const capturedPadding = TIMELINE_PADDING;
    const capturedMin = compressedMin;
    const capturedMax = compressedMax;
    const capturedDecompress = decompressYear;
    const capturedFile = file;
    const capturedTimelineWidth = timelineWidth;

    const animate = (time) => {
      const container = containerRef.current;
      if (!container) return;

      const { minX, maxX, range } = getPanBounds(container);

      if (range <= 0) {
        setIsPlaying(false);
        return;
      }

      if (lastPlayTimeRef.current === null) {
        lastPlayTimeRef.current = time;
      }

      const deltaMs = time - lastPlayTimeRef.current;
      lastPlayTimeRef.current = time;

      const speedPxPerSec = 220;
      const deltaPx = (speedPxPerSec * deltaMs) / 1000;

      let nextX = translateRef.current.x - deltaPx;
      nextX = Math.min(maxX, Math.max(minX, nextX));
      translateRef.current.x = nextX;
      applyTransform();

      const panPercentage = ((maxX - nextX) / range) * 100;
      const clampedPercentage = Math.min(100, Math.max(0, panPercentage));

      // Update slider directly via DOM during animation
      if (sliderElementRef.current) {
        sliderElementRef.current.value = clampedPercentage;
      }
      sliderValueRef.current = clampedPercentage;

      // Update viewport indicator position directly via DOM
      if (viewportIndicatorRef.current) {
        const scale = scaleRef.current;
        const viewportWidth = container.clientWidth;
        const scaledTimelineWidth = capturedTimelineWidth * scale;
        const extra = Math.max(0, viewportWidth / 2 - capturedPadding * scale);
        const totalScrollable = scaledTimelineWidth + extra * 2;
        const viewportWidthPercent = Math.min(100, (viewportWidth / totalScrollable) * 100);
        const halfWidth = viewportWidthPercent / 2;
        const safeRange = 100 - viewportWidthPercent;
        const mappedPosition = halfWidth + (clampedPercentage / 100) * safeRange;
        viewportIndicatorRef.current.style.left = `${mappedPosition}%`;
      }

      // Update year label directly via DOM during animation
      const scale = scaleRef.current;
      const viewportWidth = container.clientWidth;
      const centerPx = -nextX + viewportWidth / 2;
      const timelineX = centerPx / scale;
      const compressedYear = (timelineX - capturedPadding) / capturedPxPerYear + capturedMin;
      const clampedCompressed = Math.min(Math.max(compressedYear, capturedMin), capturedMax);
      const rawYear = capturedDecompress(clampedCompressed);
      const showCalendar = capturedFile?.useCalendar === true;
      const snappedYear = showCalendar ? snapToDayGrid(rawYear) : Math.round(rawYear);
      const nextLabel = formatYear(snappedYear, capturedFile.negID, capturedFile.posID, showCalendar, capturedFile.hideDecimals);

      if (yearLabelRef.current && nextLabel !== lastSliderLabelRef.current) {
        lastSliderLabelRef.current = nextLabel;
        yearLabelRef.current.textContent = nextLabel;
      }

      // Keep the map filter responsive during autoplay without forcing App-level updates every frame.
      if (snappedYear !== lastViewportYearRef.current) {
        lastViewportYearRef.current = snappedYear;
        setMapViewportYear((current) => (current === snappedYear ? current : snappedYear));
      }

      if (nextX <= minX + 0.5) {
        // Sync React state when animation ends
        setSliderValue(clampedPercentage);
        setSliderYearLabel(nextLabel);
        publishViewportYear(snappedYear);
        setIsPlaying(false);
        return;
      }

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying]);

  // Update pan position when slider value changes during animation
  useEffect(() => {
    if (isPlaying) return;
    if (!sliderInputRef.current) return;
    sliderInputRef.current = false;

    const container = containerRef.current;
    if (!container) return;

    const { maxX, range } = getPanBounds(container);
    const panPosition = maxX - (sliderValue / 100) * range;

    translateRef.current.x = panPosition;
    applyTransform();
  }, [sliderValue, isPlaying, timelineWidth]);

  // Update slider based on current pan position
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    if (isPlaying) return; // Don't update if playing to avoid conflicts

    const { maxX, range } = getPanBounds(container);

    if (range <= 0) {
      if (Math.abs(sliderValueRef.current) >= 0.001) queueSliderValue(0);
      return;
    }

    // Calculate current pan percentage (translateRef.x is negative when panned right)
    const panPercentage = Math.min(100, Math.max(0, ((maxX - translateRef.current.x) / range) * 100));
    if (Math.abs(panPercentage - sliderValueRef.current) >= 0.001) {
      queueSliderValue(panPercentage);
    }
  }, [currentScale, isPlaying, timelineWidth]);

  // Trigger PNG download when requested from outside (e.g., Sidebar)
  const lastPngTriggerRef = useRef(downloadPngTrigger);
  useEffect(() => {
    if (downloadPngTrigger > 0 && downloadPngTrigger !== lastPngTriggerRef.current) {
      lastPngTriggerRef.current = downloadPngTrigger;
      handleDownloadPNG();
    }
  }, [downloadPngTrigger]);

  useImperativeHandle(ref, () => ({
    generatePreview: async (options) => {
      const timelineEl = timelineRef.current;
      if (!timelineEl) return null;

      try {
        const html2canvas = (await import('html2canvas')).default;

        const elWidth = timelineEl.scrollWidth;
        const elHeight = calculatedHeight + 100;
        const originalPrimaryBg = getComputedStyle(document.documentElement)
          .getPropertyValue('--app-bg')
          .trim();

        // Clamp scale so canvas pixel dimensions stay within browser limits
        const MAX_CANVAS_DIM = 16384;
        const maxPreviewWidth = Number(options?.maxWidth);
        const maxPreviewHeight = Number(options?.maxHeight);
        const previewScale = Math.min(
          1,
          MAX_CANVAS_DIM / elWidth,
          MAX_CANVAS_DIM / elHeight,
          Number.isFinite(maxPreviewWidth) ? maxPreviewWidth / elWidth : 1,
          Number.isFinite(maxPreviewHeight) ? maxPreviewHeight / elHeight : 1,
        );

        const previewBgColor = options?.transparentBg
          ? null
          : (options?.customBg || originalPrimaryBg);

        const canvas = await html2canvas(timelineEl, {
          backgroundColor: previewBgColor,
          scale: previewScale,
          logging: false,
          width: elWidth,
          height: elHeight,
          windowWidth: elWidth,
          windowHeight: elHeight,
          onclone: (clonedDocument, clonedTimeline) => {
            clonedTimeline.style.transform = 'none';
            clonedTimeline.style.transformOrigin = '';
            if (options?.transparentBg) {
              clonedDocument.documentElement.style.setProperty('--app-bg', 'transparent');
            } else if (options?.customBg) {
              clonedDocument.documentElement.style.setProperty('--app-bg', options.customBg);
            }
            if (options?.simplifyContent) {
              simplifyTimelinePreview(clonedDocument, clonedTimeline);
            }
            normalizeHtml2CanvasColors(clonedDocument, clonedTimeline);
          },
        });

        const minYear = file?.start ?? 0;
        const maxYear = file?.end ?? 2024;

        // Use original (unscaled) element width for coordinate mapping
        const coordWidth = elWidth;

        return {
          imageUrl: canvas.toDataURL('image/png'),
          canvasWidth: canvas.width,
          canvasHeight: canvas.height,
          elementWidth: elWidth,
          elementHeight: elHeight,
          timelineWidth,
          minYear,
          maxYear,
          yearToPercent: (year) => {
            const px = yearToPx(year);
            return (px / coordWidth) * 100;
          },
          percentToYear: (percent) => {
            const px = (percent / 100) * coordWidth;
            const compressedYear = (px - TIMELINE_PADDING) / PX_PER_YEAR + compressedMin;
            const clampedCompressed = Math.min(Math.max(compressedYear, compressedMin), compressedMax);
            const year = decompressYear(clampedCompressed);
            return Math.round(year * 100) / 100;
          },
        };
      } catch (error) {
        console.error('Error generating preview:', error);
        return null;
      }
    },
    scrollToElement: (elementId) => {
      const el = timelineData?.elements?.find((e) => e.id === elementId);
      if (!el) return;
      let targetYear;
      if (el.type === "event") {
        targetYear = el.date;
      } else {
        targetYear = (el.start + el.end) / 2;
      }
      if (!Number.isFinite(targetYear)) return;
      const container = containerRef.current;
      if (!container) return;
      const yearPx = yearToPx(targetYear);
      const scale = scaleRef.current;
      const viewportWidth = container.clientWidth;
      const scaledTimelineWidth = timelineWidth * scale;
      const baseMaxPan = Math.max(0, scaledTimelineWidth - viewportWidth);
      const extra = Math.max(0, viewportWidth / 2 - TIMELINE_PADDING * scale);
      const minX = -baseMaxPan - extra;
      const maxX = extra;
      const newX = viewportWidth / 2 - yearPx * scale;
      translateRef.current.x = Math.min(maxX, Math.max(minX, newX));
      applyTransform();
    },
  }), [calculatedHeight, yearToPx, timelineWidth, file, TIMELINE_PADDING, PX_PER_YEAR, compressedMin, compressedMax, decompressYear, timelineData]);

  // Reapply transform when timeline DOM is recreated after switching back from map view
  useLayoutEffect(() => {
    if (!showMap) {
      applyTransform();
    }
  }, [showMap]);

  // Reapply grid overlay transform after re-renders that update the grid labels
  useLayoutEffect(() => {
    if (!showMap && (file.showGrid || file.showTodayLine)) {
      applyTransform();
    }
  }, [ticks, file.showGrid, file.showTodayLine]);

  const todayMarkerPx = useMemo(() => {
    if (!file?.showTodayLine) return null;
    const todayVal = todayFractionalYear();
    if (file.start != null && todayVal < file.start) return null;
    if (file.end != null && todayVal > file.end) return null;
    const px = yearToPx(todayVal);
    if (!Number.isFinite(px) || px < 0 || px > timelineWidth) return null;
    return px;
  }, [file, yearToPx, timelineWidth]);

  // Auto-exit map view if maps are disabled in settings
  useEffect(() => {
    if (!file.useMaps && showMap) {
      setShowMap(false);
    }
  }, [file.useMaps, showMap]);

  // Sync slider element with state (for non-animation updates like panning)
  useEffect(() => {
    sliderValueRef.current = sliderValue;
    if (sliderElementRef.current && !isPlaying && !sliderInputRef.current) {
      sliderElementRef.current.value = sliderValue;
    }
  }, [sliderValue, isPlaying]);

  useEffect(() => {
    return () => {
      if (sliderRafRef.current) {
        cancelAnimationFrame(sliderRafRef.current);
        sliderRafRef.current = null;
      }
      pendingSliderValueRef.current = null;
    };
  }, []);

  const tickDensityMult = Math.max(0.01, file?.tickDensity ?? 1);
  const MIN_TICK_GAP = (file?.useCalendar === true ? 6 : 24) / tickDensityMult;
  const getLocalYearScale = (year) => {
    const section = normalizedScaleSections.find((s) => year >= s.start && year <= s.end);
    return section ? Math.max(section.scale, 0.0001) : 1;
  };
  const tickGapForYear = (year) => {
    const ls = getLocalYearScale(year);
    return ls < 1 ? MIN_TICK_GAP / ls : MIN_TICK_GAP;
  };
  const breakRendering = useMemo(() => {
    const GAP_WIDTH = 24;
    const GAP_OVERLAP = 2;
    const EPSILON = 0.5;
    const zeroScaleBreaks = [];
    const axisBreakMarkers = [];

    const pushAxisBreak = (px, key) => {
      if (!Number.isFinite(px)) return;
      if (axisBreakMarkers.some((item) => Math.abs(item.px - px) < EPSILON)) return;
      axisBreakMarkers.push({ px, key });
    };

    normalizedScaleSections.forEach((section, index) => {
      if (section.scale === 0) {
        const px = yearToPx(section.start);
        if (!Number.isFinite(px)) return;
        zeroScaleBreaks.push({
          key: `scale-gap-${index}`,
          px,
          width: GAP_WIDTH,
          overlap: GAP_OVERLAP,
          startLabel: formatYear(section.start, file.negID, file.posID, false, file.hideDecimals),
          endLabel: formatYear(section.end, file.negID, file.posID, false, file.hideDecimals),
        });
        return;
      }
      if (section.showBreak === false) return;
      pushAxisBreak(yearToPx(section.start), `scale-break-${index}-start`);
      pushAxisBreak(yearToPx(section.end), `scale-break-${index}-end`);
    });

    return { zeroScaleBreaks, axisBreakMarkers };
  }, [normalizedScaleSections, yearToPx, file.negID, file.posID, file.hideDecimals]);
  const timelineBreakMaskBg = file?.useSecondaryBg ? "var(--surface)" : "var(--app-bg)";

  // Resolve CSS variables to hex for inline styles (avoids color-mix / color() which html2canvas can't parse)
  const rootStyles = getComputedStyle(document.documentElement);
  const resolvedActiveBg = rootStyles.getPropertyValue('--accent-color').trim();
  const resolvedElementBg = rootStyles.getPropertyValue('--ui-muted').trim();
  const resolvedSecondaryBg = rootStyles.getPropertyValue('--surface').trim();

  return (
    <>
    <div
      ref={containerRef}
      className={`timeline-scroll${file?.fixedEventHeight ? ' fixed-event-height' : ''}`}
      style={file?.useSecondaryBg ? { backgroundColor: "var(--surface)" } : undefined}
      onClick={(e) => { if (!file?.keepSelection && (e.target === e.currentTarget || e.target.closest(".timeline, .grid-year-labels-overlay"))) handleSelect(null); }}
      onContextMenu={handleContextMenu}
    >
      {!showMap && (
        <>
          {(file.showGrid || todayMarkerPx != null) && (
            <div ref={gridLabelsRef} className="grid-year-labels-overlay">
              {file.showGrid && (() => {
                const tx = translateRef.current.x;
                const scale = scaleRef.current;
                const SCREEN_LABEL_WIDTH = 14;
                const MIN_SCREEN_GAP = Math.max(6, 20 / tickDensityMult);
                let lastScreenX = -Infinity;
                let lastTickPx = -Infinity;
                return ticks.map((tick) => {
                  const px = yearToPx(tick.value);
                  if (px < lastTickPx + tickGapForYear(tick.value)) return null;
                  lastTickPx = px;
                  const screenX = tx + px * scale;
                  if (screenX < lastScreenX + SCREEN_LABEL_WIDTH + MIN_SCREEN_GAP) return null;
                  lastScreenX = screenX;
                  const label = tick.label ?? formatYear(tick.value, file.negID, file.posID, false, file.hideDecimals);
                  return (
                    <Fragment key={`grid-label-${tick.value}`}>
                      <div
                        className="grid-year-label grid-year-label-top"
                        data-px={px}
                        style={{ left: `${px * scale + 4}px` }}
                      >
                        {label}
                      </div>
                      <div
                        className="grid-year-label grid-year-label-bottom"
                        data-px={px}
                        style={{ left: `${px * scale + 4}px` }}
                      >
                        {label}
                      </div>
                    </Fragment>
                  );
                });
              })()}
              {todayMarkerPx != null && (
                <>
                  <div
                    className="grid-year-label grid-year-label-top today-line-year-label"
                    data-px={todayMarkerPx}
                    style={{ left: `${todayMarkerPx * scaleRef.current + 4}px` }}
                  >
                    Today
                  </div>
                  <div
                    className="grid-year-label grid-year-label-bottom today-line-year-label"
                    data-px={todayMarkerPx}
                    style={{ left: `${todayMarkerPx * scaleRef.current + 4}px` }}
                  >
                    Today
                  </div>
                </>
              )}
            </div>
          )}

          <div
            ref={timelineRef}
            className="timeline"
            style={{ width: `${timelineWidth}px`, height: `${calculatedHeight * 2}px` }}
          >
        {/* Timeline line with scale section gaps */}
        {breakRendering.zeroScaleBreaks.length === 0 ? (
          <div className="timeline-line" style={{ top: `${BASE_LINE_Y}px` }} />
        ) : (
          <div className="timeline-line-segments" style={{ top: `${BASE_LINE_Y}px` }}>
            {(() => {
              const segments = [];
              let lastEnd = -100;

              breakRendering.zeroScaleBreaks.forEach((gapBreak) => {

                  segments.push(
                    <div
                      key={`${gapBreak.key}-segment-before`}
                      className="timeline-line-segment"
                      style={{
                        left: `${lastEnd}px`,
                        width: `${gapBreak.px - lastEnd - gapBreak.width / 2 + gapBreak.overlap}px`,
                      }}
                    />
                  );

                  segments.push(
                    <div
                      key={gapBreak.key}
                      className="timeline-scale-break-indicator"
                      style={{
                        left: `${gapBreak.px - gapBreak.width / 2}px`,
                        width: `${gapBreak.width}px`,
                        backgroundColor: timelineBreakMaskBg,
                      }}
                    >
                      <svg viewBox="0 0 20 10" preserveAspectRatio="none">
                        <path
                          d="M0,5 L4,5 L7,1 L10,9 L13,1 L16,5 L20,5"
                          stroke="var(--text-primary)"
                          strokeWidth="2.5"
                          strokeLinecap="square"
                          strokeLinejoin="miter"
                          fill="none"
                        />
                      </svg>
                      <div className="timeline-scale-break-label">{gapBreak.startLabel} – {gapBreak.endLabel}</div>
                    </div>
                  );

                  lastEnd = gapBreak.px + gapBreak.width / 2 - gapBreak.overlap;
                });

              segments.push(
                <div
                  key="segment-final"
                  className="timeline-line-segment"
                  style={{
                    left: `${lastEnd}px`,
                    right: '0',
                  }}
                />
              );

              return segments;
            })()}
          </div>
        )}
        {breakRendering.axisBreakMarkers.map((marker) => (
          <div
            key={marker.key}
            className="axis-break"
            style={{
              left: `${marker.px}px`,
              top: `${BASE_LINE_Y - 6}px`,
            }}
          >
            <svg
              viewBox="0 0 16 12"
              preserveAspectRatio="none"
            >
              <path
                d="M3,10 L7,2 M9,10 L13,2"
                stroke="var(--text-primary)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="miter"
                fill="none"
              />
            </svg>
          </div>
        ))}

        {/* Today marker */}
        {todayMarkerPx != null && (
          <div className="today-line" style={{ left: `${todayMarkerPx}px` }} />
        )}

        <div className="eras-layer">
          {finalEras.map((era) => {
            if (!era.fuzz) return null;
            const fuzzMask = `linear-gradient(to right, transparent 0, #000 ${era.fuzz.fadeInPx}px, #000 calc(100% - ${era.fuzz.fadeOutPx}px), transparent 100%)`;
            return (
              <div
                key={`fuzz-${era.id}`}
                className="era-fuzz"
                style={{
                  left: `${era.fuzz.left}px`,
                  width: `${era.fuzz.width}px`,
                  height: `${era.height}px`,
                  top: `${era.top}px`,
                  background: `${era.color || "var(--light-bg)"}`,
                  WebkitMaskImage: fuzzMask,
                  maskImage: fuzzMask,
                }}
              />
            );
          })}
          {finalEras.map((era) => {
            const isSelected = selectedId === era.id;
            const eraTextColor = getReadableTextColor(era.color || "var(--light-bg)");
            return (
              <div
                key={era.id}
                data-id={era.id}
                className={`era-item ${isSelected ? "is-selected" : ""}${era.sourceLink ? " has-source-link" : ""}`}
                style={{
                  left: `${era.left}px`,
                  width: `${era.width}px`,
                  height: `${era.height}px`,
                  top: `${era.top}px`,
                  background: era.fuzz ? "transparent" : `${era.color || "var(--light-bg)"}`,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  handleSelect(era.id);
                }}
              >
                {era.hideDetails !== true && (
                  <span className="era-title-wrap">
                    {era.icon && ICON_MAP[era.icon] && (() => { const I = ICON_MAP[era.icon]; return <I size={10} className="era-title-icon" style={{ color: eraTextColor }} />; })()}
                    <span
                      className="era-title"
                      style={{ color: eraTextColor, opacity: 1 }}
                    >
                      {era.title}
                    </span>
                    {era.sourceLink && (
                      <a className="era-source-link" href={era.sourceLink} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title="Open source" style={{ color: eraTextColor }}><ExternalLink size={8} strokeWidth={2.5} /></a>
                    )}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Connectors layer - behind everything */}
        <div className="connectors-layer">
          {!file?.hideSpanConnectors && finalSpans.map((span) => {
            const spanH = span.spanHeight ?? 20;
            const placement = spanChildPlacement[span.id];
            const isChild = !!placement && placement.mode !== "extend";
            const thinConnectorMode = file?.thinConnectors === true;
            const connectorThicknessBase = thinConnectorMode ? 11 : (spanH + 1);

            if (!isChild) return null;
            if (span.width <= 0) return null;

            // Calculate actual visual distance for connector height and offset
            let connectorHeight = undefined;
            let connectorTransform = undefined;
            let proximityPenalty = 2000;
            const parentSpan = finalSpanById.get(placement.parentId);
            const spanTop = spanRenderTopById.get(span.id) ?? span.top;
            const parentTopRender = parentSpan ? (spanRenderTopById.get(parentSpan.id) ?? parentSpan.top) : undefined;
            const isTopChild = parentSpan ? spanTop < parentTopRender : placement.offset > 0;
            const isBottomChild = parentSpan ? spanTop > parentTopRender : placement.offset < 0;
            const connectorOffsetX = connectorThicknessBase;
            const laneDifference = parentSpan ? Math.abs(span.lane - parentSpan.lane) : 0;
            if (parentSpan && Number.isFinite(parentTopRender)) {
              const childTop = spanTop;
              const parentTop = parentTopRender;
              const deltaTop = parentTop - childTop;
              proximityPenalty = Math.min(2000, Math.abs(Math.round(deltaTop)));
              const parentH = parentSpan.spanHeight ?? 20;
              // Thin connector mode: treat as connecting to a thin span
              const thinH = Math.round(spanH / 2);
              const childTrimPx = (thinConnectorMode && span.spanSize !== "thin")
                ? (spanH - thinH) / 2 : 0;
              if (Math.abs(deltaTop) < 0.5) {
                connectorHeight = "0px";
                connectorTransform = undefined;
              } else if (laneDifference <= 1) {
                if (deltaTop >= 0) {
                  // Top child, 1 lane
                  connectorHeight = `${Math.max(0, deltaTop + 1 - childTrimPx)}px`;
                  if (childTrimPx > 0) connectorTransform = `translateY(${childTrimPx}px)`;
                } else {
                  // Bottom child, 1 lane
                  const transformY = deltaTop + parentH - 1;
                  connectorHeight = `${Math.max(0, -deltaTop + spanH - parentH + 1 - childTrimPx)}px`;
                  connectorTransform = `translateY(${transformY}px)`;
                }
              } else {
                if (deltaTop >= 0) {
                  // Top child, >1 lane
                  const extraTrim = Math.round(spanH / 2) + 2;
                  connectorHeight = `${Math.max(0, deltaTop + spanH - extraTrim - childTrimPx)}px`;
                  connectorTransform = childTrimPx > 0
                    ? `translateY(${childTrimPx}px)` : "translate(0px, 0px)";
                } else {
                  // Bottom child, >1 lane
                  const parentTrim = Math.round(parentH / 2) + 2;
                  connectorHeight = `${Math.max(0, -deltaTop + spanH - parentTrim - childTrimPx)}px`;
                  connectorTransform = `translate(0px, ${deltaTop + parentTrim}px)`;
                }
              }
            }

            const connectorLeft = span.left - connectorOffsetX;
            const connectorThickness = connectorThicknessBase;
            const connectorZIndex = 5000 - proximityPenalty * 2 - connectorThickness * 10;
            const thinRadius = thinConnectorMode ? Math.round(connectorThicknessBase * 0.45) : undefined;

            return (
              <div
                key={`connector-${span.id}`}
                style={{
                  position: 'absolute',
                  left: `${connectorLeft}px`,
                  top: `${spanTop}px`,
                  zIndex: connectorZIndex,
                  pointerEvents: 'none',
                }}
              >
                {isTopChild && (
                  <div
                    className="span-connector-top"
                    style={{
                      backgroundColor: span.color || "var(--secondary-text)",
                      paddingTop: connectorHeight,
                      transform: connectorTransform,
                      width: `${connectorThicknessBase}px`,
                      ...(thinRadius != null && { borderTopLeftRadius: `${thinRadius}px` }),
                    }}
                  />
                )}
                {isBottomChild && (
                  <div
                    className="span-connector-bottom"
                    style={{
                      backgroundColor: span.color || "var(--secondary-text)",
                      paddingTop: connectorHeight,
                      transform: connectorTransform,
                      width: `${connectorThicknessBase}px`,
                      ...(thinRadius != null && { borderBottomLeftRadius: `${thinRadius}px` }),
                    }}
                  />
                )}
              </div>
            );
          })}
          {/* Extension connectors - align mixed-size extension chains by center */}
          {finalSpans.map((span) => {
            const placement = spanChildPlacement[span.id];
            if (!placement || placement.mode !== "extend") return null;
            const parentSpan = finalSpanById.get(placement.parentId);
            if (!parentSpan) return null;
            if (span.width <= 0 || parentSpan.width <= 0) return null;

            const spanH = span.spanHeight ?? 20;
            const parentH = parentSpan.spanHeight ?? 20;
            const childTop = spanRenderTopById.get(span.id) ?? span.top;
            const parentTop = spanRenderTopById.get(parentSpan.id) ?? parentSpan.top;
            const childCenter = childTop + spanH / 2;
            const parentCenter = parentTop + parentH / 2;
            const centerDelta = childCenter - parentCenter;
            if (Math.abs(centerDelta) < 0.75) return null;

            const connectorTop = Math.min(childCenter, parentCenter);
            const connectorHeight = Math.abs(centerDelta);
            const connectorWidth = file?.thinConnectors === true
              ? 3
              : Math.max(3, Math.min(7, Math.round(Math.min(spanH, parentH) * 0.28)));
            const connectorLeft = span.left - Math.floor(connectorWidth / 2);
            const connectorColor = span.color || parentSpan.color || "var(--secondary-text)";
            const proximityPenalty = Math.min(2000, Math.abs(Math.round(centerDelta)));
            const connectorZIndex = 5000 - proximityPenalty * 2 - connectorWidth * 10;

            return (
              <div
                key={`extension-connector-${span.id}`}
                style={{
                  position: "absolute",
                  left: `${connectorLeft}px`,
                  top: `${connectorTop}px`,
                  width: `${connectorWidth}px`,
                  height: `${connectorHeight}px`,
                  borderRadius: `${Math.ceil(connectorWidth / 2)}px`,
                  backgroundColor: connectorColor,
                  pointerEvents: "none",
                  zIndex: connectorZIndex,
                }}
              />
            );
          })}
          {/* Merge connectors - at the END of child spans, flipped horizontally */}
          {!file?.hideSpanConnectors && finalSpans.map((span) => {
            const mergePlacement = spanMergePlacement[span.id];
            if (!mergePlacement) return null;

            const mergeSpanH = span.spanHeight ?? 20;
            const mergeParent = finalSpanById.get(mergePlacement.parentId);
            if (!mergeParent) return null;
            if (span.width <= 0 || mergeParent.width <= 0) return null;
            const thinConnectorMode = file?.thinConnectors === true;

            // Use actual rendered positions for direction detection (works across groups)
            const childTop = spanRenderTopById.get(span.id) ?? span.top;
            const parentTop = spanRenderTopById.get(mergeParent.id) ?? mergeParent.top;
            const deltaTop = parentTop - childTop;

            // Skip if same position (no vertical distance to span)
            if (Math.abs(deltaTop) < 0.5) return null;

            const isAboveParent = deltaTop > 0; // child is above (lower top value)
            const isBelowParent = deltaTop < 0;
            const laneDifference = Math.abs(span.lane - mergeParent.lane);

            let mergeConnectorHeight = undefined;
            let mergeConnectorOffset = undefined;
            const proximityPenalty = Math.min(2000, Math.abs(Math.round(deltaTop)));
            const parentH = mergeParent.spanHeight ?? 20;
            // Thin connector mode: treat as connecting to a thin span
            const mergeThinH = Math.round(mergeSpanH / 2);
            const mergeTrimPx = (thinConnectorMode && span.spanSize !== "thin")
              ? (mergeSpanH - mergeThinH) / 2 : 0;
            // Extend connector into parent's neck area when parent is also in thin mode
            const mergeParentTrimPx = (thinConnectorMode && mergeParent.spanSize !== "thin")
              ? (parentH - Math.round(parentH / 2)) / 2 : 0;

            if (laneDifference <= 1) {
              if (deltaTop >= 0) {
                mergeConnectorHeight = `${Math.max(0, deltaTop + 1 - mergeTrimPx + mergeParentTrimPx)}px`;
                if (mergeTrimPx > 0) mergeConnectorOffset = `${mergeTrimPx}px`;
              } else {
                const transformY = deltaTop + parentH - 1 - mergeParentTrimPx;
                mergeConnectorHeight = `${Math.max(0, -deltaTop + mergeSpanH - parentH + 1 - mergeTrimPx + mergeParentTrimPx)}px`;
                mergeConnectorOffset = `${transformY}px`;
              }
            } else {
              if (deltaTop >= 0) {
                const extraTrim = Math.round(mergeSpanH / 2) + 2;
                mergeConnectorHeight = `${Math.max(0, deltaTop + mergeSpanH - extraTrim - mergeTrimPx + mergeParentTrimPx)}px`;
                mergeConnectorOffset = mergeTrimPx > 0 ? `${mergeTrimPx}px` : "0px";
              } else {
                const parentTrim = Math.round(parentH / 2) + 2;
                mergeConnectorHeight = `${Math.max(0, -deltaTop + mergeSpanH - parentTrim - mergeTrimPx + mergeParentTrimPx)}px`;
                mergeConnectorOffset = `${deltaTop + parentTrim - mergeParentTrimPx}px`;
              }
            }

            const mergeConnectorWidth = thinConnectorMode ? 11 : Math.max(11, mergeSpanH + 1);
            const mergeAnchorAdjust = Math.max(0, Math.round((21 - mergeConnectorWidth) / 2));
            const thinMergeNudgeX = thinConnectorMode || span.spanSize === "thin" ? 5 : 0;
            const connectorLeft = span.left + span.width - mergeAnchorAdjust + thinMergeNudgeX;
            const mergeConnectorZIndex = 5000 - proximityPenalty * 2 - mergeConnectorWidth * 10;
            const mergeThinRadius = thinConnectorMode ? Math.round(mergeConnectorWidth * 0.45) : undefined;

            return (
              <div
                key={`merge-connector-${span.id}`}
                style={{
                  position: 'absolute',
                  left: `${connectorLeft}px`,
                  top: `${childTop}px`,
                  zIndex: mergeConnectorZIndex,
                  pointerEvents: 'none',
                }}
              >
                {isAboveParent && (
                  <div
                    className="span-connector-merge-top"
                    style={{
                      backgroundColor: span.color || "var(--secondary-text)",
                      paddingTop: mergeConnectorHeight,
                      width: `${mergeConnectorWidth}px`,
                      transform: mergeConnectorOffset
                        ? `translateY(${mergeConnectorOffset})`
                        : undefined,
                      ...(mergeThinRadius != null && { borderTopRightRadius: `${mergeThinRadius}px` }),
                    }}
                  />
                )}
                {isBelowParent && (
                  <div
                    className="span-connector-merge-bottom"
                    style={{
                      backgroundColor: span.color || "var(--secondary-text)",
                      paddingTop: mergeConnectorHeight,
                      width: `${mergeConnectorWidth}px`,
                      transform: mergeConnectorOffset
                        ? `translateY(${mergeConnectorOffset})`
                        : undefined,
                      ...(mergeThinRadius != null && { borderBottomRightRadius: `${mergeThinRadius}px` }),
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>

        <div className="group-bands-layer">
          {!file?.disableGroups && groupLayouts
            .filter((group) => group.visible)
            .map((group) => {
              const box = groupBandBoxes.find((item) => item.groupId === group.id);
              if (!box || group.hideBand) return null;
              const bandBackground = withAlpha(group.bgColor || resolvedActiveBg, 0.34);
              const bandBorderColor = withAlpha(group.bgColor || resolvedActiveBg, 0.86);
              const bandBorder = `var(--timeline-line-thickness) solid ${bandBorderColor}`;
              return (
                <div
                  key={`group-bg-${group.id}`}
                  className="group-bg-band"
                  style={{
                    top: `${box.top}px`,
                    height: `${box.height}px`,
                    backgroundColor: bandBackground,
                    border: bandBorder,
                  }}
                />
              );
            })}
        </div>

        {groupLayouts
          .filter((group) => group.visible)
          .map((group) => {
            const groupSpans = group.finalSpans;
            const groupEvents = group.finalEvents;
            return (
              <div
                key={`group-layer-${group.id}`}
                className="group-layer"
                style={{ zIndex: 100 + group.order }}
              >
                <div className="spans-layer">
                  {groupSpans.map((span) => {
                    if (span.width <= 0) return null;
                    const isSelected = selectedId === span.id;
                    const spanTextColor = getReadableTextColor(span.color || "var(--secondary-text)");
                    const mergePlacement = spanMergePlacement[span.id];
                    const placement = spanChildPlacement[span.id];
                    const isExtension = placement?.mode === "extend";
                    const extensionParent = isExtension ? finalSpanById.get(placement.parentId) : null;
                    const spanH = span.spanHeight ?? 20;
                    const parentH = extensionParent ? (extensionParent.spanHeight ?? 20) : 20;
                    const extensionChildLarger =
                      isExtension &&
                      !!extensionParent &&
                      spanH > parentH + 0.1 &&
                      span.spanSize !== "thin";
                    const extensionParentLarger = extensionParentRoundedSet.has(span.id);
                    const hideSpanDetails = span.hideDetails === true;
                    const hideSpanName = hideSpanDetails || span.hideName === true;
                    const hideSpanYears = hideSpanDetails || span.hideYears === true;
                    const childInset = placement ? (isExtension ? 1 : 2) : 0;
                    const isBranchChild = !!placement && placement.mode !== "extend";
                    const thinConnectorChild =
                      file?.thinConnectors === true &&
                      isBranchChild &&
                      span.spanSize !== "thin";
                    const thinConnectorMergeOut =
                      file?.thinConnectors === true &&
                      !!mergePlacement &&
                      span.spanSize !== "thin";
                    const neckLeft = thinConnectorChild ? 10 : 0;
                    const neckRight = thinConnectorMergeOut ? 10 : 0;
                    const mergeInset = mergePlacement ? 2 : 0;

                    return (
                      <div
                        key={span.id}
                        data-id={span.id}
                        className={`span-item ${isSelected ? "is-selected" : ""}${span.spanSize === "thin" ? " span-thin" : ""}${span.spanSize === "thick" ? " span-thick" : ""}${isExtension ? " span-extension" : ""}${extensionChildLarger ? " span-extension-child-larger" : ""}${extensionParentLarger ? " span-extension-parent-larger" : ""}${thinConnectorChild ? " span-thin-connector-child" : ""}${thinConnectorMergeOut ? " span-thin-connector-merge-out" : ""}${span.sourceLink ? " has-source-link" : ""}`}
                        style={{
                          "--span-fill": span.color || "var(--secondary-text)",
                          left: `${span.left - childInset + neckLeft}px`,
                          width: `${span.width + childInset + mergeInset - neckLeft - neckRight}px`,
                          top: `${spanRenderTopById.get(span.id) ?? span.top}px`,
                          height: `${span.spanHeight ?? 20}px`,
                          background: span.color || "var(--secondary-text)",
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelect(span.id);
                        }}
                      >
                        <>
                          {!hideSpanName && (
                            <span className="span-title" style={{ color: spanTextColor }}>{span.icon && ICON_MAP[span.icon] && (() => { const I = ICON_MAP[span.icon]; return <I size={10} className="span-title-icon" />; })()}{span.title}</span>
                          )}
                          {span.sourceLink && !hideSpanName && (
                            <a className="span-source-link" href={span.sourceLink} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title="Open source" style={{ color: spanTextColor }}><ExternalLink size={9} strokeWidth={3} /></a>
                          )}
                          {!hideSpanYears && (
                            <span className="span-years" style={{ color: spanTextColor, opacity: 0.7 }}>
                              {displayDateLabel(span.startLabel) ?? formatYear(span.start, file.negID, file.posID, file?.useCalendar === true, file.hideDecimals)} - {displayDateLabel(span.endLabel) ?? formatYear(span.end, file.negID, file.posID, file?.useCalendar === true, file.hideDecimals)}
                            </span>
                          )}
                        </>
                        {(() => {
                          const visiblePinnedTags = (Array.isArray(span.tags) ? span.tags : [])
                            .filter((tag) => pinnedTags.includes(tag));
                          return (
                            <>
                              {visiblePinnedTags.length > 0 && (
                                <span className="pinned-tags" style={{ color: spanTextColor }}>
                                  {visiblePinnedTags.map((tag) => (
                                    <span key={tag} className="pinned-tag" style={tagColors[tag] ? { background: tagColors[tag], color: getReadableTextColor(tagColors[tag]) } : undefined}>
                                      {tag}
                                    </span>
                                  ))}
                                </span>
                              )}
                            </>
                          );
                        })()}
                        {!hideSpanDetails && span.description && (
                          <span className="span-description" style={{ color: spanTextColor, opacity: 0.7 }}>
                            {span.description}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="events-layer">
                  {groupEvents.map((event) => {
                    if ((file.start != null && event.date < file.start) || (file.end != null && event.date > file.end)) return null;
                    const parentId = event.parents?.[0];
                    const parentSpan = parentId ? finalSpanById.get(parentId) : null;
                    const parentColor = parentSpan?.color;
                    const groupColor = groupLayoutById.get(event.groupId)?.bgColor;
                    const isSelected = selectedId === event.id;
                    const eventBorderStyle = event.eventBorderStyle || "solid";
                    const groupBlendBase = groupColor || resolvedActiveBg;
                    const mixedGroupColor = blendColors(groupBlendBase, resolvedElementBg, 0.6);
                    const borderColor = event.color || parentColor || (
                      file?.eventLinesToGroupBottom === true
                        ? mixedGroupColor
                        : "var(--secondary-text)"
                    );
                    const borderValue =
                      eventBorderStyle === "none"
                        ? "none"
                        : `2px ${eventBorderStyle} ${borderColor}`;
                    const effectiveParentColor = event.color || parentColor;
                    const eventBg = file?.spanColorEvents && effectiveParentColor
                      ? blendColors(effectiveParentColor, resolvedSecondaryBg, 0.2)
                      : undefined;
                    return (
                      <div
                        key={event.id}
                        data-id={event.id}
                        className={`event ${isSelected ? "is-selected" : ""}${event._isMultiLine ? " multi-lane" : ""}${event.hideYears === true && !(Array.isArray(event.tags) ? event.tags : []).some((t) => pinnedTags.includes(t)) ? " event-no-year" : ""}${event.sourceLink ? " has-source-link" : ""}${event.thumbnail && event.thumbnailStyle !== "banner" && event.thumbnailStyle !== "square-fill" && event.thumbnailStyle !== "circle-fill" ? " has-thumbnail" : ""}${event.thumbnail && event.thumbnailStyle === "banner" ? " has-thumbnail-banner" : ""}${event.thumbnail && event.thumbnailStyle === "square-fill" ? " has-thumbnail-square" : ""}${event.thumbnail && event.thumbnailStyle === "circle-fill" ? " has-thumbnail-circle" : ""}`}
                        style={{
                          left: `${event._x}px`,
                          top: `${event.top}px`,
                          position: "absolute",
                          border: borderValue,
                          height: event._isMultiLine ? "auto" : undefined,
                          ...(eventBg && { backgroundColor: eventBg }),
                          ...(event._squareSize && { width: `${event._squareSize}px`, height: `${event._squareSize}px`, padding: 0 }),
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSelect(event.id);
                        }}
                      >
                        {event.thumbnail && (event.thumbnailStyle === "square-fill" || event.thumbnailStyle === "circle-fill") ? (
                          <img className={event.thumbnailStyle === "circle-fill" ? "event-thumbnail-circle" : "event-thumbnail-square"} src={event.thumbnail} alt="" style={{ objectFit: event.thumbnailFit || "cover" }} onError={(e) => { e.target.style.display = 'none'; }} />
                        ) : (<>
                        {event.thumbnail && event.thumbnailStyle !== "banner" && <div className="event-thumbnail-tile" style={{ backgroundImage: `url("${event.thumbnail}")`, backgroundSize: event.thumbnailFit || "cover" }} />}
                        {event.thumbnail && event.thumbnailStyle === "banner" && <img className="event-thumbnail-banner" src={event.thumbnail} alt="" style={{ objectFit: event.thumbnailFit || "cover" }} />}
                        <div className={event.thumbnail && event.thumbnailStyle !== "banner" ? "event-text-content" : ""}>
                        <div className="event-title">{event.icon && ICON_MAP[event.icon] && (() => { const I = ICON_MAP[event.icon]; return <I size={evFontSize} className="event-title-icon" />; })()}{event.title}</div>
                        {event.sourceLink && (
                          <a
                            className="event-source-link"
                            href={event.sourceLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            title="Open source"
                          ><ExternalLink size={11} strokeWidth={2.7} /></a>
                        )}
                        {(event.hideYears !== true || (Array.isArray(event.tags) ? event.tags : []).some((t) => pinnedTags.includes(t))) && <div className="event-date">
                          {event.hideYears !== true && <span className="event-year">{displayDateLabel(event.dateLabel) ?? formatYear(event.date, file.negID, file.posID, file?.useCalendar === true, file.hideDecimals)}</span>}
                          {(() => {
                            const visiblePinnedTags = (Array.isArray(event.tags) ? event.tags : [])
                              .filter((tag) => pinnedTags.includes(tag));
                            if (visiblePinnedTags.length === 0) return null;
                            if (file?.fixedEventHeight) {
                              return (
                                <OverflowTags
                                  key={visiblePinnedTags.join(',')}
                                  tags={visiblePinnedTags}
                                  tagColors={tagColors}
                                  getReadableTextColor={getReadableTextColor}
                                />
                              );
                            }
                            return (
                              <span className="pinned-tags">
                                {visiblePinnedTags.map((tag) => (
                                  <span key={tag} className="pinned-tag" style={tagColors[tag] ? { background: tagColors[tag], color: getReadableTextColor(tagColors[tag]) } : undefined}>
                                    {tag}
                                  </span>
                                ))}
                              </span>
                            );
                          })()}
                        </div>}
                        </div>
                        </>)}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

        {renderLegacyLayers && <div className="spans-layer">
          {finalSpans.map((span) => {
            if (span.width <= 0) return null;
            const isSelected = selectedId === span.id;
            const spanTextColor = getReadableTextColor(span.color || "var(--secondary-text)");

            const mergePlacement = spanMergePlacement[span.id];
            const placement = spanChildPlacement[span.id];
            const isExtension = placement?.mode === "extend";
            const extensionParent = isExtension ? finalSpanById.get(placement.parentId) : null;
            const spanH = span.spanHeight ?? 20;
            const parentH = extensionParent ? (extensionParent.spanHeight ?? 20) : 20;
            const extensionChildLarger =
              isExtension &&
              !!extensionParent &&
              spanH > parentH + 0.1 &&
              span.spanSize !== "thin";
            const extensionParentLarger = extensionParentRoundedSet.has(span.id);
            const hideSpanDetails = span.hideDetails === true;
            const hideSpanName = hideSpanDetails || span.hideName === true;
            const hideSpanYears = hideSpanDetails || span.hideYears === true;
            const childInset = placement ? (isExtension ? 1 : 2) : 0;
            const isBranchChild = !!placement && placement.mode !== "extend";
            const thinConnectorChild =
              file?.thinConnectors === true &&
              isBranchChild &&
              span.spanSize !== "thin";
            const thinConnectorMergeOut =
              file?.thinConnectors === true &&
              !!mergePlacement &&
              span.spanSize !== "thin";
            const neckLeft = thinConnectorChild ? 10 : 0;
            const neckRight = thinConnectorMergeOut ? 10 : 0;
            const mergeInset = mergePlacement ? 2 : 0;

            return (
              <div
                key={span.id}
                data-id={span.id}
                className={`span-item ${isSelected ? "is-selected" : ""}${span.spanSize === "thin" ? " span-thin" : ""}${span.spanSize === "thick" ? " span-thick" : ""}${isExtension ? " span-extension" : ""}${extensionChildLarger ? " span-extension-child-larger" : ""}${extensionParentLarger ? " span-extension-parent-larger" : ""}${thinConnectorChild ? " span-thin-connector-child" : ""}${thinConnectorMergeOut ? " span-thin-connector-merge-out" : ""}`}
                style={{
                  "--span-fill": span.color || "var(--secondary-text)",
                  left: `${span.left - childInset + neckLeft}px`,
                  width: `${span.width + childInset + mergeInset - neckLeft - neckRight}px`,
                  top: `${spanRenderTopById.get(span.id) ?? span.top}px`,
                  height: `${span.spanHeight ?? 20}px`,
                  background: span.color || "var(--secondary-text)",
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  handleSelect(span.id);
                }}
              >
                <>
                  {!hideSpanName && (
                    <span className="span-title" style={{ color: spanTextColor }}>{span.title}</span>
                  )}
                  {!hideSpanYears && (
                    <span className="span-years" style={{ color: spanTextColor, opacity: 0.7 }}>
                      {displayDateLabel(span.startLabel) ?? formatYear(span.start, file.negID, file.posID, file?.useCalendar === true, file.hideDecimals)} - {displayDateLabel(span.endLabel) ?? formatYear(span.end, file.negID, file.posID, file?.useCalendar === true, file.hideDecimals)}
                    </span>
                  )}
                  {span.sourceLink && !hideSpanYears && (
                    <a className="span-source-link" href={span.sourceLink} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} title="Open source" style={{ color: spanTextColor, opacity: 0.85 }}><ExternalLink size={9} strokeWidth={2.5} /></a>
                  )}
                </>
                {(() => {
                  const visiblePinnedTags = (Array.isArray(span.tags) ? span.tags : [])
                    .filter((tag) => pinnedTags.includes(tag));
                  if (visiblePinnedTags.length === 0) return null;
                  return (
                    <span className="pinned-tags" style={{ color: spanTextColor }}>
                      {visiblePinnedTags.map((tag) => (
                        <span key={tag} className="pinned-tag" style={tagColors[tag] ? { background: tagColors[tag], color: getReadableTextColor(tagColors[tag]) } : undefined}>
                          {tag}
                        </span>
                      ))}
                    </span>
                  );
                })()}
                {!hideSpanDetails && span.description && (
                  <span className="span-description" style={{ color: spanTextColor, opacity: 0.7 }}>
                    {span.description}
                  </span>
                )}
              </div>
            );
          })}
        </div>}

        {/* Event lines layer - behind spans and events */}
        <div className="event-lines-layer">
          {finalEvents.map((event) => {
            if ((file.start != null && event.date < file.start) || (file.end != null && event.date > file.end)) return null;
            const eventLineStyle = event.eventLineStyle || "solid";
            if (eventLineStyle === "none") return null;

            const parentId = event.parents?.[0];
            const parentSpan = parentId
              ? finalSpanById.get(parentId)
              : null;

            if (parentSpan && parentSpan.groupId !== event.groupId) return null;

            const groupLayout = groupLayoutById.get(event.groupId);
            const isBelowLine = groupLayout?.belowLine === true;

            const fallbackTargetY =
              file?.eventLinesToGroupBottom === true
                ? (groupBandBottomById.get(event.groupId) ?? BASE_LINE_Y)
                : BASE_LINE_Y;
            let targetY;
            if (isBelowLine) {
              targetY = parentSpan
                ? (spanRenderTopById.get(parentSpan.id) ?? parentSpan.top) + (parentSpan.spanHeight ?? 20)
                : BASE_LINE_Y;
            } else {
              targetY = parentSpan
                ? (spanRenderTopById.get(parentSpan.id) ?? parentSpan.top)
                : fallbackTargetY;
            }

            const effectiveBoxHeight = event._boxHeight || 29;
            const eventBottom = event.top + effectiveBoxHeight;

            const parentColor = parentSpan?.color;
            const groupColor = groupLayout?.bgColor;
            const groupBlendBase = groupColor || resolvedActiveBg;
            const mixedGroupColor = blendColors(groupBlendBase, resolvedElementBg, 0.6);
            const lineColor = event.color || parentColor || (
              file?.eventLinesToGroupBottom === true
                ? mixedGroupColor
                : resolvedElementBg
            );
            const isDashed = eventLineStyle === "dashed";
            const isDotted = eventLineStyle === "dotted";
            const groupConnectedUnparented =
              file?.eventLinesToGroupBottom === true && !parentSpan;

            if (isBelowLine) {
              const lineHeight = Math.max(0, event.top - targetY);
              const dotYOffset = groupConnectedUnparented ? -2 : 0;
              return (
                <div
                  key={`event-line-${event.id}`}
                  className="event-line-container"
                  style={{
                    position: 'absolute',
                    left: `${event._x}px`,
                    top: `${targetY}px`,
                    pointerEvents: 'none',
                    zIndex: Math.round(event.top),
                  }}
                >
                  <div
                    className="event-line"
                    style={{
                      position: 'absolute',
                      left: '50%',
                      top: '0',
                      transform: 'translateX(-50%)',
                      width: isDashed || isDotted ? '0' : '2px',
                      height: `${lineHeight}px`,
                      background: isDashed || isDotted ? 'transparent' : lineColor,
                      borderLeft: isDashed
                        ? `2px dashed ${lineColor}`
                        : isDotted
                          ? `2px dotted ${lineColor}`
                          : 'none',
                    }}
                  />
                  <div
                    className="event-dot"
                    style={{
                      position: 'absolute',
                      left: '50%',
                      top: `${dotYOffset}px`,
                      transform: 'translate(-50%, -50%)',
                      width: '8px',
                      height: '8px',
                      background: lineColor,
                    }}
                  />
                </div>
              );
            }

            const lineHeight = Math.abs(eventBottom - targetY);
            const dotYOffset = groupConnectedUnparented ? 2 : 0;
            return (
              <div
                key={`event-line-${event.id}`}
                className="event-line-container"
                style={{
                  position: 'absolute',
                  left: `${event._x}px`,
                  top: `${eventBottom}px`,
                  pointerEvents: 'none',
                  zIndex: Math.round(event.top),
                }}
              >
                <div
                  className="event-line"
                  style={{
                    position: 'absolute',
                    left: '50%',
                    top: '0',
                    transform: 'translateX(-50%)',
                    width: isDashed || isDotted ? '0' : '2px',
                    height: `${lineHeight}px`,
                    background: isDashed || isDotted ? 'transparent' : lineColor,
                    borderLeft: isDashed
                      ? `2px dashed ${lineColor}`
                      : isDotted
                        ? `2px dotted ${lineColor}`
                        : 'none',
                  }}
                />
                <div
                  className="event-dot"
                  style={{
                    position: 'absolute',
                    left: '50%',
                    top: `${lineHeight + dotYOffset}px`,
                    transform: 'translate(-50%, -50%)',
                    width: '8px',
                    height: '8px',
                    background: lineColor,
                  }}
                />
              </div>
            );
          })}
        </div>

        {renderLegacyLayers && <div className="events-layer">
          {finalEvents.map((event) => {
            if ((file.start != null && event.date < file.start) || (file.end != null && event.date > file.end)) return null;
            const parentId = event.parents?.[0];
            const parentSpan = parentId
              ? finalSpanById.get(parentId)
              : null;

            const parentColor = parentSpan?.color;
            const groupColor = groupLayoutById.get(event.groupId)?.bgColor;
            const isSelected = selectedId === event.id;
            const eventBorderStyle = event.eventBorderStyle || "solid";
            const groupBlendBase = groupColor || resolvedActiveBg;
            const mixedGroupColor = blendColors(groupBlendBase, resolvedElementBg, 0.6);
            const borderColor = event.color || parentColor || (
              file?.eventLinesToGroupBottom === true
                ? mixedGroupColor
                : resolvedElementBg
            );
            const borderValue =
              eventBorderStyle === "none"
                ? "none"
                : `2px ${eventBorderStyle} ${borderColor}`;
            return (
              <div
                key={event.id}
                data-id={event.id}
                className={`event ${isSelected ? "is-selected" : ""}${event._isMultiLine ? " multi-lane" : ""}${event.hideYears === true && !(Array.isArray(event.tags) ? event.tags : []).some((t) => pinnedTags.includes(t)) ? " event-no-year" : ""}${event.thumbnail && event.thumbnailStyle !== "banner" && event.thumbnailStyle !== "square-fill" && event.thumbnailStyle !== "circle-fill" ? " has-thumbnail" : ""}${event.thumbnail && event.thumbnailStyle === "banner" ? " has-thumbnail-banner" : ""}${event.thumbnail && event.thumbnailStyle === "square-fill" ? " has-thumbnail-square" : ""}${event.thumbnail && event.thumbnailStyle === "circle-fill" ? " has-thumbnail-circle" : ""}`}
                style={{
                  left: `${event._x}px`,
                  top: `${event.top}px`,
                  position: "absolute",
                  border: borderValue,
                  height: event._isMultiLine ? "auto" : undefined,
                  ...(event._squareSize && { width: `${event._squareSize}px`, height: `${event._squareSize}px`, padding: 0 }),
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  handleSelect(event.id);
                }}
              >
                {event.thumbnail && event.thumbnailStyle === "square-fill" ? (
                  <img className="event-thumbnail-square" src={event.thumbnail} alt="" style={{ objectFit: event.thumbnailFit || "cover" }} onError={(e) => { e.target.style.display = 'none'; }} />
                ) : (<>
                {event.thumbnail && event.thumbnailStyle !== "banner" && <div className="event-thumbnail-tile" style={{ backgroundImage: `url("${event.thumbnail}")`, backgroundSize: event.thumbnailFit || "cover" }} />}
                {event.thumbnail && event.thumbnailStyle === "banner" && <img className="event-thumbnail-banner" src={event.thumbnail} alt="" style={{ objectFit: event.thumbnailFit || "cover" }} />}
                <div className={event.thumbnail && event.thumbnailStyle !== "banner" ? "event-text-content" : ""}>
                <div className="event-title">{event.icon && ICON_MAP[event.icon] && (() => { const I = ICON_MAP[event.icon]; return <I size={evFontSize} className="event-title-icon" />; })()}{event.title}</div>
                {(event.hideYears !== true || (Array.isArray(event.tags) ? event.tags : []).some((t) => pinnedTags.includes(t))) && <div className="event-date">
                  {event.hideYears !== true && <span className="event-year">{displayDateLabel(event.dateLabel) ?? formatYear(event.date, file.negID, file.posID, file?.useCalendar === true, file.hideDecimals)}</span>}
                  {(() => {
                    const visiblePinnedTags = (Array.isArray(event.tags) ? event.tags : [])
                      .filter((tag) => pinnedTags.includes(tag));
                    if (visiblePinnedTags.length === 0) return null;
                    if (file?.fixedEventHeight) {
                      return (
                        <OverflowTags
                          key={visiblePinnedTags.join(',')}
                          tags={visiblePinnedTags}
                          tagColors={tagColors}
                          getReadableTextColor={getReadableTextColor}
                        />
                      );
                    }
                    return (
                      <span className="pinned-tags">
                        {visiblePinnedTags.map((tag) => (
                          <span key={tag} className="pinned-tag">
                            {tag}
                          </span>
                        ))}
                      </span>
                    );
                  })()}
                </div>}
                </div>
                </>)}
              </div>
            );
          })}
        </div>}

        {(() => {
          const MIN_LABEL_GAP = Math.max(4, 8 / tickDensityMult);
          const CHAR_WIDTH = 7.5;
          let lastLabelRight = -Infinity;
          let lastTickPx = -Infinity;
          return ticks.map((tick) => {
            const px = yearToPx(tick.value);
            if (px < lastTickPx + tickGapForYear(tick.value)) return null;
            lastTickPx = px;
            const label = tick.label ?? formatYear(tick.value, file.negID, file.posID, file?.useCalendar === true, file.hideDecimals);
            const halfWidth = (label.length * CHAR_WIDTH) / 2;
            const labelLeft = px - halfWidth;
            const showLabel = labelLeft >= lastLabelRight + MIN_LABEL_GAP;
            if (showLabel) {
              lastLabelRight = px + halfWidth;
            }
            const roundedPx = Math.round(px);
            return (
              <Fragment key={tick.value}>
                {file.showGrid && (
                  <div
                    className="grid-line"
                    style={{ left: `${roundedPx}px` }}
                  />
                )}
                <div
                  className="tick"
                  style={{
                    left: `${roundedPx}px`,
                    top: `${BASE_LINE_Y - 5}px`,
                  }}
                >
                  <div className="tick-line" />
                  {showLabel && <div className="tick-label">{label}</div>}
                </div>
              </Fragment>
            );
          });
        })()}
          </div>
        </>
      )}

      {contextMenu && contextMenu.element && (
        <div
          className="timeline-context-menu"
          style={{
            position: 'fixed',
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="context-menu-item"
            onClick={() => handleMenuAction(() => onEditElement?.(contextMenu.element.id))}
          >
            <Edit2 size={16} />
            <span>Edit {contextMenu.element.type.charAt(0).toUpperCase() + contextMenu.element.type.slice(1)}</span>
          </button>
          <button
            className="context-menu-item"
            onClick={() => handleMenuAction(() => onDuplicateElement?.(contextMenu.element.id))}
          >
            <CopyPlus size={16} />
            <span>Duplicate {contextMenu.element.type.charAt(0).toUpperCase() + contextMenu.element.type.slice(1)}</span>
          </button>
          <div className="context-menu-separator" />
          <button
            className="context-menu-item context-menu-item-danger"
            onClick={() => handleMenuAction(() => onDelete?.(contextMenu.element.id))}
          >
            <Trash2 size={16} />
            <span>Delete {contextMenu.element.type.charAt(0).toUpperCase() + contextMenu.element.type.slice(1)}</span>
          </button>
        </div>
      )}

      {contextMenu && !contextMenu.element && (
        <div
          className="timeline-context-menu"
          style={{
            position: 'fixed',
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="context-menu-item"
            onClick={() => handleMenuAction(() => onAddEvent(contextMenu.groupId, contextMenu.clickYear, { lat: contextMenu.lat, lng: contextMenu.lng }))}
          >
            <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 16, height: 16 }}>
              <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "currentColor" }} />
            </span>
            <span>Add Event</span>
          </button>
          <button
            className="context-menu-item"
            onClick={() => handleMenuAction(() => onAddSpan(contextMenu.groupId, contextMenu.clickYear, { lat: contextMenu.lat, lng: contextMenu.lng }))}
          >
            <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 16, height: 16 }}>
              <span style={{ display: "inline-block", width: 12, height: 2, borderRadius: 1, background: "currentColor" }} />
            </span>
            <span>Add Span</span>
          </button>
          <button
            className="context-menu-item"
            onClick={() => handleMenuAction(() => onAddEra(contextMenu.clickYear, { lat: contextMenu.lat, lng: contextMenu.lng }))}
          >
            <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 16, height: 16 }}>
              <span style={{ display: "inline-block", width: 10, height: 10, border: "2px solid currentColor", borderRadius: 2 }} />
            </span>
            <span>Add Era</span>
          </button>

          <div className="context-menu-separator" />

          <button
            className="context-menu-item"
            onClick={() => handleMenuAction(handleDownloadJSON)}
          >
            <FileJson size={16} />
            <span>Download .json</span>
          </button>
          {!showMap && (
            <>
              <button
                className="context-menu-item"
                onClick={() => handleMenuAction(() => onExportPng?.())}
              >
                <Image size={16} />
                <span>Download .png</span>
              </button>
              <button
                className="context-menu-item"
                onClick={() => handleMenuAction(() => onExportVideo?.())}
              >
                <Video size={16} />
                <span>Export Video</span>
              </button>
            </>
          )}

          <div className="context-menu-separator" />

          <button
            className="context-menu-item"
            onClick={() => handleMenuAction(() => onOpenSettings?.())}
          >
            <Settings size={16} />
            <span>Settings</span>
          </button>
        </div>
      )}

      {showMap && (
        <Suspense fallback={<div className="timeline-map-placeholder" />}>
          <MapView
            ref={mapViewRef}
            elements={mapElements}
            onSelect={onSelect}
            onOpenContextMenu={handleMapContextMenu}
            onAltWheelPan={stablePanTimelineFromWheel}
            onCtrlWheelZoom={stableZoomTimelineFromWheel}
            viewportYear={deferredMapViewportYear}
            selectedId={selectedId}
            fileConfig={file}
          />
        </Suspense>
      )}

      <div className="timeline-canvas-bar" style={{ right: `${zoomButtonOffset}px` }}>
        <button
          type="button"
          className="timeline-canvas-button"
          onClick={handleZoomIn}
          aria-label="Zoom in"
          data-tooltip="Zoom in (+)"
        >
          <Plus size={16} />
        </button>
        <button
          type="button"
          className="timeline-canvas-button"
          onClick={handleZoomOut}
          aria-label="Zoom out"
          data-tooltip="Zoom out (-)"
        >
          <Minus size={16} />
        </button>
        <div className="timeline-canvas-divider" />
        {timelineData?.file?.useMaps && (
          <button
            type="button"
            className="timeline-canvas-button"
            aria-label={showMap ? "Timeline View" : "Map View"}
            data-tooltip={showMap ? "Timeline View" : "Map View"}
            onClick={() => setShowMap((v) => !v)}
          >
            {showMap ? <GanttChartSquare size={16} /> : <MapIcon size={16} />}
          </button>
        )}
        {onSetViewMode && (
          <button
            type="button"
            className="timeline-canvas-button"
            onClick={() => onSetViewMode("spreadsheet")}
            aria-label="Spreadsheet view"
            data-tooltip="Spreadsheet view"
          >
            <Table2 size={16} />
          </button>
        )}
        <button
          type="button"
          className={`timeline-canvas-button${hasAnyFilter ? ' timeline-canvas-button-active' : ''}`}
          onClick={handleToggleFilterMenu}
          aria-label="Filter"
          data-tooltip="Filter"
          ref={filterButtonRef}
        >
          <ListFilter size={16} />
        </button>
        {!readOnly && (
          <button
            type="button"
            className="timeline-canvas-button"
            onClick={onOpenSettings}
            aria-label="Timeline settings"
            data-tooltip="Settings"
          >
            <Settings size={16} />
          </button>
        )}
      </div>

      {filterMenu && (
        <div
          ref={filterMenuRef}
          className="timeline-context-menu sidebar-filter-menu"
          style={{
            position: 'fixed',
            left: `${filterMenu.x}px`,
            top: `${filterMenu.y}px`,
            opacity: filterMenu.ready ? 1 : 0,
            pointerEvents: filterMenu.ready ? "auto" : "none",
          }}
        >
          {renderFilterMenuContent(false)}
        </div>
      )}

      {filterModalOpen && createPortal(
        <div
          className="fm-modal-backdrop"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setFilterModalOpen(false); }}
          onWheelCapture={(e) => e.stopPropagation()}
        >
          <div className="fm-modal">
            {renderFilterMenuContent(true)}
          </div>
        </div>,
        document.body
      )}

      <div
        className="timeline-slider-container"
        style={{ left: `calc(50% + ${sliderOffset / 2}px)` }}
      >
        <button
          className="slider-play-button"
          onClick={handlePlayPause}
          aria-label={isPlaying ? "Pause" : "Play"}
          data-tooltip={btnTip(isPlaying ? "Pause" : "Play", keybinds.play)}
        >
          {isPlaying ? (
            <Pause size={16} strokeWidth={2} />
          ) : (
            <Play size={16} strokeWidth={2} />
          )}
        </button>
        <div className="slider-track">
          <input
            ref={sliderElementRef}
            type="range"
            min="0"
            max="100"
            step="0.1"
            defaultValue={0}
            onChange={handleSliderChange}
            onTouchStart={handleSliderTouch}
            onTouchMove={handleSliderTouch}
            className="timeline-slider"
          />
          <div
            ref={viewportIndicatorRef}
            className="slider-viewport-indicator"
            style={{
              left: (() => {
                if (!containerRef.current) return '50%';
                const scale = scaleRef.current;
                const viewportWidth = containerRef.current.clientWidth;
                const scaledTimelineWidth = timelineWidth * scale;
                const extra = Math.max(0, viewportWidth / 2 - TIMELINE_PADDING * scale);
                const totalScrollable = scaledTimelineWidth + extra * 2;
                const viewportWidthPercent = Math.min(100, (viewportWidth / totalScrollable) * 100);
                const halfWidth = viewportWidthPercent / 2;
                // Map sliderValue (0-100) to the safe range (halfWidth to 100-halfWidth)
                const safeRange = 100 - viewportWidthPercent;
                const mappedPosition = halfWidth + (sliderValue / 100) * safeRange;
                return `${mappedPosition}%`;
              })(),
              width: (() => {
                if (!containerRef.current) return '10%';
                const scale = scaleRef.current;
                const viewportWidth = containerRef.current.clientWidth;
                const scaledTimelineWidth = timelineWidth * scale;
                const extra = Math.max(0, viewportWidth / 2 - TIMELINE_PADDING * scale);
                const totalScrollable = scaledTimelineWidth + extra * 2;
                const widthPercent = Math.min(100, (viewportWidth / totalScrollable) * 100);
                return `${widthPercent}%`;
              })()
            }}
          />
        </div>
        <div ref={yearLabelRef} className="slider-year">{sliderYearLabel}</div>
      </div>
    </div>
    </>
  );
});

export default TimelineView;
