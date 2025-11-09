import { sampleData } from "./data/sampleData";
import "./index.css";

function pickStep(range) {
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

function App() {
  const { file, elements } = sampleData;

  const events = elements.filter((e) => e.type === "event");
  const spans = elements.filter((e) => e.type === "span");

  const PX_PER_YEAR = file?.maxZoom ?? 10;

  const eventYears = events.map((e) => e.date);
  const spanYears = spans.flatMap((s) => [s.start, s.end]);
  const allYears = [...eventYears, ...spanYears];

  const rawMin = Math.min(...allYears);
  const rawMax = Math.max(...allYears);

  const minYear = file?.start ?? rawMin;
  const maxYear = file?.end ?? rawMax;
  const range = maxYear - minYear;

  const step = pickStep(range);
  const timelineWidth = range * PX_PER_YEAR;

  const yearToPx = (year) => (year - minYear) * PX_PER_YEAR;

  const BASE_LINE_Y = 120;

  // SPANS
  const SPAN_HEIGHT = 23;
  const SPAN_OFFSET = 14;        
  const SPAN_GAP = 6;
  const SPAN_VERTICAL_GAP = 0;    

  const spanLaneEnds = [];
  const finalSpans = [...spans]
    .sort((a, b) => a.start - b.start)
    .map((span) => {
      const left = yearToPx(span.start);
      const width = (span.end - span.start) * PX_PER_YEAR;

      function spanFitsInLane(lane) {
        const end = spanLaneEnds[lane];
        return end === undefined || end + SPAN_GAP <= left;
      }

      let laneToUse = 0;
      while (true) {
        if (spanFitsInLane(laneToUse)) {
          spanLaneEnds[laneToUse] = left + width;
          break;
        }
        laneToUse++;
      }

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

  const spanRowsCount = spanLaneEnds.length;
  const spanBandHeight =
    spanRowsCount === 0
      ? 0
      : SPAN_OFFSET +
        SPAN_HEIGHT +
        (spanRowsCount - 1) * (SPAN_HEIGHT + SPAN_VERTICAL_GAP);

  // EVENTS
  const EVENT_WIDTH = 150;
  const EVENT_GAP = 6;
  const LANE_SPACING = 37;
  const BOX_OFFSET = 50; 

  const laidOutEvents = [...events]
    .sort((a, b) => a.date - b.date)
    .map((ev) => ({ ...ev, _x: yearToPx(ev.date) }));

  const laneEnds = [];

  const finalEvents = laidOutEvents.map((event, idx) => {
    const x = event._x;
    const preferredLane = idx % 2; // 0 or 1

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

    const top = BASE_LINE_Y - spanBandHeight - BOX_OFFSET - laneToUse * LANE_SPACING;
    return {
      ...event,
      top,
    };
  });

  // TIMELINE: TICKS
  const ticks = [];
  const startTick = Math.floor(minYear / step) * step;
  for (let y = startTick; y <= maxYear; y += step) {
    ticks.push(y);
  }

  const gridSize = 20 * (PX_PER_YEAR / 10);

  return (
    <div className="timeline-scroll">
      <div
        className="timeline"
        style={{
          width: `${timelineWidth}px`,
          "--grid-size": `${gridSize}px`,
        }}
      >
        <div
          className="timeline-line"
          style={{ top: `${BASE_LINE_Y}px` }}
        />

        <div className="spans-layer">
          {finalSpans.map((span) => (
            <div
              key={span.id}
              className="span-item"
              style={{
                left: `${span.left}px`,
                width: `${span.width}px`,
                top: `${span.top}px`,
                background: span.color || "var(--element-bg)",
              }}
            >
              <span className="span-title">{span.title}</span>
              <span className="span-years">
                {span.start} – {span.end} A.C.S
              </span>
            </div>
          ))}
        </div>


        <div className="events-layer">
          {finalEvents.map((event) => (
            <div
              key={event.id}
              className="event"
              style={{ left: `${event._x}px`, top: `${event.top}px` }}
            >
              <div className="event-title">{event.title}</div>
              <div className="event-date">{event.date}</div>
            </div>
          ))}
        </div>

        {ticks.map((year) => (
          <div
            key={year}
            className="tick"
            style={{ left: `${yearToPx(year)}px`, top: `${BASE_LINE_Y - 5}px` }}
          >
            <div className="tick-line" />
            <div className="tick-label">{year}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;