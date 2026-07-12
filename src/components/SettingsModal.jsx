import { ArrowLeft, Plus, X } from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";
import { parseTimelineInput, snapToMonthGrid } from "../utils/dateUtils";
import { DETAIL_MIN, DETAIL_MID, DETAIL_MAX, TICK_DENSITY_MIN, TICK_DENSITY_MID, TICK_DENSITY_MAX, clamp, detailToSlider, sliderToDetail, tickDensityToSlider, sliderToTickDensity } from "../utils/sliderUtils";
import { sanitizeTitle, loadScaleSections, validateScaleSection } from "../utils/validation";
import { themeOptionLabel } from "../utils/themeLoader";
import "../styles/07-modals-menus.css";

const MAP_MARKER_OPTIONS = [
  { value: "pin", label: "Pin" },
  { value: "circle", label: "Circle" },
  { value: "square", label: "Square" },
  { value: "diamond", label: "Diamond" },
  { value: "triangle", label: "Triangle" },
];
const DEFAULT_EVENT_MARKER = "pin";
const DEFAULT_SPAN_MARKER = "circle";
const DEFAULT_ERA_MARKER = "diamond";

export default function SettingsModal({
  isOpen,
  onClose,
  onOpenAppSettings,
  isCovered = false,
  timelineData,
  onUpdateTimeline,
  renameErrorMessage = "",
  onClearRenameError,
  themeKey,
  defaultThemeKey,
  themes,
  fonts,
  onThemeChange,
  oldFormatThemeCount = 0,
  onMigrateOldThemes,
  layoutOptions = [],
}) {
  const [title, setTitle] = useState("");
  // Title drives the filename on disk, so it only commits on blur/Enter/close, not per keystroke
  const [committedTitle, setCommittedTitle] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [detailLevel, setDetailLevel] = useState(1);
  const [detailSlider, setDetailSlider] = useState(50);
  const [showDetailTooltip, setShowDetailTooltip] = useState(false);
  const [detailTooltipLeft, setDetailTooltipLeft] = useState(0);
  const [tickDensity, setTickDensity] = useState(1);
  const [tickDensitySlider, setTickDensitySlider] = useState(50);
  const [showTickDensityTooltip, setShowTickDensityTooltip] = useState(false);
  const [tickDensityTooltipLeft, setTickDensityTooltipLeft] = useState(0);
  const [layout, setLayout] = useState("Horizontal");
  const [theme, setTheme] = useState(defaultThemeKey || "");
  const [fontFamily, setFontFamily] = useState("default");
  const [useCalendar, setUseCalendar] = useState(false);
  const [scaleSections, setScaleSections] = useState([]);
  const [scaleType, setScaleType] = useState("default");
  const [logScaleFactor, setLogScaleFactor] = useState(10);
  const [negID, setNegID] = useState("");
  const [posID, setPosID] = useState("");
  const [branchOrdering, setBranchOrdering] = useState("later-first");
  const [fixedEventHeight, setFixedEventHeight] = useState(false);
  const [eventWidth, setEventWidth] = useState(150);
  const [eventFontSize, setEventFontSize] = useState(10);
  const [thinConnectors, setThinConnectors] = useState(false);
  const [hideSpanConnectors, setHideSpanConnectors] = useState(false);
  const [eventLinesToGroupBottom, setEventLinesToGroupBottom] = useState(false);
  const [hideDecimals, setHideDecimals] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [spanColorEvents, setSpanColorEvents] = useState(false);
  const [disableGroups, setDisableGroups] = useState(false);
  const [panelGroupMode, setPanelGroupMode] = useState("default");
  const [nestEraSubGroups, setNestEraSubGroups] = useState(false);
  const [showPopularTags, setShowPopularTags] = useState(true);
  const [keepSelection, setKeepSelection] = useState(false);
  const [useSecondaryBg, setUseSecondaryBg] = useState(false);
  const [useWiki, setUseWikipedia] = useState(false);
  const [useSpreadsheet, setUseSpreadsheet] = useState(false);
  const [useMaps, setUseMaps] = useState(false);
  const [mapTileUrl, setMapTileUrl] = useState("");
  const [mapLimitToViewportYear, setMapLimitToViewportYear] = useState(false);
  const [mapEventMarker, setMapEventMarker] = useState(DEFAULT_EVENT_MARKER);
  const [mapSpanMarker, setMapSpanMarker] = useState(DEFAULT_SPAN_MARKER);
  const [mapEraMarker, setMapEraMarker] = useState(DEFAULT_ERA_MARKER);
  const [settingsSection, setSettingsSection] = useState("general");
  const [isInitialized, setIsInitialized] = useState(false);
  const [validationErrors, setValidationErrors] = useState([]);
  const [scaleSectionErrors, setScaleSectionErrors] = useState([]);
  const [themeMigrationStatus, setThemeMigrationStatus] = useState(null); // null | 'migrating' | { count }
  const saveTimeoutRef = useRef(null);
  const detailSliderRef = useRef(null);
  const tickDensitySliderRef = useRef(null);
  const titleInputRef = useRef(null);
  const lastFilePathRef = useRef(null);
  const backdropPointerDownRef = useRef(false);
  const onUpdateTimelineRef = useRef(onUpdateTimeline);

  // Convert editable scale sections (strings) to numeric for saving
  const saveScaleSections = (editable = []) => {
    const out = [];
    const errors = [];
    editable.forEach((item, index) => {
      const error = validateScaleSection(item);
      errors[index] = error;

      if (error) return;
      const startRaw = item?.start?.trim() || "";
      const endRaw = item?.end?.trim() || "";
      if (!startRaw || !endRaw) return;

      const parsedStart = parseTimelineInput(startRaw);
      const parsedEnd = parseTimelineInput(endRaw);

      const startVal = parsedStart.value;
      const endVal = parsedEnd.value;
      const scale = Math.max(0, Math.min(2, Number(item?.scale) || 0));

      const ordered = startVal < endVal
        ? { start: startVal, end: endVal, scale }
        : { start: endVal, end: startVal, scale };
      out.push({ ...ordered, showBreak: item?.showBreak !== false });
    });
    setScaleSectionErrors(errors);
    return out;
  };

  const handleMigrateOldThemes = async () => {
    if (!onMigrateOldThemes) return;
    setThemeMigrationStatus("migrating");
    const count = await onMigrateOldThemes();
    setThemeMigrationStatus({ count });
    setTimeout(() => setThemeMigrationStatus(null), 3000);
  };

  const addScaleSection = () => {
    setScaleSections([...scaleSections, { start: "", end: "", scale: "0", showBreak: true }]);
    setScaleSectionErrors((prev) => [...prev, null]);
  };

  const removeScaleSection = (index) => {
    setScaleSections(scaleSections.filter((_, i) => i !== index));
    setScaleSectionErrors((prev) => prev.filter((_, i) => i !== index));
  };

  const updateScaleSection = (index, field, value) => {
    const next = scaleSections.map((s, i) => (i === index ? { ...s, [field]: value } : s));
    setScaleSections(next);
    setScaleSectionErrors((prev) => {
      const nextErrors = [...prev];
      nextErrors[index] = validateScaleSection(next[index]);
      return nextErrors;
    });
  };

  const updateDetailTooltipPosition = useCallback(() => {
    const sliderEl = detailSliderRef.current;
    if (!sliderEl) return;
    const sliderWidth = sliderEl.getBoundingClientRect().width;
    const thumbSize = 20;
    const left = (detailSlider / 100) * (sliderWidth - thumbSize) + thumbSize / 2;
    setDetailTooltipLeft(left);
  }, [detailSlider]);

  const updateTickDensityTooltipPosition = useCallback(() => {
    const sliderEl = tickDensitySliderRef.current;
    if (!sliderEl) return;
    const sliderWidth = sliderEl.getBoundingClientRect().width;
    const thumbSize = 20;
    const left = (tickDensitySlider / 100) * (sliderWidth - thumbSize) + thumbSize / 2;
    setTickDensityTooltipLeft(left);
  }, [tickDensitySlider]);

  const commitTitle = useCallback(() => {
    setCommittedTitle((prev) => (title.trim() && sanitizeTitle(title) ? title : prev));
  }, [title]);

  const handleClose = useCallback(() => {
    commitTitle();
    onClose();
  }, [commitTitle, onClose]);

  useEffect(() => {
    onUpdateTimelineRef.current = onUpdateTimeline;
  }, [onUpdateTimeline]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => { if (e.key === "Escape") handleClose(); };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleClose]);

  useEffect(() => {
    updateDetailTooltipPosition();
    window.addEventListener("resize", updateDetailTooltipPosition);
    return () => window.removeEventListener("resize", updateDetailTooltipPosition);
  }, [updateDetailTooltipPosition]);

  useEffect(() => {
    if (timelineData?.file) {
      const currentPath = timelineData.path || timelineData.file.id || timelineData.file.title;
      const isNewFile = lastFilePathRef.current !== currentPath;

      if (!isNewFile) {
        setPanelGroupMode(timelineData.file.panelGroupMode || (timelineData.file.useEraGroupsInPanel ? "eras" : "default"));
        setNestEraSubGroups(Boolean(timelineData.file.nestEraSubGroups));
      } else {
        setTitle(timelineData.file.title || "");
        setCommittedTitle(timelineData.file.title || "");
        setStart(String(timelineData.file.startLabel ?? timelineData.file.start ?? ""));
        setEnd(String(timelineData.file.endLabel ?? timelineData.file.end ?? ""));
        const rawDetail = Number(timelineData.file.detailLevel);
        const nextDetailLevel = Number.isFinite(rawDetail) ? rawDetail : 1;
        const clampedDetail = clamp(nextDetailLevel, DETAIL_MIN, DETAIL_MAX);
        setDetailLevel(clampedDetail);
        setDetailSlider(detailToSlider(clampedDetail));
        const rawDensity = Number(timelineData.file.tickDensity);
        const nextDensity = Number.isFinite(rawDensity) && rawDensity > 0 ? rawDensity : 1;
        const clampedDensity = clamp(nextDensity, TICK_DENSITY_MIN, TICK_DENSITY_MAX);
        setTickDensity(clampedDensity);
        setTickDensitySlider(tickDensityToSlider(clampedDensity));
        setTheme(timelineData.file.theme || defaultThemeKey || "");
        setFontFamily(timelineData.file.font || "default");
        setLayout(timelineData.file.layout || "Horizontal");
        setUseCalendar(Boolean(timelineData.file.useCalendar ?? timelineData.file.useDays ?? timelineData.file.useMonths));
        setScaleSections(loadScaleSections(timelineData.file.scaleSections, timelineData.file.breaks));
        setScaleType(timelineData.file.scaleType || "default");
        setLogScaleFactor(Number.isFinite(Number(timelineData.file.logScaleFactor)) && Number(timelineData.file.logScaleFactor) >= 1 ? Number(timelineData.file.logScaleFactor) : 10);
        setNegID(timelineData.file.negID || "");
        setPosID(timelineData.file.posID || "");
        setBranchOrdering(timelineData.file.branchOrdering || "later-first");
        setFixedEventHeight(Boolean(timelineData.file.fixedEventHeight));
        let rawWidth = timelineData.file.eventWidth;
        let rawFontSize = timelineData.file.eventFontSize;
        if (rawWidth == null && timelineData.file.compactEvents) { rawWidth = 130; rawFontSize = 7; }
        setEventWidth(rawWidth ?? 150);
        setEventFontSize(rawFontSize ?? 10);
        setThinConnectors(Boolean(timelineData.file.thinConnectors));
        setHideSpanConnectors(Boolean(timelineData.file.hideSpanConnectors));
        setEventLinesToGroupBottom(Boolean(timelineData.file.eventLinesToGroupBottom));
        setHideDecimals(Boolean(timelineData.file.hideDecimals));
        setShowGrid(Boolean(timelineData.file.showGrid));
        setSpanColorEvents(Boolean(timelineData.file.spanColorEvents));
        setDisableGroups(Boolean(timelineData.file.disableGroups));
        setPanelGroupMode(timelineData.file.panelGroupMode || (timelineData.file.useEraGroupsInPanel ? "eras" : "default"));
        setNestEraSubGroups(Boolean(timelineData.file.nestEraSubGroups));
        setShowPopularTags(timelineData.file.showPopularTags !== false);
        setKeepSelection(Boolean(timelineData.file.keepSelection));
        setUseSecondaryBg(Boolean(timelineData.file.useSecondaryBg));
        setUseWikipedia(Boolean(timelineData.file.useWiki));
        setUseSpreadsheet(Boolean(timelineData.file.useSpreadsheet));
        setUseMaps(Boolean(timelineData.file.useMaps));
        setMapTileUrl(timelineData.file.mapTileUrl || "");
        setMapLimitToViewportYear(Boolean(timelineData.file.mapLimitToViewportYear));
        setMapEventMarker(timelineData.file.mapEventMarker || DEFAULT_EVENT_MARKER);
        setMapSpanMarker(timelineData.file.mapSpanMarker || DEFAULT_SPAN_MARKER);
        setMapEraMarker(timelineData.file.mapEraMarker || DEFAULT_ERA_MARKER);
        setValidationErrors([]);
        setScaleSectionErrors([]);
        lastFilePathRef.current = currentPath;
        setIsInitialized(true);
      }
    }
  }, [timelineData, defaultThemeKey]);

  useEffect(() => {
    if (!renameErrorMessage || !timelineData?.file) return;
    const restoredTitle = timelineData.file.title || "";
    setTitle(restoredTitle);
    setCommittedTitle(restoredTitle);
    const timeoutId = window.setTimeout(() => {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [renameErrorMessage, timelineData]);

  useEffect(() => {
    if (!layoutOptions.some((option) => option.value === layout)) {
      setLayout("Horizontal");
    }
  }, [layoutOptions, layout]);

  // Debounced auto-save whenever values change (but not on initial load)
  useEffect(() => {
    if (!isOpen || !isInitialized) return;

    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Set new timeout to save after 300ms of no changes
    saveTimeoutRef.current = setTimeout(() => {
      const parsedStart = parseTimelineInput(start);
      const parsedEnd = parseTimelineInput(end);
      const errors = [];

      if (!title.trim()) {
        errors.push("Timeline name is required.");
      } else if (!sanitizeTitle(title)) {
        errors.push("Timeline name must include at least one letter or number.");
      }

      if (!Number.isFinite(parsedStart.value)) {
        errors.push("Start point must be a number or MM/DD/YYYY.");
      }
      if (!Number.isFinite(parsedEnd.value)) {
        errors.push("End point must be a number or MM/DD/YYYY.");
      }
      if (
        Number.isFinite(parsedStart.value) &&
        Number.isFinite(parsedEnd.value) &&
        parsedStart.value >= parsedEnd.value
      ) {
        errors.push("Start point must be less than end point.");
      }

      if (errors.length > 0) {
        setValidationErrors(errors);
        return;
      }

      setValidationErrors([]);

      const startValue =
        useCalendar && parsedStart.precision !== "day"
          ? snapToMonthGrid(parsedStart.value)
          : parsedStart.value;
      const endValue =
        useCalendar && parsedEnd.precision !== "day"
          ? snapToMonthGrid(parsedEnd.value)
          : parsedEnd.value;
      const parsedScaleSections = saveScaleSections(scaleSections);
      if (onUpdateTimelineRef.current) {
        onUpdateTimelineRef.current({
          title: committedTitle,
          start: startValue,
          end: endValue,
          detailLevel: Number(detailLevel),
          tickDensity: Number(tickDensity) !== 1 ? Number(tickDensity) : undefined,
          negID,
          posID,
          theme,
          font: fontFamily,
          startLabel: parsedStart.label,
          endLabel: parsedEnd.label,
          useCalendar: useCalendar || undefined,
          scaleSections: parsedScaleSections,
          scaleType: scaleType !== "default" ? scaleType : undefined,
          logScaleFactor: scaleType === "logarithmic" ? logScaleFactor : undefined,
          layout,
          branchOrdering,
          fixedEventHeight,
          eventWidth,
          eventFontSize,
          thinConnectors,
          hideSpanConnectors,
          eventLinesToGroupBottom,
          hideDecimals,
          showGrid,
          spanColorEvents,
          disableGroups,
          panelGroupMode,
          nestEraSubGroups,
          showPopularTags,
          keepSelection,
          useSecondaryBg,
          useWiki,
          useSpreadsheet,
          useMaps,
          mapTileUrl,
          mapLimitToViewportYear,
          mapEventMarker,
          mapSpanMarker,
          mapEraMarker,
        });
      }
    }, 300);

    // Cleanup timeout on unmount
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [
    title,
    committedTitle,
    start,
    end,
    detailLevel,
    tickDensity,
    negID,
    posID,
    theme,
    fontFamily,
    useCalendar,
    layout,
    scaleSections,
    scaleType,
    logScaleFactor,
    branchOrdering,
    fixedEventHeight,
    eventWidth,
    eventFontSize,
    thinConnectors,
    hideSpanConnectors,
    eventLinesToGroupBottom,
    hideDecimals,
    showGrid,
    spanColorEvents,
    disableGroups,
    panelGroupMode,
    nestEraSubGroups,
    showPopularTags,
    keepSelection,
    useSecondaryBg,
    useWiki,
    useSpreadsheet,
    useMaps,
    mapTileUrl,
    mapLimitToViewportYear,
    mapEventMarker,
    mapSpanMarker,
    mapEraMarker,
    isInitialized,
    isOpen,
  ]);

  if (!isOpen) return null;

  const fontNames = Array.from(
    new Set(
      (fonts || [])
        .map((font) => font?.name?.trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));

  const fontOptions = [
    { value: "default", label: "Default (App Font)" },
    { value: "Inter", label: "Inter" },
    ...fontNames.map((name) => ({ value: name, label: name })),
  ];

  if (fontFamily && !fontOptions.some((option) => option.value === fontFamily)) {
    fontOptions.unshift({
      value: fontFamily,
      label: `${fontFamily} (Missing)`,
    });
  }

  const handleBackdropMouseDown = (e) => {
    backdropPointerDownRef.current = e.target === e.currentTarget;
  };

  const handleBackdropMouseUp = (e) => {
    if (backdropPointerDownRef.current && e.target === e.currentTarget) {
      handleClose();
    }
    backdropPointerDownRef.current = false;
  };

  return (
    <div
      className={`settings-backdrop${isCovered ? " is-covered" : ""}`}
      onMouseDown={handleBackdropMouseDown}
      onMouseUp={handleBackdropMouseUp}
    >
      <div className="settings-modal">
        <div className="settings-header">
          <button
            className="settings-back-button"
            onClick={handleClose}
            aria-label="Close settings"
          >
            <ArrowLeft size={20} strokeWidth={2} />
          </button>
          <h2 className="settings-title">SETTINGS</h2>
        </div>

        {(renameErrorMessage || validationErrors.length > 0) && (
          <div className="settings-errors">
            {renameErrorMessage && (
              <div className="settings-error">
                {renameErrorMessage}
              </div>
            )}
            {validationErrors.map((error, index) => (
              <div key={index} className="settings-error">
                {error}
              </div>
            ))}
          </div>
        )}

        <div className="settings-layout">
          <div className="settings-sidebar">
            <button
              type="button"
              className={`settings-sidebar-item${settingsSection === "general" ? " is-active" : ""}`}
              onClick={() => setSettingsSection("general")}
            >
              General
            </button>
            <button
              type="button"
              className={`settings-sidebar-item${settingsSection === "appearance" ? " is-active" : ""}`}
              onClick={() => setSettingsSection("appearance")}
            >
              Appearance
            </button>
            <button
              type="button"
              className={`settings-sidebar-item${settingsSection === "advanced" ? " is-active" : ""}`}
              onClick={() => setSettingsSection("advanced")}
            >
              Advanced
            </button>
            {useMaps && (
              <button
                type="button"
                className={`settings-sidebar-item${settingsSection === "maps" ? " is-active" : ""}`}
                onClick={() => setSettingsSection("maps")}
              >
                Maps
              </button>
            )}
          </div>

          <div className="settings-content">
          {settingsSection === "general" && (
            <>
            <div className="settings-row">
              <div className="settings-row-left">
                <div className="settings-row-label">App Settings</div>
                <div className="settings-row-description">
                  Open global settings for themes and files.
                </div>
              </div>
              <div className="settings-row-right">
                <button
                  type="button"
                  className="settings-folder-button"
                  onClick={onOpenAppSettings}
                >
                  Open App Settings
                </button>
              </div>
            </div>
            {/* Timeline Name */}
            <div className="settings-row">
            <div className="settings-row-left">
              <div className="settings-row-label">Timeline Name</div>
              <div className="settings-row-description">Your file will be saved as: {sanitizeTitle(title) || "untitled"}.timeline</div>
            </div>
            <div className="settings-row-right">
              <input
                ref={titleInputRef}
                type="text"
                className="settings-input"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (renameErrorMessage) onClearRenameError?.();
                  if (validationErrors.length) setValidationErrors([]);
                }}
                onBlur={commitTitle}
                onKeyDown={(e) => { if (e.key === "Enter") commitTitle(); }}
                placeholder="Enter timeline name"
                maxLength={100}
              />
            </div>
          </div>

          {/* Start Point */}
          <div className="settings-row no-border-bottom">
            <div className="settings-row-left">
              <div className="settings-row-label">Start Point</div>
              <div className="settings-row-description">The first year/date shown on the timeline.</div>
            </div>
            <div className="settings-row-right">
              <input
                type="text"
                inputMode="numeric"
                className="settings-input settings-input-small"
                value={start}
                onChange={(e) => {
                  setStart(e.target.value);
                  if (validationErrors.length) setValidationErrors([]);
                }}
                maxLength={20}
              />
            </div>
          </div>

          {/* End Point */}
          <div className="settings-row">
            <div className="settings-row-left">
              <div className="settings-row-label">End Point</div>
              <div className="settings-row-description">The last year/date shown on the timeline.</div>
            </div>
            <div className="settings-row-right">
              <input
                type="text"
                inputMode="numeric"
                className="settings-input settings-input-small"
                value={end}
                onChange={(e) => {
                  setEnd(e.target.value);
                  if (validationErrors.length) setValidationErrors([]);
                }}
                maxLength={20}
              />
            </div>
          </div>

          {/* Timeline Length */}
          <div className="settings-row">
            <div className="settings-row-left">
              <div className="settings-row-label">Timeline Length</div>
              <div className="settings-row-description">Higher values can fit more events with less overlap.</div>
            </div>
            <div className="settings-row-right">
              <div className="settings-slider-wrap">
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  className="settings-slider"
                  value={detailSlider}
                  ref={detailSliderRef}
                  onChange={(e) => {
                    const nextPosition = Number(e.target.value);
                    const rawDetail = sliderToDetail(nextPosition);
                    const snappedDetail = Number((Math.round(rawDetail * 10) / 10).toFixed(1));
                    setDetailLevel(snappedDetail);
                    setDetailSlider(detailToSlider(snappedDetail));
                  }}
                  onMouseEnter={() => {
                    updateDetailTooltipPosition();
                    setShowDetailTooltip(true);
                  }}
                  onMouseLeave={() => setShowDetailTooltip(false)}
                  onMouseDown={() => {
                    updateDetailTooltipPosition();
                    setShowDetailTooltip(true);
                  }}
                  onMouseUp={() => setShowDetailTooltip(false)}
                  onFocus={() => {
                    updateDetailTooltipPosition();
                    setShowDetailTooltip(true);
                  }}
                />
                {showDetailTooltip && (
                  <div
                    className="settings-slider-tooltip"
                    style={{ left: detailTooltipLeft }}
                  >
                    {detailLevel}x
                  </div>
                )}
                <div className="settings-slider-labels">
                  <span className="settings-slider-label settings-slider-label-min">{DETAIL_MIN}</span>
                  <span className="settings-slider-label settings-slider-label-mid">{DETAIL_MID}</span>
                  <span className="settings-slider-label settings-slider-label-max">{DETAIL_MAX}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Tick Density */}
          <div className="settings-row">
            <div className="settings-row-left">
              <div className="settings-row-label">Tick Density</div>
              <div className="settings-row-description">Control how many tick marks appear on the timeline axis.</div>
            </div>
            <div className="settings-row-right">
              <div className="settings-slider-wrap">
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  className="settings-slider"
                  value={tickDensitySlider}
                  ref={tickDensitySliderRef}
                  onChange={(e) => {
                    const nextPosition = Number(e.target.value);
                    const rawDensity = sliderToTickDensity(nextPosition);
                    const snappedDensity = Number((Math.round(rawDensity * 10) / 10).toFixed(1));
                    setTickDensity(snappedDensity);
                    setTickDensitySlider(tickDensityToSlider(snappedDensity));
                  }}
                  onMouseEnter={() => {
                    updateTickDensityTooltipPosition();
                    setShowTickDensityTooltip(true);
                  }}
                  onMouseLeave={() => setShowTickDensityTooltip(false)}
                  onMouseDown={() => {
                    updateTickDensityTooltipPosition();
                    setShowTickDensityTooltip(true);
                  }}
                  onMouseUp={() => setShowTickDensityTooltip(false)}
                  onFocus={() => {
                    updateTickDensityTooltipPosition();
                    setShowTickDensityTooltip(true);
                  }}
                />
                {showTickDensityTooltip && (
                  <div
                    className="settings-slider-tooltip"
                    style={{ left: tickDensityTooltipLeft }}
                  >
                    {tickDensity}x
                  </div>
                )}
                <div className="settings-slider-labels">
                  <span className="settings-slider-label settings-slider-label-min">{TICK_DENSITY_MIN}</span>
                  <span className="settings-slider-label settings-slider-label-mid">{TICK_DENSITY_MID}</span>
                  <span className="settings-slider-label settings-slider-label-max">{TICK_DENSITY_MAX}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Scale Type */}
          <div className="settings-row">
            <div className="settings-row-left">
              <div className="settings-row-label">Scale Type</div>
              <div className="settings-row-description">How time is distributed along the timeline axis.</div>
            </div>
            <div className="settings-row-right">
              <select
                className="settings-select"
                value={scaleType}
                onChange={(e) => setScaleType(e.target.value)}
              >
                <option value="default">Default</option>
                <option value="logarithmic">Logarithmic Scaling</option>
              </select>
            </div>
          </div>

          {/* Log Scale Factor — only in logarithmic mode */}
          {scaleType === "logarithmic" && (
            <div className="settings-row">
              <div className="settings-row-left">
                <div className="settings-row-label">Log Scale Factor</div>
                <div className="settings-row-description">Controls the strength of the logarithmic curve. Higher values compress recent time more.</div>
              </div>
              <div className="settings-row-right">
                <input
                  type="number"
                  className="settings-input settings-input-small"
                  value={logScaleFactor}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v) && v >= 1) setLogScaleFactor(v);
                  }}
                  min={1}
                  step={1}
                />
              </div>
            </div>
          )}

          {/* Scale Sections — hidden in logarithmic mode */}
          {scaleType !== "logarithmic" && (
          <div className="settings-row settings-row-scale-sections">
            <div className="settings-row-left">
              <div className="settings-row-label">Scale Sections</div>
              <div className="settings-row-description">
                Squish or stretch spans of time.
              </div>
            </div>
            <div className="settings-row-right settings-scale-sections-container">
              {scaleSections.map((section, index) => (
                <div key={index} className="settings-scale-section-row-wrap">
                  <div className="settings-scale-section-row">
                    <input
                      type="text"
                      className={`settings-input settings-scale-section-input ${scaleSectionErrors[index] ? 'settings-input-error' : ''}`}
                      value={section.start}
                      onChange={(e) => updateScaleSection(index, "start", e.target.value)}
                      placeholder="Start"
                      maxLength={20}
                    />
                    <span className="settings-scale-section-separator">–</span>
                    <input
                      type="text"
                      className={`settings-input settings-scale-section-input ${scaleSectionErrors[index] ? 'settings-input-error' : ''}`}
                      value={section.end}
                      onChange={(e) => updateScaleSection(index, "end", e.target.value)}
                      placeholder="End"
                      maxLength={20}
                    />
                    <input
                      type="number"
                      className={`settings-input settings-scale-section-scale ${scaleSectionErrors[index] ? 'settings-input-error' : ''}`}
                      value={section.scale}
                      onChange={(e) => updateScaleSection(index, "scale", e.target.value)}
                      placeholder="Scale"
                      min={0}
                      max={2}
                      step={0.1}
                    />
                    <button
                      type="button"
                      className={`settings-scale-section-break-toggle${section.showBreak !== false ? " active" : ""}`}
                      onClick={() => updateScaleSection(index, "showBreak", section.showBreak === false ? true : false)}
                      aria-label="Toggle axis break marker"
                      title="Show axis break marker"
                    >
                      <svg width="12" height="14" viewBox="0 0 12 14" fill="none" aria-hidden="true">
                        <line x1="1" y1="13" x2="6" y2="1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                        <line x1="6" y1="13" x2="11" y2="1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="settings-scale-section-remove"
                      onClick={() => removeScaleSection(index)}
                      aria-label="Remove scale section"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  {scaleSectionErrors[index] && (
                    <div className="settings-scale-section-error">{scaleSectionErrors[index]}</div>
                  )}
                </div>
              ))}
              <button
                type="button"
                className="settings-scale-section-add"
                onClick={addScaleSection}
              >
                <Plus size={14} />
                <span>Add Section</span>
              </button>
            </div>
          </div>
          )}

              {/* Negative Era */}
              <div className="settings-row no-border-bottom">
                <div className="settings-row-left">
                  <div className="settings-row-label">Negative Era</div>
                  <div className="settings-row-description">Optional label for negative years (e.g., BCE).</div>
                </div>
                <div className="settings-row-right">
                  <input
                    type="text"
                    className="settings-input settings-input-small"
                    value={negID}
                    onChange={(e) => setNegID(e.target.value)}
                    placeholder="e.g., BCE"
                    maxLength={10}
                  />
                </div>
              </div>

              {/* Positive Era */}
              <div className="settings-row">
                <div className="settings-row-left">
                  <div className="settings-row-label">Positive Era</div>
                  <div className="settings-row-description">Optional label for positive years (e.g., CE).</div>
                </div>
                <div className="settings-row-right">
                  <input
                    type="text"
                    className="settings-input settings-input-small"
                    value={posID}
                    onChange={(e) => setPosID(e.target.value)}
                    placeholder="e.g., CE"
                    maxLength={10}
                  />
                </div>
              </div>

            </>
          )}

          {settingsSection === "appearance" && (
            <>
              <div className="settings-row">
                <div className="settings-row-left">
                  <div className="settings-row-label">Theme</div>
                  <div className="settings-row-description">Choose a color theme for the timeline.</div>
                </div>
                <div className="settings-row-right">
                  <div className="settings-folder settings-folder-column">
                    <select
                      className="settings-select"
                      value={theme || themeKey || ""}
                      onChange={(e) => {
                        setTheme(e.target.value);
                        onThemeChange?.(e.target.value);
                      }}
                    >
                      <option value="default">Default (App Theme)</option>
                      {Object.entries(themes || {}).map(([key, theme]) => (
                        <option key={key} value={key}>
                          {themeOptionLabel(key, theme)}
                        </option>
                      ))}
                    </select>
                    {themeMigrationStatus?.count != null ? (
                      <div className="theme-migration-notice">
                        {themeMigrationStatus.count} theme{themeMigrationStatus.count === 1 ? "" : "s"} updated.
                      </div>
                    ) : oldFormatThemeCount > 0 ? (
                      <div className="theme-migration-notice">
                        <span>
                          {oldFormatThemeCount} theme{oldFormatThemeCount === 1 ? "" : "s"} are using an older format. Update all?
                        </span>
                        <button
                          type="button"
                          className="theme-migration-button"
                          onClick={handleMigrateOldThemes}
                          disabled={themeMigrationStatus === "migrating"}
                        >
                          {themeMigrationStatus === "migrating" ? "Updating..." : "Update All"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="settings-row">
                <div className="settings-row-left">
                  <div className="settings-row-label">Font</div>
                  <div className="settings-row-description">Choose a font for this timeline.</div>
                </div>
                <div className="settings-row-right">
                  <select
                    className="settings-select"
                    value={fontFamily || "default"}
                    onChange={(e) => setFontFamily(e.target.value)}
                  >
                    {fontOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Show Grid */}
              <div className="settings-row">
                <div className="settings-row-left">
                  <div className="settings-row-label">Show Grid</div>
                  <div className="settings-row-description">Display subtle vertical grid lines aligned with tick marks.</div>
                </div>
                <div className="settings-row-right">
                  <label className="settings-toggle">
                    <input
                      type="checkbox"
                      checked={showGrid}
                      onChange={(e) => setShowGrid(e.target.checked)}
                    />
                    <span className="settings-toggle-slider"></span>
                  </label>
                </div>
              </div>

              {/* Event Size */}
              <div className="settings-row">
                <div className="settings-row-left">
                  <div className="settings-row-label">Event Size</div>
                  <div className="settings-row-description">Control the size of event boxes ({eventWidth}px{eventWidth === 150 ? "" : " · default: 150"}).</div>
                </div>
                <div className="settings-row-right" style={{ minWidth: 120 }}>
                  <input
                    type="range"
                    min={100}
                    max={250}
                    step={5}
                    value={eventWidth}
                    onChange={(e) => setEventWidth(Number(e.target.value))}
                    className="settings-slider"
                  />
                </div>
              </div>

              {/* Event Font Size */}
              <div className="settings-row">
                <div className="settings-row-left">
                  <div className="settings-row-label">Event Font Size</div>
                  <div className="settings-row-description">Control the text size inside event boxes ({eventFontSize}px{eventFontSize === 10 ? "" : " · default: 10"}).</div>
                </div>
                <div className="settings-row-right" style={{ minWidth: 120 }}>
                  <input
                    type="range"
                    min={7}
                    max={14}
                    step={1}
                    value={eventFontSize}
                    onChange={(e) => setEventFontSize(Number(e.target.value))}
                    className="settings-slider"
                  />
                </div>
              </div>

              {/* Fixed Event Height */}
              <div className="settings-row">
                <div className="settings-row-left">
                  <div className="settings-row-label">Fixed Event Height</div>
                  <div className="settings-row-description">Lock all events to a single-line height, truncating long titles with ellipsis.</div>
                </div>
                <div className="settings-row-right">
                  <label className="settings-toggle">
                    <input
                      type="checkbox"
                      checked={fixedEventHeight}
                      onChange={(e) => setFixedEventHeight(e.target.checked)}
                    />
                    <span className="settings-toggle-slider"></span>
                  </label>
                </div>
              </div>

              {/* Thin Connectors */}
              <div className="settings-row">
                <div className="settings-row-left">
                  <div className="settings-row-label">Thin Connectors</div>
                  <div className="settings-row-description">Use thin-style span connectors with rounded endpoints.</div>
                </div>
                <div className="settings-row-right">
                  <label className="settings-toggle">
                    <input
                      type="checkbox"
                      checked={thinConnectors}
                      onChange={(e) => setThinConnectors(e.target.checked)}
                    />
                    <span className="settings-toggle-slider"></span>
                  </label>
                </div>
              </div>

              {/* Span Color Events */}
              <div className="settings-row">
                <div className="settings-row-left">
                  <div className="settings-row-label">Color Events by Parent Span</div>
                  <div className="settings-row-description">Tint event backgrounds to match their parent span's color.</div>
                </div>
                <div className="settings-row-right">
                  <label className="settings-toggle">
                    <input
                      type="checkbox"
                      checked={spanColorEvents}
                      onChange={(e) => setSpanColorEvents(e.target.checked)}
                    />
                    <span className="settings-toggle-slider"></span>
                  </label>
                </div>
              </div>

              {/* Secondary Background */}
              <div className="settings-row">
                <div className="settings-row-left">
                  <div className="settings-row-label">Use Secondary Color for Timeline Background</div>
                  <div className="settings-row-description">Use the same background color as the side panels for the timeline area.</div>
                </div>
                <div className="settings-row-right">
                  <label className="settings-toggle">
                    <input
                      type="checkbox"
                      checked={useSecondaryBg}
                      onChange={(e) => setUseSecondaryBg(e.target.checked)}
                    />
                    <span className="settings-toggle-slider"></span>
                  </label>
                </div>
              </div>
            </>
          )}

          {settingsSection === "advanced" && (
            <>
              {/* Wiki Integration */}
              <div className="settings-row">
                <div className="settings-row-left">
                  <div className="settings-row-label">Wiki Integration</div>
                  <div className="settings-row-description">Enable attaching MediaWiki articles to timeline elements.</div>
                </div>
                <div className="settings-row-right">
                  <label className="settings-toggle">
                    <input
                      type="checkbox"
                      checked={useWiki}
                      onChange={(e) => setUseWikipedia(e.target.checked)}
                    />
                    <span className="settings-toggle-slider"></span>
                  </label>
                </div>
              </div>

              {/* Spreadsheet */}
              <div className="settings-row">
                <div className="settings-row-left">
                  <div className="settings-row-label">Spreadsheet View</div>
                  <div className="settings-row-description">Enable a table view for bulk editing elements.</div>
                </div>
                <div className="settings-row-right">
                  <label className="settings-toggle">
                    <input
                      type="checkbox"
                      checked={useSpreadsheet}
                      onChange={(e) => setUseSpreadsheet(e.target.checked)}
                    />
                    <span className="settings-toggle-slider"></span>
                  </label>
                </div>
              </div>

              {/* Maps */}
              <div className="settings-row">
                <div className="settings-row-left">
                  <div className="settings-row-label">Maps</div>
                  <div className="settings-row-description">Enable adding coordinates to events, eras, and spans to view them on a map.</div>
                </div>
                <div className="settings-row-right">
                  <label className="settings-toggle">
                    <input
                      type="checkbox"
                      checked={useMaps}
                      onChange={(e) => {
                        setUseMaps(e.target.checked);
                        if (!e.target.checked && settingsSection === "maps") setSettingsSection("advanced");
                      }}
                    />
                    <span className="settings-toggle-slider"></span>
                  </label>
                </div>
              </div>

              {/* — Timeline View — */}
              <div className="settings-row settings-row-section">
                <div className="settings-row-left">
                  <div className="settings-row-label">Timeline View</div>
                </div>
              </div>

              {/* Branch Ordering */}
              <div className="settings-row">
                <div className="settings-row-left">
                  <div className="settings-row-label">Branch Ordering</div>
                  <div className="settings-row-description">Choose whether later-starting branches stay closer to the parent.</div>
                </div>
                <div className="settings-row-right">
                  <select
                    className="settings-select"
                    value={branchOrdering}
                    onChange={(e) => setBranchOrdering(e.target.value)}
                  >
                    <option value="later-first">Later starts closer</option>
                    <option value="original">Follow branch list order</option>
                  </select>
                </div>
              </div>

              {/* Hide Span Connectors */}
              <div className="settings-row">
                <div className="settings-row-left">
                  <div className="settings-row-label">Hide Span Connectors</div>
                  <div className="settings-row-description">Hide branch and merge connectors between spans. Data is preserved — re-enabling this will restore them.</div>
                </div>
                <div className="settings-row-right">
                  <label className="settings-toggle">
                    <input
                      type="checkbox"
                      checked={hideSpanConnectors}
                      onChange={(e) => setHideSpanConnectors(e.target.checked)}
                    />
                    <span className="settings-toggle-slider"></span>
                  </label>
                </div>
              </div>

              {/* Use Calendar */}
              <div className="settings-row">
                <div className="settings-row-left">
                  <div className="settings-row-label">Use Calendar</div>
                  <div className="settings-row-description">Show month and day labels on ticks and element dates. Day-level ticks appear automatically on short timelines.</div>
                </div>
                <div className="settings-row-right">
                  <label className="settings-toggle">
                    <input
                      type="checkbox"
                      checked={useCalendar}
                      onChange={(e) => setUseCalendar(e.target.checked)}
                    />
                    <span className="settings-toggle-slider"></span>
                  </label>
                </div>
              </div>

              {/* Event Line Anchoring */}
              <div className="settings-row">
                <div className="settings-row-left">
                  <div className="settings-row-label">Connect Event Lines to Group</div>
                  <div className="settings-row-description">Anchor unparented event lines to their group band instead of the main timeline.</div>
                </div>
                <div className="settings-row-right">
                  <label className="settings-toggle">
                    <input
                      type="checkbox"
                      checked={eventLinesToGroupBottom}
                      onChange={(e) => setEventLinesToGroupBottom(e.target.checked)}
                    />
                    <span className="settings-toggle-slider"></span>
                  </label>
                </div>
              </div>

              {/* Hide Decimals */}
              <div className="settings-row">
                <div className="settings-row-left">
                  <div className="settings-row-label">Hide Decimals</div>
                  <div className="settings-row-description">Round displayed years to whole numbers.</div>
                </div>
                <div className="settings-row-right">
                  <label className="settings-toggle">
                    <input
                      type="checkbox"
                      checked={hideDecimals}
                      onChange={(e) => setHideDecimals(e.target.checked)}
                    />
                    <span className="settings-toggle-slider"></span>
                  </label>
                </div>
              </div>

              {/* Disable Groups */}
              <div className="settings-row">
                <div className="settings-row-left">
                  <div className="settings-row-label">Disable Groups</div>
                  <div className="settings-row-description">Flatten all elements into a single group and hide group bands.</div>
                </div>
                <div className="settings-row-right">
                  <label className="settings-toggle">
                    <input
                      type="checkbox"
                      checked={disableGroups}
                      onChange={(e) => setDisableGroups(e.target.checked)}
                    />
                    <span className="settings-toggle-slider"></span>
                  </label>
                </div>
              </div>

              {/* Keep Selection */}
              <div className="settings-row">
                <div className="settings-row-left">
                  <div className="settings-row-label">Keep Selection</div>
                  <div className="settings-row-description">Keep the last selected element selected when clicking the timeline background.</div>
                </div>
                <div className="settings-row-right">
                  <label className="settings-toggle">
                    <input
                      type="checkbox"
                      checked={keepSelection}
                      onChange={(e) => setKeepSelection(e.target.checked)}
                    />
                    <span className="settings-toggle-slider"></span>
                  </label>
                </div>
              </div>

              {/* — Left Panel — */}
              <div className="settings-row settings-row-section">
                <div className="settings-row-left">
                  <div className="settings-row-label">Left Panel</div>
                </div>
              </div>

              {/* Show Popular Tags */}
              <div className="settings-row">
                <div className="settings-row-left">
                  <div className="settings-row-label">Show Popular Tags</div>
                  <div className="settings-row-description">Show a row of the most-used tags at the top of the left panel for quick filtering.</div>
                </div>
                <div className="settings-row-right">
                  <label className="settings-toggle">
                    <input
                      type="checkbox"
                      checked={showPopularTags}
                      onChange={(e) => setShowPopularTags(e.target.checked)}
                    />
                    <span className="settings-toggle-slider"></span>
                  </label>
                </div>
              </div>


            </>
          )}

          {settingsSection === "maps" && useMaps && (
            <>
              <div className="settings-row">
                <div className="settings-row-left">
                  <div className="settings-row-label">Tile URL</div>
                  <div className="settings-row-description">
                    Custom map tile URL. Use {"{z}"}, {"{x}"}, {"{y}"} as placeholders. Leave blank to use OpenStreetMap.
                  </div>
                </div>
                <div className="settings-row-right">
                  <input
                    type="text"
                    className="settings-input"
                    value={mapTileUrl}
                    onChange={(e) => setMapTileUrl(e.target.value)}
                    placeholder="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                </div>
              </div>
              <div className="settings-row">
                <div className="settings-row-left">
                  <div className="settings-row-label">Scrollbar Year Only</div>
                  <div className="settings-row-description">
                    Only show map markers active at the current year shown in the scrollbar.
                  </div>
                </div>
                <div className="settings-row-right">
                  <label className="settings-toggle">
                    <input
                      type="checkbox"
                      checked={mapLimitToViewportYear}
                      onChange={(e) => setMapLimitToViewportYear(e.target.checked)}
                    />
                    <span className="settings-toggle-slider"></span>
                  </label>
                </div>
              </div>
              <div className="settings-row">
                <div className="settings-row-left">
                  <div className="settings-row-label">Event Marker</div>
                  <div className="settings-row-description">Choose the marker style used for events in map view.</div>
                </div>
                <div className="settings-row-right">
                  <select
                    className="settings-select"
                    value={mapEventMarker}
                    onChange={(e) => setMapEventMarker(e.target.value)}
                  >
                    {MAP_MARKER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="settings-row">
                <div className="settings-row-left">
                  <div className="settings-row-label">Span Marker</div>
                  <div className="settings-row-description">Choose the marker style used for spans in map view.</div>
                </div>
                <div className="settings-row-right">
                  <select
                    className="settings-select"
                    value={mapSpanMarker}
                    onChange={(e) => setMapSpanMarker(e.target.value)}
                  >
                    {MAP_MARKER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="settings-row">
                <div className="settings-row-left">
                  <div className="settings-row-label">Era Marker</div>
                  <div className="settings-row-description">Choose the marker style used for eras in map view.</div>
                </div>
                <div className="settings-row-right">
                  <select
                    className="settings-select"
                    value={mapEraMarker}
                    onChange={(e) => setMapEraMarker(e.target.value)}
                  >
                    {MAP_MARKER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
