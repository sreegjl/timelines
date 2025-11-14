import { useEffect, useRef } from "react";
import { useTimelineData } from "../utils/useTimelineData";
import {
  pickStep,
  buildSpanChildPlacement,
  calcSpanBandHeight,
  layoutSpans,
  layoutEvents,
} from "../utils/timelineUtils";
import "../styles/04-timeline.css";

function TimelineView({ selectedId, onSelect }) {
  const scrollRef = useRef(null);
  const timelineRef = useRef(null);
  const scaleRef = useRef(1); 

  const { file, events, spans, eras } = useTimelineData();

  const PX_PER_YEAR = file?.maxZoom ?? 10;

  const allYears = [
    ...events.map((e) => e.date),
    ...spans.flatMap((s) => [s.start, s.end]),
    ...eras.flatMap((e) => [e.start, e.end]),
  ];

  const rawMin = Math.min(...allYears);
  const rawMax = Math.max(...allYears);

  const minYear = file?.start ?? rawMin;
  const maxYear = file?.end ?? rawMax;
  const range = maxYear - minYear;

  const step = pickStep(range);
  const timelineWidth = range * PX_PER_YEAR;

  const yearToPx = (year) => (year - minYear) * PX_PER_YEAR;

  const BASE_LINE_Y = 120;

  // spans
  const SPAN_HEIGHT = 23;
  const SPAN_OFFSET = 14;
  const SPAN_GAP = 6;
  const SPAN_VERTICAL_GAP = 0;

  const spanChildPlacement = buildSpanChildPlacement(spans);

  const { finalSpans, spanLaneEnds } = layoutSpans({
    spans,
    yearToPx,
    BASE_LINE_Y,
    SPAN_HEIGHT,
    SPAN_OFFSET,
    SPAN_GAP,
    SPAN_VERTICAL_GAP,
    spanChildPlacement,
    PX_PER_YEAR,
  });

  const spanBandHeight = calcSpanBandHeight(
    spanLaneEnds.length,
    SPAN_OFFSET,
    SPAN_HEIGHT,
    SPAN_VERTICAL_GAP
  );

  // events
  const EVENT_WIDTH = 150;
  const EVENT_GAP = 6;
  const LANE_SPACING = 37;
  const BOX_OFFSET = 50;

  const finalEvents = layoutEvents({
    events,
    yearToPx,
    BASE_LINE_Y,
    spanBandHeight,
    EVENT_WIDTH,
    EVENT_GAP,
    LANE_SPACING,
    BOX_OFFSET,
  });

  // eras
  const ERA_OFFSET = 30;
  const finalEras = eras.map((era) => {
    const left = yearToPx(era.start);
    const width = (era.end - era.start) * PX_PER_YEAR;
    const top = BASE_LINE_Y + ERA_OFFSET;
    return {
      ...era,
      left,
      width,
      top,
    };
  });

  // ticks
  const ticks = [];
  const startTick = Math.floor(minYear / step) * step;
  for (let y = startTick; y <= maxYear; y += step) {
    ticks.push(y);
  }

  // DPI + zoom effect
  useEffect(() => {
    const scrollEl = scrollRef.current;
    const timelineEl = timelineRef.current;
    if (!scrollEl || !timelineEl) return;

    const updateBackgroundForDPI = () => {
      const dpi = window.devicePixelRatio * 96;
      const size = Math.max(0.5, 1.3 - (dpi - 96) / 400);
      scrollEl.style.backgroundImage = `radial-gradient(var(--active-bg) ${size}px, transparent 0.4px)`;
    };
    updateBackgroundForDPI();
    window.addEventListener("resize", updateBackgroundForDPI);

    let scale = scaleRef.current;

    const handleWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;

      e.preventDefault();

      const scrollRect = scrollEl.getBoundingClientRect();
      const mouseXInScroll = e.clientX - scrollRect.left;

      const prevScrollLeft = scrollEl.scrollLeft;
      const prevScale = scale;

      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      const newScale = Math.min(Math.max(prevScale * zoomFactor, 0.25), 5);

      timelineEl.style.transformOrigin = "top left";
      timelineEl.style.transform = `scale(${newScale})`;

      const baseWidth = timelineEl.offsetWidth;
      const scaledWidth = baseWidth * newScale;
      const viewportWidth = scrollEl.clientWidth;

      if (scaledWidth > viewportWidth) {
        const worldX = (prevScrollLeft + mouseXInScroll) / prevScale;
        const newScrollLeft = worldX * newScale - mouseXInScroll;
        scrollEl.scrollLeft = newScrollLeft;
      } else {
        scrollEl.scrollLeft = 0;
        timelineEl.style.marginLeft = `${(viewportWidth - scaledWidth) / 2}px`;
      }

      if (scaledWidth > viewportWidth) {
        timelineEl.style.marginLeft = "0px";
      }

      scale = newScale;
      scaleRef.current = newScale; 
    };

    scrollEl.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      window.removeEventListener("resize", updateBackgroundForDPI);
      scrollEl.removeEventListener("wheel", handleWheel);
    };
  }, []);

  // auto-scroll to selected item
  useEffect(() => {
    if (!selectedId) return;

    const scrollEl = scrollRef.current;
    const timelineEl = timelineRef.current;
    if (!scrollEl || !timelineEl) return;

    const dom = timelineEl.querySelector(`[data-id="${selectedId}"]`);
    if (!dom) return;

    const rect = dom.getBoundingClientRect();
    const targetX = rect.left + rect.width / 2;

    const scrollRect = scrollEl.getBoundingClientRect();
    const viewportCenterX = scrollRect.left + scrollRect.width / 2;

    const scale = scaleRef.current || 1;
    const deltaX = (targetX - viewportCenterX) / scale;

    scrollEl.scrollTo({
      left: scrollEl.scrollLeft + deltaX,
      behavior: "smooth",
    });
  }, [selectedId]);

  return (
    <div
      ref={scrollRef}
      className="timeline-scroll"
      onClick={() => onSelect?.(null)} // clear selection on background click
    >
      <div
        ref={timelineRef}
        className="timeline"
        style={{ width: `${timelineWidth}px` }}
      >
        <div className="timeline-line" style={{ top: `${BASE_LINE_Y}px` }} />

        <div className="eras-layer">
          {finalEras.map((era) => {
            const isSelected = selectedId === era.id;
            return (
              <div
                key={era.id}
                data-id={era.id}
                className={`era-item ${isSelected ? "is-selected" : ""}`}
                style={{
                  left: `${era.left}px`,
                  width: `${era.width}px`,
                  top: `${era.top}px`,
                  background: `linear-gradient(
                    rgba(255,255,255,0.6),
                    rgba(255,255,255,0.6)
                  ), ${era.color || "var(--tertiary-bg)"}`,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect?.(era.id);
                }}
              >
                <span
                  className="era-title"
                  style={{
                    color: era.color ? era.color : "var(--dark-bg)",
                  }}
                >
                  {era.title}
                </span>
              </div>
            );
          })}
        </div>

        <div className="spans-layer">
          {finalSpans.map((span) => {
            const placement = spanChildPlacement[span.id];
            const isChild = !!placement;
            const isTopChild = isChild && placement.offset === 1;
            const isBottomChild = isChild && placement.offset === -1;
            const isSelected = selectedId === span.id;

            return (
              <div
                key={span.id}
                data-id={span.id}
                className={`span-item ${isSelected ? "is-selected" : ""}`}
                style={{
                  left: `${span.left}px`,
                  width: `${span.width}px`,
                  top: `${span.top}px`,
                  background: span.color || "var(--element-bg)",
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect?.(span.id);
                }}
              >
                {isTopChild && (
                  <div
                    className="span-connector-top"
                    style={{
                      backgroundColor: span.color || "var(--element-bg)",
                    }}
                  />
                )}
                {isBottomChild && (
                  <div
                    className="span-connector-bottom"
                    style={{
                      backgroundColor: span.color || "var(--element-bg)",
                    }}
                  />
                )}

                <span className="span-title">{span.title}</span>
                <span className="span-years">
                  {span.start} – {span.end} {file.posID}
                </span>
              </div>
            );
          })}
        </div>

        <div className="events-layer">
          {finalEvents.map((event) => {
            const parentId = event.parents?.[0];
            const parentSpan = parentId
              ? finalSpans.find((span) => span.id === parentId)
              : null;

            const fallbackTargetY = BASE_LINE_Y;
            const targetY = parentSpan ? parentSpan.top : fallbackTargetY;

            const EVENT_BOX_HEIGHT = 29;
            const eventBottom = event.top + EVENT_BOX_HEIGHT;

            const lineHeight = Math.abs(eventBottom - targetY);
            const parentColor = parentSpan?.color;
            const isSelected = selectedId === event.id;

            return (
              <div
                key={event.id}
                data-id={event.id}
                className={`event ${isSelected ? "is-selected" : ""}`}
                style={{
                  left: `${event._x}px`,
                  top: `${event.top}px`,
                  position: "absolute",
                  "--event-line-height": `${lineHeight}px`,
                  "--event-line-color": parentColor || "var(--element-bg)",
                  border: parentColor
                    ? `2px solid ${parentColor}`
                    : "2px solid var(--element-bg)",
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect?.(event.id);
                }}
              >
                <div className="event-title">{event.title}</div>
                <div className="event-date">{event.date}</div>
              </div>
            );
          })}
        </div>

        {ticks.map((year) => (
          <div
            key={year}
            className="tick"
            style={{
              left: `${yearToPx(year)}px`,
              top: `${BASE_LINE_Y - 5}px`,
            }}
          >
            <div className="tick-line" />
            <div className="tick-label">{year}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default TimelineView;
