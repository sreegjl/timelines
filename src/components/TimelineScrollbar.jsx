import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";
import { parseTimelineInput, snapToMonthGrid, snapToDayGrid } from "../utils/dateUtils";
import { formatYear } from "../utils/timelineUtils";

/**
 * Standalone scrollbar component.
 * Computes year range from timeline data and provides a
 * play/pause slider that scrubs through years without
 * needing the full TimelineView mounted.
 */
export default function TimelineScrollbar({
  timelineData,
  onYearChange,
  viewportPercent = 10,
  leftPanelWidth = 0,
  isLeftPanelOpen = false,
  rightPanelWidth = 0,
  isRightPanelOpen = false,
}) {
  const [sliderValue, setSliderValue] = useState(0);
  const [sliderYearLabel, setSliderYearLabel] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);

  const animationFrameRef = useRef(null);
  const lastPlayTimeRef = useRef(null);
  const sliderValueRef = useRef(0);
  const sliderElementRef = useRef(null);
  const yearLabelRef = useRef(null);
  const lastSliderLabelRef = useRef("");

  // Compute year range from timeline data
  const { compressedMin, compressedMax, decompressYear, file } = useMemo(() => {
    const file = timelineData?.file || {};
    const elements = timelineData?.elements || [];
    const useCalendar = file.useCalendar === true;

    const hasDayPrecision = (label) => {
      if (!label || typeof label !== "string") return false;
      const parts = label.split("/").map((p) => p.trim()).filter(Boolean);
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
      if (!label || typeof label !== "string") return adjustDate(value, label);
      const parsed = parseTimelineInput(label, undefined, false);
      if (Number.isFinite(parsed.value)) return adjustDate(parsed.value, label);
      return adjustDate(value, label);
    };

    const events = elements.filter((e) => e.type === "event");
    const spans = elements.filter((e) => e.type === "span");
    const eras = elements.filter((e) => e.type === "era");

    const allYears = [
      ...events.map((e) => resolveDate(e.date, e.dateLabel)),
      ...spans.flatMap((s) => [
        resolveDate(s.start, s.startLabel),
        resolveDate(s.end, s.endLabel),
      ]),
      ...eras.flatMap((e) => [
        resolveDate(e.start, e.startLabel),
        resolveDate(e.end, e.endLabel),
      ]),
    ];

    const rawMin = allYears.length > 0 ? Math.min(...allYears) : 0;
    const rawMax = allYears.length > 0 ? Math.max(...allYears) : 2024;
    const minYear = file.start ?? rawMin;
    const maxYear = file.end ?? rawMax;

    // Parse and normalize scale sections (with legacy breaks fallback)
    const parseScaleValue = (value) => {
      if (typeof value === "number") return value;
      if (typeof value === "string") {
        const parsed = parseTimelineInput(value, undefined, false);
        return Number.isFinite(parsed.value) ? parsed.value : null;
      }
      return null;
    };

    const normalizeScaleSections = (sections, legacyBreaks, min, max) => {
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
          return { start: clippedStart, end: clippedEnd, scale };
        })
        .filter(Boolean)
        .sort((a, b) => a.start - b.start);

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

    const normalizedScaleSections = normalizeScaleSections(
      file.scaleSections, file.breaks, minYear, maxYear
    );

    const compressYear = (year) => {
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

    const decompressYear = (compressedYear) => {
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

    return {
      compressedMin: compressYear(minYear),
      compressedMax: compressYear(maxYear),
      decompressYear,
      file,
    };
  }, [timelineData]);

  // Compute year label from slider value
  useEffect(() => {
    if (isPlaying) return; // animation updates label directly via DOM

    const range = compressedMax - compressedMin;
    if (range <= 0) return;

    const compressedYear = compressedMin + (sliderValue / 100) * range;
    const clamped = Math.min(Math.max(compressedYear, compressedMin), compressedMax);
    const rawYear = decompressYear(clamped);
    const showCalendar = file.useCalendar === true;
    const snappedYear = showCalendar ? snapToDayGrid(rawYear) : Math.round(rawYear);
    const nextLabel = formatYear(snappedYear, file.negID, file.posID, showCalendar, file.hideDecimals);

    if (nextLabel !== lastSliderLabelRef.current) {
      lastSliderLabelRef.current = nextLabel;
      setSliderYearLabel(nextLabel);
    }
    onYearChange?.(snappedYear);
  }, [sliderValue, isPlaying, compressedMin, compressedMax, decompressYear, file]);

  // Animation loop
  useEffect(() => {
    if (!isPlaying) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      lastPlayTimeRef.current = null;
      return;
    }

    const capturedMin = compressedMin;
    const capturedMax = compressedMax;
    const capturedDecompress = decompressYear;
    const capturedFile = file;
    const range = capturedMax - capturedMin;

    if (range <= 0) {
      setIsPlaying(false);
      return;
    }

    // Scrub speed: traverse the full range in ~10 seconds
    const percentPerSec = 100 / 10;

    const animate = (time) => {
      if (lastPlayTimeRef.current === null) {
        lastPlayTimeRef.current = time;
      }

      const deltaMs = time - lastPlayTimeRef.current;
      lastPlayTimeRef.current = time;

      const deltaPct = (percentPerSec * deltaMs) / 1000;
      let nextValue = sliderValueRef.current + deltaPct;
      nextValue = Math.min(100, Math.max(0, nextValue));
      sliderValueRef.current = nextValue;

      // Update slider DOM directly
      if (sliderElementRef.current) {
        sliderElementRef.current.value = nextValue;
      }

      // Compute year label
      const compressedYear = capturedMin + (nextValue / 100) * range;
      const clamped = Math.min(Math.max(compressedYear, capturedMin), capturedMax);
      const rawYear = capturedDecompress(clamped);
      const showCalendar = capturedFile.useCalendar === true;
      const snappedYear = showCalendar ? snapToDayGrid(rawYear) : Math.round(rawYear);
      const nextLabel = formatYear(snappedYear, capturedFile.negID, capturedFile.posID, showCalendar, capturedFile.hideDecimals);

      if (yearLabelRef.current && nextLabel !== lastSliderLabelRef.current) {
        lastSliderLabelRef.current = nextLabel;
        yearLabelRef.current.textContent = nextLabel;
      }

      if (nextValue >= 100 - 0.01) {
        // Reached the end — sync React state and stop
        setSliderValue(nextValue);
        setSliderYearLabel(nextLabel);
        onYearChange?.(snappedYear);
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

  const handleSliderChange = (e) => {
    if (e?.nativeEvent && e.nativeEvent.isTrusted === false) return;
    const value = parseFloat(e.target.value);
    if (!Number.isFinite(value)) return;
    sliderValueRef.current = value;
    setSliderValue(value);
  };

  const handlePlayPause = () => {
    if (isPlaying) {
      // Sync React state with current DOM values when pausing
      setSliderValue(sliderValueRef.current);
      if (yearLabelRef.current) {
        setSliderYearLabel(yearLabelRef.current.textContent || "");
      }
    }
    setIsPlaying(!isPlaying);
  };

  // Offset to center the slider between panels
  const leftOffset = isLeftPanelOpen ? leftPanelWidth : 0;
  const rightOffset = isRightPanelOpen ? rightPanelWidth : 0;
  const sliderOffset = leftOffset - rightOffset;

  return (
    <div
      className="timeline-slider-container"
      style={{ left: `calc(50% + ${sliderOffset / 2}px)` }}
    >
      <button
        className="slider-play-button"
        onClick={handlePlayPause}
        aria-label={isPlaying ? "Pause" : "Play"}
        title={isPlaying ? "Pause" : "Play"}
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
          className="timeline-slider"
        />
        <div
          className="slider-viewport-indicator"
          style={{
            left: (() => {
              const vp = Math.min(100, Math.max(1, viewportPercent));
              const halfWidth = vp / 2;
              const safeRange = 100 - vp;
              return `${halfWidth + (sliderValue / 100) * safeRange}%`;
            })(),
            width: `${Math.min(100, Math.max(1, viewportPercent))}%`,
          }}
        />
      </div>
      <div ref={yearLabelRef} className="slider-year">
        {sliderYearLabel}
      </div>
    </div>
  );
}
