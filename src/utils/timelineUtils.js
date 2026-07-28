import { daysInMonth, displayDateLabel, getActiveDateFormat, formatCalendarDate } from "./dateUtils";

export const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

export function formatYear(year, negID, posID, useCalendar = false, hideDecimals = false) {
  if (year < 0) {
    const abs = hideDecimals ? Math.round(Math.abs(year)) : Math.abs(year);
    return negID ? `${abs} ${negID}` : `${-abs}`;
  }
  if (year > 0) {
    const yearInt = Math.floor(year);
    const fraction = year - yearInt;
    const hasFraction = Math.abs(fraction) > 1e-9;
    const hasShortYear = yearInt <= 9999;

    if (useCalendar && hasShortYear && hasFraction) {
      const monthIndex = Math.min(11, Math.max(0, Math.floor((fraction + 1e-9) * 12)));
      const month = monthIndex + 1;
      const monthFraction = Math.max(0, fraction * 12 - monthIndex);
      const isMonthPrecision = Math.abs(monthFraction) < 1e-9;
      const isIso = getActiveDateFormat() === "ISO";
      if (isMonthPrecision) {
        // Keep the month-name form for slash formats; ISO gets YYYY-MM.
        const label = isIso
          ? formatCalendarDate(yearInt, month, 1, "month", "ISO")
          : `${MONTH_LABELS[monthIndex]} ${yearInt}`;
        return posID ? `${label} ${posID}` : label;
      }
      const days = daysInMonth(yearInt, month);
      const day = Math.min(days, Math.max(1, Math.floor(monthFraction * days + 1e-9) + 1));
      const label = formatCalendarDate(yearInt, month, day, "day");
      return posID ? `${label} ${posID}` : label;
    }

    const display = hideDecimals ? Math.round(year) : (hasFraction ? year : yearInt);
    const label = `${display}`;
    return posID ? `${label} ${posID}` : label;
  }
  return "0";
}

const clampChannel = (value) => Math.max(0, Math.min(255, Math.round(value)));

const mixColor = (base, target, amount) => clampChannel(base + (target - base) * amount);

const toHex = (value) => value.toString(16).padStart(2, "0");

export function getReadableTextColor(background) {
  if (!background || typeof background !== "string") return "#1A1A1A";
  const hex = background.replace("#", "").trim();
  if (hex.length !== 6) return "#1A1A1A";
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  if ([r, g, b].some((v) => Number.isNaN(v))) return "#1A1A1A";

  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const amount = luminance < 0.7 ? 0.7 : 0.45;
  const target = luminance < 0.7 ? 255 : 0;

  const outR = mixColor(r, target, amount);
  const outG = mixColor(g, target, amount);
  const outB = mixColor(b, target, amount);

  return `#${toHex(outR)}${toHex(outG)}${toHex(outB)}`;
}

 // Scrollbar Width = (viewport width / (range * detail * scale)) * 100
 // (1200 / (range × detail × 0.5)) × 100 = 20 (Solving for detail: detail = 12000 / range)

export function calculateDetailLevel(range) {
  const absRange = Math.abs(range);
  if (absRange === 0) return 1;

  // Calculate detail level so scrollbar is 20% at min zoom (0.5) with 1200px viewport
  const detailLevel = 12000 / absRange;

  return detailLevel;
}

export function pickStep(range) {
  const absRange = Math.abs(range);
  if (absRange === 0) return 1;
  const targetTicks = 10;
  const roughStep = absRange / targetTicks;
  const exponent = Math.floor(Math.log10(roughStep));
  const base = roughStep / Math.pow(10, exponent);

  let niceBase;
  if (base < 3) niceBase = 1;
  else if (base < 7.5) niceBase = 5;
  else niceBase = 10;

  return niceBase * Math.pow(10, exponent);
}


