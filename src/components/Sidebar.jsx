import { useMemo, useState } from "react";
import { PanelLeft, PanelRight, ChevronDown } from "lucide-react";
import { useTimelineData } from "../utils/useTimelineData";

export default function Sidebar({
  isCollapsed,
  onToggle,
  selectedId,
  onSelect,
}) {
  const { file, events, spans, eras } = useTimelineData();

  const [openEras, setOpenEras] = useState(true);
  const [openSpans, setOpenSpans] = useState(true);
  const [openEvents, setOpenEvents] = useState(true);

  const displayName = useMemo(() => {
    if (!file) return "";
    if (file.id?.endsWith("-timeline")) {
      return file.id.replace("-timeline", ".timeline");
    }
    return file.title || file.id || "";
  }, [file]);

  const fmtYear = (y) => {
    if (!file) return String(y);
    return y < 0 ? `${Math.abs(y)} ${file.negID}` : `${y} ${file.posID}`;
  };

  const eraRows = useMemo(
    () => [...eras].sort((a, b) => a.start - b.start),
    [eras]
  );

  const spanRows = useMemo(
    () =>
      [...spans].sort((a, b) =>
        a.start === b.start ? a.title.localeCompare(b.title) : a.start - b.start
      ),
    [spans]
  );

  const eventRows = useMemo(
    () => [...events].sort((a, b) => a.date - b.date),
    [events]
  );

  const Row = ({ item, rightText, level = 0 }) => {
    const isSelected = selectedId && selectedId === item.id;

    return (
      <button
        className={`sb-row ${isSelected ? "is-selected" : ""}`}
        style={{ paddingLeft: 16 + level * 16 }}
        onClick={() => onSelect?.(item.id)}
      >
        <span className="sb-row-title">{item.title}</span>
        <span className="sb-row-right">{rightText}</span>
      </button>
    );
  };

  return (
    <div className="sidebar-root">
      <div className="sidebar-header">
        {!isCollapsed && (
          <>
            <h2 className="timeline-title">{displayName}</h2>
            <ChevronDown
              className="sidebar-menu"
              size={16}
              color="var(--dark-bg)"
              strokeWidth={2}
            />
          </>
        )}

        <button
          className="sidebar-toggle"
          onClick={onToggle}
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={isCollapsed ? "Expand" : "Collapse"}
        >
          {isCollapsed ? (
            <PanelRight size={18} color="var(--dark-bg)" strokeWidth={2} />
          ) : (
            <PanelLeft size={18} color="var(--dark-bg)" strokeWidth={2} />
          )}
        </button>
      </div>

      {!isCollapsed && file && (
        <div className="sidebar-info">
          <h3 className="sidebar-info-title">{file.title}</h3>
        </div>
      )}

      {!isCollapsed && (
        <div className="sidebar-content">
          {/* ERAS */}
          <div className="sb-section">
            <button
              className="sb-section-head"
              onClick={() => setOpenEras((v) => !v)}
            >
              <ChevronDown
                className={`sb-caret ${openEras ? "open" : ""}`}
                size={16}
                strokeWidth={2}
              />
              <span className="sb-section-label">Eras</span>
            </button>
            {openEras && (
              <div className="sb-section-body">
                {eraRows.map((e) => (
                  <Row
                    key={e.id}
                    item={e}
                    rightText={`${fmtYear(e.start)} – ${fmtYear(e.end)}`}
                    level={0}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="sb-section">
            <button
              className="sb-section-head"
              onClick={() => setOpenSpans((v) => !v)}
            >
              <ChevronDown
                className={`sb-caret ${openSpans ? "open" : ""}`}
                size={16}
                strokeWidth={2}
              />
              <span className="sb-section-label">Spans</span>
            </button>
            {openSpans && (
              <div className="sb-section-body">
                {spanRows.map((s) => (
                  <Row
                    key={s.id}
                    item={s}
                    rightText={`${fmtYear(s.start)} – ${fmtYear(s.end)}`}
                    level={0}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="sb-section">
            <button
              className="sb-section-head"
              onClick={() => setOpenEvents((v) => !v)}
            >
              <ChevronDown
                className={`sb-caret ${openEvents ? "open" : ""}`}
                size={16}
                strokeWidth={2}
              />
              <span className="sb-section-label">Events</span>
            </button>
            {openEvents && (
              <div className="sb-section-body">
                {eventRows.map((ev) => (
                  <Row
                    key={ev.id}
                    item={ev}
                    rightText={fmtYear(ev.date)}
                    level={0}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
