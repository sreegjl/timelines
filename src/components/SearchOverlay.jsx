import { useState, useEffect, useRef, useMemo } from "react";
import { Search } from "lucide-react";
import { formatYear, withApproxLabel, formatApproxRange } from "../utils/timelineUtils";
import { parseFilterQuery, matchesFilter, buildFilterContext } from "../utils/filterUtils";

const TypeDot = () => <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "currentColor", flexShrink: 0 }} />;
const TypeBar = () => <span style={{ display: "inline-block", width: 12, height: 2, borderRadius: 1, background: "currentColor", flexShrink: 0 }} />;
const TypeBox = () => <span style={{ display: "inline-block", width: 9, height: 9, border: "2px solid currentColor", borderRadius: 2, flexShrink: 0 }} />;

function formatElementDate(el, fileSettings) {
  const negID = fileSettings?.negID || "BCE";
  const posID = fileSettings?.posID || "";
  const useCalendar = fileSettings?.useCalendar === true;
  const hideDecimals = fileSettings?.hideDecimals;

  const fmtYear = (year, label) => {
    if (label && typeof label === "string") return label;
    if (!Number.isFinite(year)) return "";
    return formatYear(year, negID, posID, useCalendar, hideDecimals);
  };

  if (el.type === "event") {
    return withApproxLabel(fmtYear(el.date, el.dateLabel), fileSettings?.approxID, el.approximate === true);
  }
  const start = fmtYear(el.start, el.startLabel);
  const end = fmtYear(el.end, el.endLabel);
  if (start && end) return formatApproxRange(el, start, end, fileSettings?.approxID, " – ");
  if (start) return withApproxLabel(start, fileSettings?.approxID, el.approxStart === true);
  return withApproxLabel(end || "", fileSettings?.approxID, el.approxEnd === true);
}

const TYPE_ICONS = {
  event: <TypeDot />,
  span: <TypeBar />,
  era: <TypeBox />,
};

const TYPE_LABELS = { event: "Event", span: "Span", era: "Era" };

export default function SearchOverlay({ isOpen, onClose, elements, onSelect, fileSettings }) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const activeItemRef = useRef(null);

  const parsedFilter = useMemo(() => parseFilterQuery(query), [query]);
  const filterContext = useMemo(() => buildFilterContext(elements), [elements]);
  const results = useMemo(() => {
    if (!query.trim()) return elements.slice(0, 50);
    return elements.filter((el) => matchesFilter(el, parsedFilter, null, filterContext));
  }, [query, elements, parsedFilter, filterContext]);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setActiveIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Scroll active item into view
  useEffect(() => {
    if (activeItemRef.current) {
      activeItemRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const el = results[activeIndex];
        if (el) {
          onSelect(el.id);
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [isOpen, results, activeIndex, onSelect, onClose]);

  if (!isOpen) return null;

  return (
    <div className="search-overlay-backdrop" onMouseDown={onClose}>
      <div
        className="search-overlay-panel"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="search-overlay-input-row">
          <Search size={15} className="search-overlay-icon" />
          <input
            ref={inputRef}
            className="search-overlay-input"
            placeholder="Search spans, events, eras…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
          <kbd className="search-overlay-esc">esc</kbd>
        </div>

        {results.length > 0 && (
          <div className="search-overlay-results" ref={listRef}>
            {results.map((el, i) => (
              <button
                key={el.id}
                ref={i === activeIndex ? activeItemRef : null}
                className={`search-result-item${i === activeIndex ? " search-result-item--active" : ""}`}
                onMouseDown={() => {
                  onSelect(el.id);
                  onClose();
                }}
                onMouseEnter={() => setActiveIndex(i)}
              >
                <span
                  className="search-result-type-badge"
                  data-type={el.type}
                >
                  {TYPE_ICONS[el.type]}
                  <span className="search-result-type-label">{TYPE_LABELS[el.type]}</span>
                </span>
                <span className="search-result-title">{el.title || "(untitled)"}</span>
                <span className="search-result-date">
                  {formatElementDate(el, fileSettings)}
                </span>
              </button>
            ))}
          </div>
        )}

        {results.length === 0 && (
          <div className="search-overlay-empty">
            No results for &ldquo;{query}&rdquo;
          </div>
        )}
      </div>
    </div>
  );
}