// build child -> { parentId, offset } from spans
// Each child span declares its parent via span.parent (string ID).
// Children of the same parent alternate above/below with increasing offset.
// Pattern: -1, +1, -2, +2, -3, +3, ...
export function buildSpanChildPlacement(spans, branchOrdering = "later-first") {
  const placement = {};
  const spanById = Object.fromEntries(spans.map((span) => [span.id, span]));
  const isContiguous = (left, right) =>
    Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) < 1e-6;

  // Extension links: child starts exactly when parent ends.
  for (const span of spans) {
    if (!span.extendFrom) continue;
    const parent = spanById[span.extendFrom];
    if (!parent) continue;
    if (!isContiguous(parent.end, span.start)) continue;
    placement[span.id] = {
      parentId: parent.id,
      offset: 0,
      priority: -1,
      mode: "extend",
    };
  }

  // Group children by their parent
  const childrenByParent = {};
  for (const span of spans) {
    if (placement[span.id]?.mode === "extend") continue;
    if (span.parent) {
      if (!childrenByParent[span.parent]) childrenByParent[span.parent] = [];
      childrenByParent[span.parent].push(span.id);
    }
  }

  for (const [parentId, childIds] of Object.entries(childrenByParent)) {
    // offset -1 = lower lane number = larger Y = BELOW parent (lower on screen)
    // offset +1 = higher lane number = smaller Y = ABOVE parent (higher on screen)
    const orderedChildren =
      branchOrdering === "original"
        ? [...childIds]
        : [...childIds].sort((aId, bId) => {
            const a = spans.find(s => s.id === aId);
            const b = spans.find(s => s.id === bId);
            const aHasChildren = spans.some(s => s.parent === aId);
            const bHasChildren = spans.some(s => s.parent === bId);
            if (aHasChildren !== bHasChildren) return aHasChildren ? -1 : 1;
            const aStart = a?.start ?? 0;
            const bStart = b?.start ?? 0;
            if (aStart !== bStart) return bStart - aStart;
            return String(aId).localeCompare(String(bId));
          });
    // Alternate offsets around the parent: -1, +1, -2, +2, ...
    // Negative offsets appear lower on screen, positive offsets higher.
    orderedChildren.forEach((childId, index) => {
      const magnitude = Math.ceil((index + 1) / 2);
      const offset = index % 2 === 0 ? -magnitude : +magnitude;
      placement[childId] = {
        parentId,
        offset,
        priority: index,
      };
    });
  }
  return placement;
}

// build child -> { parentId } for merge connections (visual only, no lane changes)
// Each child span declares its merge target via span.mergeParent (string ID).
export function buildSpanMergePlacement(spans) {
  const placement = {};
  for (const span of spans) {
    if (span.mergeParent) {
      placement[span.id] = { parentId: span.mergeParent };
    }
  }
  return placement;
}

export function calcSpanBandHeight(rows, offset, height, gap) {
  if (rows === 0) return 0;
  return offset + height + (rows - 1) * (height + gap);
}

