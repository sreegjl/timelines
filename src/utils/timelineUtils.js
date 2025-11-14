/* for timeline tick spacing */
export function pickStep(range) {
  const absRange = Math.abs(range);
  const targetTicks = 10;
  const roughStep = absRange / targetTicks;
  const exponent = Math.floor(Math.log10(roughStep));
  const base = roughStep / Math.pow(10, exponent);

  let niceBase;
  if (base < 1.5) niceBase = 1;
  else if (base < 3.5) niceBase = 2;
  else if (base < 7.5) niceBase = 5;
  else niceBase = 10;

  return niceBase * Math.pow(10, exponent);
}

// build child -> { parentId, offset } from spans
export function buildSpanChildPlacement(spans) {
  const placement = {};
  for (const span of spans) {
    // branches go BELOW parent (change later)
    if (Array.isArray(span.branches)) {
      for (const childId of span.branches) {
        placement[childId] = {
          parentId: span.id,
          offset: -1,
        };
      }
    }

    // forks alternate above/below
    if (Array.isArray(span.forks)) {
      span.forks.forEach((childId, index) => {
        const offset = index % 2 === 0 ? 1 : -1;
        placement[childId] = {
          parentId: span.id,
          offset,
        };
      });
    }
  }
  return placement;
}

export function calcSpanBandHeight(rows, offset, height, gap) {
  if (rows === 0) return 0;
  return offset + height + (rows - 1) * (height + gap);
}

// return positioned spans + lane info
export function layoutSpans({
  spans,
  yearToPx,
  BASE_LINE_Y,
  SPAN_HEIGHT,
  SPAN_OFFSET,
  SPAN_GAP,
  SPAN_VERTICAL_GAP,
  spanChildPlacement,
  PX_PER_YEAR,
}) {
  const spanLaneEnds = [];
  const spanLaneById = {};

  const finalSpans = [...spans]
    .sort((a, b) => {
      if (a.start === b.start) {
        return (b.end - b.start) - (a.end - a.start);
      }
      return a.start - b.start;
    })
    .map((span) => {
      const left = yearToPx(span.start);
      const width = (span.end - span.start) * PX_PER_YEAR;

      function spanFitsInLane(lane) {
        const end = spanLaneEnds[lane];
        return end === undefined || end + SPAN_GAP <= left;
      }

      // 1) figure out base lane (normal or parent-based)
      let baseLane;
      const placement = spanChildPlacement[span.id];
      if (placement) {
        const parentLane = spanLaneById[placement.parentId];
        if (parentLane !== undefined) {
          let desiredLane = parentLane + placement.offset;
          if (desiredLane < 0) desiredLane = 0;

          if (spanFitsInLane(desiredLane)) {
            baseLane = desiredLane;
          } else {
            baseLane = spanLaneEnds.length;
          }
        }
      }

      // 2) if no parent-based placement, pack from bottom
      if (baseLane === undefined) {
        let l = 0;
        while (true) {
          if (spanFitsInLane(l)) {
            baseLane = l;
            break;
          }
          l++;
        }
      }

      // 3) if span has forks, bump it up one lane if possible
      const hasForks = Array.isArray(span.forks) && span.forks.length > 0;
      let laneToUse = baseLane;
      if (hasForks) {
        const bumped = baseLane + 1;
        if (spanFitsInLane(bumped)) {
          laneToUse = bumped;
        } else {
          laneToUse = spanLaneEnds.length;
        }
      }

      // record usage + lane
      spanLaneEnds[laneToUse] = left + width;
      spanLaneById[span.id] = laneToUse;

      const top =
        BASE_LINE_Y -
        SPAN_OFFSET -
        SPAN_HEIGHT -
        laneToUse * (SPAN_HEIGHT + SPAN_VERTICAL_GAP);

      return {
        ...span,
        left,
        width,
        top,
      };
    });

  return { finalSpans, spanLaneEnds, spanLaneById };
}

export function layoutEvents({
  events,
  yearToPx,
  BASE_LINE_Y,
  spanBandHeight,
  EVENT_WIDTH,
  EVENT_GAP,
  LANE_SPACING,
  BOX_OFFSET,
}) {
  // add x-coords
  const laidOut = [...events]
    .sort((a, b) => a.date - b.date)
    .map((ev) => ({ ...ev, _x: yearToPx(ev.date) }));

  const laneEnds = [];

  const finalEvents = laidOut.map((event, idx) => {
    const x = event._x;
    const preferredLane = idx % 2;

    function fitsInLane(lane) {
      const end = laneEnds[lane];
      return end === undefined || end + EVENT_GAP <= x;
    }

    let laneToUse;
    if (fitsInLane(preferredLane)) {
      laneToUse = preferredLane;
    } else {
      let l = 0;
      while (true) {
        if (fitsInLane(l)) {
          laneToUse = l;
          break;
        }
        l++;
      }
    }

    laneEnds[laneToUse] = x + EVENT_WIDTH;

    const top =
      BASE_LINE_Y - spanBandHeight - BOX_OFFSET - laneToUse * LANE_SPACING;

    return {
      ...event,
      top,
    };
  });

  return finalEvents;
}