export function layoutSpans({
  spans,
  yearToPx,
  BASE_LINE_Y,
  SPAN_HEIGHT,
  SPAN_OFFSET,
  SPAN_GAP,
  SPAN_VERTICAL_GAP,
  spanChildPlacement,
  timelineStart,
  timelineEnd,
  belowLine = false,
}) {
  const spanLaneEnds = [];
  const spanLaneIntervals = [];
  const spanLaneById = {};
  const spanById = Object.fromEntries(spans.map(s => [s.id, s]));
  const finalSpans = [];
  const familyBands = new Map();

  const childToParent = {};
  const parentToChildren = {};
  Object.entries(spanChildPlacement).forEach(([childId, { parentId }]) => {
    childToParent[childId] = parentId;
    if (!parentToChildren[parentId]) parentToChildren[parentId] = [];
    parentToChildren[parentId].push(childId);
  });

  const getRootId = (id) => {
    let current = id;
    while (childToParent[current]) {
      current = childToParent[current];
    }
    return current;
  };

  const CSS_SPAN_HEIGHT = 20;

  const sizeRank = (size) => size === "thick" ? 2 : size === "thin" ? 0 : 1;
  const getEffectiveSize = (s) => {
    if (!s) return "normal";
    const maxRank = sizeRank(s.spanSize);
    return maxRank === 2 ? "thick" : maxRank === 0 ? "thin" : "normal";
  };
  const isThickSpan = (s) => getEffectiveSize(s) === "thick";
  const isThinSpan = (s) => getEffectiveSize(s) === "thin";

  function spanFitsAllNeededLanes(lane, span, rootId) {
    if (!spanFitsInLane(lane, span.start, span.end, rootId)) return false;
    if (isThickSpan(span) && !spanFitsInLane(lane + 1, span.start, span.end, rootId)) return false;
    return true;
  }

  // Check a span AND its entire extend chain at the given lane.
  // Extend children inherit the same lane as their parent, so they must also fit there.
  function spanWithExtendsFitsAtLane(spanId, lane, rootId) {
    const s = spanById[spanId];
    if (!s || !spanFitsAllNeededLanes(lane, s, rootId)) return false;
    const stk = [spanId];
    while (stk.length > 0) {
      const cur = stk.pop();
      for (const childId of (parentToChildren[cur] || [])) {
        const cp = spanChildPlacement[childId];
        if (cp?.mode === "extend") {
          const es = spanById[childId];
          if (!es || !spanFitsAllNeededLanes(lane, es, rootId)) return false;
          stk.push(childId);
        }
      }
    }
    return true;
  }

  const familyOffsetsCache = new Map();
  const getFamilyOffsets = (rootId) => {
    if (familyOffsetsCache.has(rootId)) return familyOffsetsCache.get(rootId);
    const root = spanById[rootId];
    if (!root) return { minOffset: 0, maxOffset: 0 };
    const stack = [{ id: rootId, offset: 0 }];
    let minOffset = 0;
    let maxOffset = 0;
    while (stack.length > 0) {
      const { id, offset } = stack.pop();
      minOffset = Math.min(minOffset, offset);
      maxOffset = Math.max(maxOffset, offset);

      if (isThickSpan(spanById[id])) {
        maxOffset = Math.max(maxOffset, offset + 1);
      }
      const children = parentToChildren[id] || [];
      children.forEach((childId) => {
        const placement = spanChildPlacement[childId];
        if (!placement) return;
        stack.push({ id: childId, offset: offset + placement.offset });
      });
    }
    const result = { minOffset, maxOffset };
    familyOffsetsCache.set(rootId, result);
    return result;
  };

  const familyRangeCache = new Map();
  // Computes the overall time range covered by a family (root + descendants).
  // Used to prevent other families from taking lanes that overlap in time.
  const getFamilyRange = (rootId) => {
    if (familyRangeCache.has(rootId)) return familyRangeCache.get(rootId);
    const root = spanById[rootId];
    if (!root) return { start: 0, end: 0 };
    let minStart = root.start;
    let maxEnd = root.end;
    const stack = [rootId];
    while (stack.length > 0) {
      const id = stack.pop();
      const span = spanById[id];
      if (!span) continue;
      minStart = Math.min(minStart, span.start);
      maxEnd = Math.max(maxEnd, span.end);
      const children = parentToChildren[id] || [];
      children.forEach((childId) => stack.push(childId));
    }
    const result = { start: minStart, end: maxEnd };
    familyRangeCache.set(rootId, result);
    return result;
  };

  const spansOverlap = (startA, endA, startB, endB) =>
    startA < endB && endA > startB;

  const rootSpans = spans.filter(span => !childToParent[span.id]);
  const familyRoots = rootSpans.filter(span => parentToChildren[span.id]?.length > 0);
  const otherRoots = rootSpans.filter(span => !parentToChildren[span.id]?.length);

  familyRoots.sort((a, b) => a.start - b.start);
  otherRoots.sort((a, b) => a.start - b.start);

  const processed = new Set();

  function spanFitsInLane(lane, start, end, rootId) {
    const startPx = yearToPx(start);
    const endPx = yearToPx(end);
    const intervals = spanLaneIntervals[lane] || [];
    const hasCollision = intervals.some(({ startPx: existingStartPx, endPx: existingEndPx }) => {
      return !(existingEndPx + SPAN_GAP <= startPx || endPx + SPAN_GAP <= existingStartPx);
    });
    if (hasCollision) {
      return false;
    }
    if (!rootId) return true;
    for (const [familyRoot, band] of familyBands.entries()) {
      if (familyRoot === rootId) continue;
      if (!spansOverlap(start, end, band.start, band.end)) continue;
      if (lane >= band.minLane && lane <= band.maxLane) {
        return false;
      }
    }
    return true;
  }

  function familyFitsAtLane(span, baseLane) {
    const rootId = span.id;
    const { minOffset, maxOffset } = getFamilyOffsets(rootId);

    if (baseLane + minOffset < 0) return false;

    // Check root span + its extend chain (all at baseLane, offset=0).
    // The loop below skips offset=0, so we check the extend chain separately.
    if (!spanWithExtendsFitsAtLane(span.id, baseLane, rootId)) return false;

    for (let offset = minOffset; offset <= maxOffset; offset++) {
      if (offset === 0) continue;

      if (offset === 1 && isThickSpan(span)) continue;
      const childLane = baseLane + offset;

      const childIds = parentToChildren[span.id] || [];
      for (const childId of childIds) {
        const childPlacement = spanChildPlacement[childId];
        if (childPlacement && childPlacement.offset === offset) {
          // Check the branch child AND its extend chain at childLane.
          if (!spanWithExtendsFitsAtLane(childId, childLane, rootId)) {
            return false;
          }
        }
      }
    }

    const familyRange = getFamilyRange(rootId);
    for (const [, band] of familyBands.entries()) {
      if (!spansOverlap(familyRange.start, familyRange.end, band.start, band.end)) continue;
      const candidateMin = baseLane + minOffset;
      const candidateMax = baseLane + maxOffset;
      const overlapsBand =
        candidateMin <= band.maxLane && candidateMax >= band.minLane;
      if (overlapsBand) return false;
    }

    return true;
  }

  function placeSpan(span) {
    if (processed.has(span.id)) return;
    processed.add(span.id);

    const rawLeft = yearToPx(span.start);
    const rawRight = yearToPx(span.end);
    const clampedLeft = timelineStart != null ? Math.max(rawLeft, yearToPx(timelineStart)) : rawLeft;
    const clampedRight = timelineEnd != null ? Math.min(rawRight, yearToPx(timelineEnd)) : rawRight;
    const left = clampedLeft;
    const width = clampedRight - clampedLeft;
    const right = clampedRight;
    const placement = spanChildPlacement[span.id];

    let lane;

    const rootId = getRootId(span.id);

    const thick = isThickSpan(span);
    const thin = isThinSpan(span);

    if (placement?.mode === "extend") {
      const parentLane = spanLaneById[placement.parentId];
      if (parentLane !== undefined) {
        lane = parentLane;
      } else {
        lane = 0;
        while (!spanFitsAllNeededLanes(lane, span, rootId)) {
          lane++;
        }
      }
    } else if (placement) {
      const parentLane = spanLaneById[placement.parentId];
      if (parentLane !== undefined) {
        const direction = placement.offset > 0 ? 1 : -1;
        let searchLane = parentLane + direction;

        while (true) {
          if (searchLane < 0) {
            searchLane = parentLane + 1;
            while (!spanWithExtendsFitsAtLane(span.id, searchLane, rootId)) {
              searchLane++;
            }
            break;
          }

          if (spanWithExtendsFitsAtLane(span.id, searchLane, rootId)) {
            break;
          }

          searchLane += direction;
        }

        lane = searchLane;
      } else {
        lane = 0;
        while (!spanFitsAllNeededLanes(lane, span, rootId)) {
          lane++;
        }
      }
    } else {
      lane = 0;
      while (!familyFitsAtLane(span, lane)) {
        lane++;
      }
    }

    spanLaneEnds[lane] = right;
    if (!spanLaneIntervals[lane]) spanLaneIntervals[lane] = [];
    spanLaneIntervals[lane].push({ startPx: left, endPx: right });

    if (thick) {
      spanLaneEnds[lane + 1] = right;
      if (!spanLaneIntervals[lane + 1]) spanLaneIntervals[lane + 1] = [];
      spanLaneIntervals[lane + 1].push({ startPx: left, endPx: right });
    }

    spanLaneById[span.id] = lane;

    if (!placement) {
      const { minOffset, maxOffset } = getFamilyOffsets(span.id);
      const familyRange = getFamilyRange(span.id);
      familyBands.set(span.id, {
        minLane: lane + minOffset,
        maxLane: lane + maxOffset,
        start: familyRange.start,
        end: familyRange.end,
      });
    }

    const topLane = thick ? lane + 1 : lane;
    const top = belowLine
      ? BASE_LINE_Y + SPAN_OFFSET + topLane * (SPAN_HEIGHT + SPAN_VERTICAL_GAP)
      : BASE_LINE_Y - SPAN_OFFSET - SPAN_HEIGHT - topLane * (SPAN_HEIGHT + SPAN_VERTICAL_GAP);
    const spanHeight = thick
      ? CSS_SPAN_HEIGHT + SPAN_HEIGHT + SPAN_VERTICAL_GAP
      : thin ? Math.round(CSS_SPAN_HEIGHT / 2) : CSS_SPAN_HEIGHT;
    const topOffset = thin ? Math.round((CSS_SPAN_HEIGHT - spanHeight) / 2) : 0;

    finalSpans.push({
      ...span,
      left,
      width,
      top: top + topOffset,
      lane,
      spanHeight,
    });

    const children = [];
    (parentToChildren[span.id] || []).forEach((childId) => {
      if (spanById[childId]) children.push(spanById[childId]);
    });
    children
      .sort((a, b) => {
        const aPriority = spanChildPlacement[a.id]?.priority ?? 0;
        const bPriority = spanChildPlacement[b.id]?.priority ?? 0;
        if (aPriority !== bPriority) return aPriority - bPriority;
        const aStart = a.start ?? 0;
        const bStart = b.start ?? 0;
        if (aStart !== bStart) return bStart - aStart;
        return String(a.id).localeCompare(String(b.id));
      })
      .forEach(child => placeSpan(child));
  }

  familyRoots.forEach(span => placeSpan(span));
  otherRoots.forEach(span => placeSpan(span));
  // Place any remaining spans that weren't reached via a root (safety net).
  spans.forEach(span => placeSpan(span));

  if (finalSpans.length > 0) {
    const minLane = Math.min(...finalSpans.map((span) => span.lane));
    if (minLane > 0) {
      const laneShift = minLane;
      finalSpans.forEach((span) => {
        span.lane -= laneShift;
        span.top += laneShift * (SPAN_HEIGHT + SPAN_VERTICAL_GAP);
        spanLaneById[span.id] = span.lane;
      });
      const shiftedLaneEnds = [];
      spanLaneEnds.forEach((end, index) => {
        if (end === undefined) return;
        shiftedLaneEnds[index - laneShift] = end;
      });
      spanLaneEnds.length = 0;
      shiftedLaneEnds.forEach((end, index) => {
        spanLaneEnds[index] = end;
      });
    }

    // Densify lane indexes to remove empty gaps between used lanes.
    // This prevents visual blank rows when some lane numbers end up unused.
    const usedLaneSet = new Set();
    finalSpans.forEach((span) => {
      usedLaneSet.add(span.lane);
      if (isThickSpan(span)) usedLaneSet.add(span.lane + 1);
    });
    const usedLanes = Array.from(usedLaneSet).sort((a, b) => a - b);
    const denseLaneByOldLane = new Map(usedLanes.map((lane, idx) => [lane, idx]));

    if (usedLanes.some((lane, idx) => lane !== idx)) {
      finalSpans.forEach((span) => {
        const denseLane = denseLaneByOldLane.get(span.lane);
        if (denseLane === undefined) return;
        span.lane = denseLane;
        const thick = isThickSpan(span);
        const thin = isThinSpan(span);
        const topLane = thick ? denseLane + 1 : denseLane;
        const baseTop = belowLine
          ? BASE_LINE_Y + SPAN_OFFSET + topLane * (SPAN_HEIGHT + SPAN_VERTICAL_GAP)
          : BASE_LINE_Y - SPAN_OFFSET - SPAN_HEIGHT - topLane * (SPAN_HEIGHT + SPAN_VERTICAL_GAP);
        const topOffset = thin ? Math.round((CSS_SPAN_HEIGHT - span.spanHeight) / 2) : 0;
        span.top = baseTop + topOffset;
        spanLaneById[span.id] = denseLane;
      });

      const rebuiltLaneEnds = [];
      finalSpans.forEach((span) => {
        const lane = span.lane;
        const right = span.left + span.width;
        if (rebuiltLaneEnds[lane] === undefined || right > rebuiltLaneEnds[lane]) {
          rebuiltLaneEnds[lane] = right;
        }
        if (isThickSpan(span)) {
          const extraLane = lane + 1;
          if (rebuiltLaneEnds[extraLane] === undefined || right > rebuiltLaneEnds[extraLane]) {
            rebuiltLaneEnds[extraLane] = right;
          }
        }
      });

      spanLaneEnds.length = 0;
      rebuiltLaneEnds.forEach((end, index) => {
        spanLaneEnds[index] = end;
      });
    }
  }

  return { finalSpans, spanLaneEnds, spanLaneById, spanChildPlacement };
}

let measureCache = new Map();
let measureCacheConfig = "";

export function layoutEvents({
  events,
  yearToPx,
  BASE_LINE_Y,
  spanBandHeight,
  EVENT_WIDTH,
  EVENT_GAP,
  LANE_SPACING,
  BOX_OFFSET,
  fixedEventHeight,
  eventWidth = 150,
  eventFontSize = 10,
  fontFamily,
  pinnedTags = [],
  negID,
  posID,
  belowLine = false,
  useCalendar = false,
  hideDecimals = false,
  fontEpoch = 0,
}) {
  const laidOut = [...events]
    .sort((a, b) => a.date - b.date)
    .map((ev) => ({ ...ev, _x: yearToPx(ev.date) }));

  const eventHeight = Math.round(eventWidth / 6);
  const paddingV = Math.max(2, Math.round(eventHeight * 0.08));
  const paddingH = Math.round(eventWidth * 0.053);
  const borderRadius = Math.round(eventWidth * 0.053);
  const noYearHeight = Math.max(10, eventHeight - 9);
  const dateFontSize = Math.max(6, eventFontSize - 1);
  const tagFontSize = Math.max(5, eventFontSize - 2);
  const tagPad = Math.round(eventFontSize * 0.6);
  const dateGap = Math.max(2, Math.round(eventFontSize * 0.4));
  const thumbTileWidth = Math.round(eventWidth * 0.193);
  const bannerHeight = Math.round(eventWidth * 0.32);
  const squareSize = Math.round(eventWidth * 0.467);

  // Create an offscreen probe matching .event styling for accurate height measurement
  const probe = document.createElement("div");
  probe.className = "event";
  probe.style.setProperty('--event-width', `${eventWidth}px`);
  probe.style.setProperty('--event-height', `${eventHeight}px`);
  probe.style.setProperty('--event-height-noyear', `${noYearHeight}px`);
  probe.style.setProperty('--event-pad-v', `${paddingV}px`);
  probe.style.setProperty('--event-pad-h', `${paddingH}px`);
  probe.style.setProperty('--event-radius', `${borderRadius}px`);
  probe.style.setProperty('--event-font-size', `${eventFontSize}px`);
  probe.style.setProperty('--event-date-font-size', `${dateFontSize}px`);
  probe.style.setProperty('--event-date-gap', `${dateGap}px`);
  probe.style.setProperty('--event-tag-font-size', `${tagFontSize}px`);
  probe.style.setProperty('--event-tag-pad', `${tagPad}px`);
  probe.style.setProperty('--event-tile-width', `${thumbTileWidth}px`);
  probe.style.setProperty('--event-banner-height', `${bannerHeight}px`);
  probe.style.setProperty('--event-font-scale', `${eventFontSize / 10}`);
  const probeTitle = document.createElement("div");
  probeTitle.className = "event-title";
  const probeDate = document.createElement("div");
  probeDate.className = "event-date";
  const probeYearSpan = document.createElement("span");
  probeYearSpan.className = "event-year";
  probeYearSpan.textContent = "0000";
  const probeTags = document.createElement("span");
  probeTags.className = "pinned-tags probe-tags";
  let probeTextContent = null;
  probeDate.appendChild(probeYearSpan);
  probe.appendChild(probeTitle);
  probe.appendChild(probeDate);

  const getVisiblePinnedTags = (tags) =>
    (Array.isArray(tags) ? tags : []).filter((tag) => pinnedTags.includes(tag));

  const setProbeTags = (tags) => {
    probeTags.innerHTML = "";
    tags.forEach((tag) => {
      const span = document.createElement("span");
      span.className = "pinned-tag probe-tag";
      span.textContent = tag;
      probeTags.appendChild(span);
    });
  };
  const syncProbeDateRow = ({ showDateRow, showYear, visibleTags, hasThumbnailLayout = false }) => {
    probe.classList.toggle("event-no-year", !showDateRow);

    const dateParent = hasThumbnailLayout ? probeTextContent : probe;
    if (!showDateRow) {
      if (probeDate.parentNode) probeDate.remove();
      return;
    }

    if (probeDate.parentNode !== dateParent) {
      probeDate.remove();
      dateParent.appendChild(probeDate);
    }

    if (showYear) {
      if (probeYearSpan.parentNode !== probeDate) {
        probeYearSpan.remove();
        probeDate.insertBefore(probeYearSpan, probeDate.firstChild);
      }
    } else if (probeYearSpan.parentNode === probeDate) {
      probeYearSpan.remove();
    }

    if (visibleTags.length > 0) {
      setProbeTags(visibleTags);
      if (probeTags.parentNode !== probeDate) {
        probeTags.remove();
        probeDate.appendChild(probeTags);
      }
    } else if (probeTags.parentNode === probeDate) {
      probeTags.remove();
    }
  };
  Object.assign(probe.style, {
    position: "absolute",
    visibility: "hidden",
    pointerEvents: "none",
    left: "-9999px",
  });
  if (fontFamily) {
    probe.style.fontFamily = fontFamily;
  }
  document.body.appendChild(probe);

  // Measure the fixed single-line height from CSS
  probeTitle.textContent = "X";
  syncProbeDateRow({ showDateRow: true, showYear: true, visibleTags: [] });
  const singleLineHeight = probe.offsetHeight;
  syncProbeDateRow({ showDateRow: false, showYear: false, visibleTags: [] });
  const noYearSingleLineHeight = probe.offsetHeight;
  syncProbeDateRow({ showDateRow: true, showYear: true, visibleTags: [] });
  const probeBorderSize = (parseInt(getComputedStyle(probe).borderTopWidth, 10) || 0) + (parseInt(getComputedStyle(probe).borderBottomWidth, 10) || 0);
  probe.style.height = 'auto';
  probe.style.minHeight = '0';
  const textContentHeight = probe.offsetHeight;
  probe.style.height = '';
  probe.style.minHeight = '';

  let measureEvent;
  if (fixedEventHeight) {
    measureEvent = (title, tags, yearLabel, icon, thumbnail, thumbnailStyle, hideYears, sourceLink, eventBorderStyle) => {
      if (thumbnail && (thumbnailStyle === "square-fill" || thumbnailStyle === "circle-fill")) {
        const sqBorder = eventBorderStyle === "none" ? 0 : probeBorderSize;
        return { boxHeight: squareSize + sqBorder, isMultiLine: false, squareSize, boxWidth: squareSize + 4 };
      }
      if (thumbnail && thumbnailStyle === "banner") {
        return { boxHeight: textContentHeight + bannerHeight, isMultiLine: true, boxWidth: EVENT_WIDTH };
      }
      if (thumbnail) {
        return { boxHeight: singleLineHeight, isMultiLine: false, boxWidth: EVENT_WIDTH };
      }
      let h = singleLineHeight;
      if (eventBorderStyle === "none") h -= probeBorderSize;
      return { boxHeight: h, isMultiLine: false, boxWidth: EVENT_WIDTH };
    };
  } else {
    // Switch to auto-height for measuring multi-line content
    probe.classList.add("multi-lane");
    probe.style.height = "auto";
    syncProbeDateRow({ showDateRow: true, showYear: true, visibleTags: [] });
    const baseContentHeight = probe.offsetHeight;
    syncProbeDateRow({ showDateRow: false, showYear: false, visibleTags: [] });
    const noYearBaseContentHeight = probe.offsetHeight;
    syncProbeDateRow({ showDateRow: true, showYear: true, visibleTags: [] });

    // Reusable icon placeholder
    const probeIcon = document.createElement("span");
    probeIcon.style.cssText = `float: left; width: ${eventFontSize}px; height: ${eventFontSize}px; margin-right: 3px; margin-top: 1px;`;

    const probeThumbnailTile = document.createElement("div");
    probeThumbnailTile.className = "event-thumbnail-tile";
    // Fix the width for probe measurement since aspect-ratio:1 is based on height
    probeThumbnailTile.style.width = `${thumbTileWidth}px`;
    probeTextContent = document.createElement("div");
    probeTextContent.className = "event-text-content";

    probe.classList.add("has-thumbnail");
    probeTextContent.appendChild(probeTitle);
    probeTextContent.appendChild(probeDate);
    probe.innerHTML = "";
    probe.appendChild(probeThumbnailTile);
    probe.appendChild(probeTextContent);
    probeTitle.textContent = "X";
    syncProbeDateRow({ showDateRow: true, showYear: true, visibleTags: [], hasThumbnailLayout: true });
    const thumbnailBaseContentHeight = probe.offsetHeight;
    syncProbeDateRow({ showDateRow: false, showYear: false, visibleTags: [], hasThumbnailLayout: true });
    const thumbnailNoYearBaseContentHeight = probe.offsetHeight;


    probe.classList.remove("has-thumbnail");
    probe.innerHTML = "";
    probe.appendChild(probeTitle);
    probe.appendChild(probeDate);
    syncProbeDateRow({ showDateRow: true, showYear: true, visibleTags: [] });

    let lastHasThumbnail = false;

    const setupProbeLayout = (hasThumbnail) => {
      if (hasThumbnail === lastHasThumbnail) return;
      lastHasThumbnail = hasThumbnail;
      probe.innerHTML = "";
      if (hasThumbnail) {
        probe.classList.add("has-thumbnail");
        probeTextContent.appendChild(probeTitle);
        probeTextContent.appendChild(probeDate);
        probe.appendChild(probeThumbnailTile);
        probe.appendChild(probeTextContent);
      } else {
        probe.classList.remove("has-thumbnail");
        probe.appendChild(probeTitle);
        probe.appendChild(probeDate);
      }
    };

    const BANNER_HEIGHT = bannerHeight;

    measureEvent = (title, tags, yearLabel, icon, thumbnail, thumbnailStyle, hideYears, sourceLink, eventBorderStyle) => {
      if (thumbnail && (thumbnailStyle === "square-fill" || thumbnailStyle === "circle-fill")) {
        const sqBorder = eventBorderStyle === "none" ? 0 : probeBorderSize;
        return { boxHeight: squareSize + sqBorder, isMultiLine: false, squareSize, boxWidth: squareSize + 4 };
      }
      const isBanner = thumbnail && thumbnailStyle === "banner";
      const hasStripThumb = thumbnail && !isBanner;
      const visibleTags = getVisiblePinnedTags(tags);
      const showDateRow = hideYears !== true || visibleTags.length > 0;
      const showYear = hideYears !== true;
      setupProbeLayout(hasStripThumb);
      probe.classList.toggle("has-source-link", !!sourceLink);
      syncProbeDateRow({
        showDateRow,
        showYear,
        visibleTags,
        hasThumbnailLayout: hasStripThumb,
      });
      const baseline = showDateRow
        ? (hasStripThumb ? thumbnailBaseContentHeight : baseContentHeight)
        : (hasStripThumb ? thumbnailNoYearBaseContentHeight : noYearBaseContentHeight);
      probeTitle.innerHTML = "";
      if (icon) probeTitle.appendChild(probeIcon);
      probeTitle.appendChild(document.createTextNode(title || "X"));
      if (showYear) {
        probeYearSpan.textContent = yearLabel || "0000";
      }
      const naturalHeight = probe.offsetHeight;
      const borderAdj = eventBorderStyle === "none" ? probeBorderSize : 0;
      if (isBanner) {
        probe.style.minHeight = '0';
        const textHeight = probe.offsetHeight;
        probe.style.minHeight = '';
        return { boxHeight: textHeight + BANNER_HEIGHT - borderAdj, isMultiLine: true, boxWidth: EVENT_WIDTH };
      }
      const isMultiLine = naturalHeight > baseline;
      const canonicalHeight = showDateRow ? singleLineHeight : noYearSingleLineHeight;
      return {
        boxHeight: (isMultiLine
          ? naturalHeight
          : hasStripThumb
            ? Math.max(naturalHeight, canonicalHeight)
            : canonicalHeight) - borderAdj,
        isMultiLine,
        boxWidth: EVENT_WIDTH,
      };
    };
  }

  // Probe-derived heights catch CSS/theme changes; fontEpoch catches width-only font swaps
  const configKey = JSON.stringify([
    fixedEventHeight, eventWidth, eventFontSize, fontFamily || "", pinnedTags,
    singleLineHeight, noYearSingleLineHeight, textContentHeight, probeBorderSize,
    fontEpoch,
  ]);
  if (configKey !== measureCacheConfig) {
    measureCacheConfig = configKey;
    measureCache = new Map();
  }
  const measureEventUncached = measureEvent;
  measureEvent = (title, tags, yearLabel, icon, thumbnail, thumbnailStyle, hideYears, sourceLink, eventBorderStyle) => {
    const key = JSON.stringify([title, tags, yearLabel, !!icon, thumbnail || "", thumbnailStyle || "", hideYears === true, !!sourceLink, eventBorderStyle || ""]);
    let box = measureCache.get(key);
    if (!box) {
      box = measureEventUncached(title, tags, yearLabel, icon, thumbnail, thumbnailStyle, hideYears, sourceLink, eventBorderStyle);
      if (measureCache.size >= 20000) measureCache.clear();
      measureCache.set(key, box);
    }
    return box;
  };

  // Use continuous vertical packing instead of discrete lanes
  const VERTICAL_GAP = Math.max(0, LANE_SPACING - singleLineHeight);
  const SPAN_BAND_CLEARANCE = 17;
  const LANE0_TOP = belowLine
    ? BASE_LINE_Y + spanBandHeight + BOX_OFFSET
    : BASE_LINE_Y - spanBandHeight - Math.max(BOX_OFFSET, singleLineHeight + SPAN_BAND_CLEARANCE);
  const placed = []; // { left, right, top, boxHeight }

  const finalEvents = laidOut.map((event) => {
    const x = event._x;
    const yearLabel = displayDateLabel(event.dateLabel) ?? formatYear(event.date, negID, posID, useCalendar, hideDecimals);
    const { boxHeight, isMultiLine, squareSize, boxWidth = EVENT_WIDTH } = measureEvent(
      event.title,
      event.tags,
      yearLabel,
      event.icon,
      event.thumbnail,
      event.thumbnailStyle,
      event.hideYears,
      event.sourceLink,
      event.eventBorderStyle
    );

    // Find placed events that horizontally overlap
    const left = x - boxWidth / 2;
    const right = x + boxWidth / 2;

    const conflicts = placed
      .filter((p) => p.right + EVENT_GAP > left)
      .sort((a, b) => belowLine ? a.top - b.top : b.top - a.top);

    let top;
    if (belowLine) {
      top = LANE0_TOP;
      for (const c of conflicts) {
        if (top < c.top + c.boxHeight + VERTICAL_GAP &&
            top + boxHeight + VERTICAL_GAP > c.top) {
          top = c.top + c.boxHeight + VERTICAL_GAP;
        }
      }
    } else {
      const minBottom = LANE0_TOP + singleLineHeight;
      top = Math.min(LANE0_TOP, minBottom - boxHeight);
      for (const c of conflicts) {
        if (top < c.top + c.boxHeight + VERTICAL_GAP &&
            top + boxHeight + VERTICAL_GAP > c.top) {
          top = c.top - boxHeight - VERTICAL_GAP;
        }
      }
    }

    placed.push({ left, right, top, boxHeight });

    return {
      ...event,
      top,
      _boxHeight: boxHeight,
      _boxWidth: boxWidth,
      _isMultiLine: isMultiLine,
      ...(squareSize && { _squareSize: squareSize }),
    };
  });

  document.body.removeChild(probe);

  return finalEvents;
}
