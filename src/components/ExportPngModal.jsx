import { ArrowLeft } from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";
import { formatYear } from "../utils/timelineUtils";
import useEscapeKey from "../hooks/useEscapeKey";
import "../styles/07-modals-menus.css";

const RESOLUTION_OPTIONS = [
  { value: 'current', label: 'Timeline', width: null, height: null },
  { value: 'hd', label: '1080p (1920 × 1080)', width: 1920, height: 1080 },
  { value: '4k', label: '4K (3840 × 2160)', width: 3840, height: 2160 },
  { value: 'letter', label: 'Letter 300 DPI (3300 × 2550)', width: 3300, height: 2550 },
  { value: 'a4', label: 'A4 300 DPI (3508 × 2480)', width: 3508, height: 2480 },
  { value: 'poster', label: 'Poster 36×24" (10800 × 7200)', width: 10800, height: 7200 },
  { value: 'custom', label: 'Custom', width: null, height: null },
];

export default function ExportPngModal({ isOpen, onClose, onExport, timelineData, timelineViewRef, exportState }) {
  const [filename, setFilename] = useState("");
  const [previewData, setPreviewData] = useState(null);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
  const [validationErrors, setValidationErrors] = useState([]);
  const [previewScale, setPreviewScale] = useState(1);
  const [previewOffset, setPreviewOffset] = useState({ x: 0, y: 0 });
  const [isDraggingPreview, setIsDraggingPreview] = useState(false);
  const [resolution, setResolution] = useState('current');
  const [customWidth, setCustomWidth] = useState('1920');
  const [customHeight, setCustomHeight] = useState('1080');
  const [bgOption, setBgOption] = useState('default');
  const [showTitle, setShowTitle] = useState(false);
  const [titlePosition, setTitlePosition] = useState('bottom-right');
  const [titleStyle, setTitleStyle] = useState('title-logo');
  const [titleText, setTitleText] = useState('');
  const [exportRange, setExportRange] = useState({ startPercent: 0, endPercent: 100 });

  const previewTimeoutRef = useRef(null);
  const previewWrapperRef = useRef(null);
  const previewDragRef = useRef({ startX: 0, startY: 0, startOffsetX: 0, startOffsetY: 0 });
  const backdropPointerDownRef = useRef(false);
  const previewContainerRef = useRef(null);
  const minRangePercent = 5;
  const rangeSpanPercent = Math.max(minRangePercent, exportRange.endPercent - exportRange.startPercent);
  const rangeCenterPercent = (exportRange.startPercent + exportRange.endPercent) / 2;
  const effectiveRangeSpanPercent = Math.min(100, Math.max(minRangePercent, rangeSpanPercent / previewScale));
  const baseStartPercent = Math.min(
    Math.max(0, rangeCenterPercent - effectiveRangeSpanPercent / 2),
    100 - effectiveRangeSpanPercent,
  );
  const maxStartPercent = 100 - effectiveRangeSpanPercent;

  const clampPreviewOffset = useCallback((nextOffset, scaleValue = previewScale) => {
    const container = previewContainerRef.current;
    const containerWidth = container?.clientWidth;
    if (!container || !containerWidth) return nextOffset;

    const scaleSafe = Math.min(10, Math.max(0.3, scaleValue));
    const span = Math.min(100, Math.max(minRangePercent, rangeSpanPercent / scaleSafe));
    const center = rangeCenterPercent;
    const baseStart = Math.min(Math.max(0, center - span / 2), 100 - span);
    const maxStart = 100 - span;
    const percentPerPx = span / containerWidth;
    const minPanPercent = -baseStart;
    const maxPanPercent = maxStart - baseStart;
    const minOffsetX = -maxPanPercent / percentPerPx;
    const maxOffsetX = -minPanPercent / percentPerPx;

    return {
      x: Math.min(maxOffsetX, Math.max(minOffsetX, nextOffset.x)),
      y: 0,
    };
  }, [previewScale, minRangePercent, rangeSpanPercent, rangeCenterPercent]);

  useEffect(() => {
    if (isOpen && timelineData?.file) {
      const file = timelineData.file;
      setFilename(file.id || file.title || "timeline");
      setValidationErrors([]);
      setPreviewData(null);
      setPreviewScale(1);
      setPreviewOffset({ x: 0, y: 0 });
      setIsDraggingPreview(false);
      setResolution('current');
      setBgOption('default');
      setShowTitle(false);
      setTitlePosition('bottom-right');
      setTitleStyle('title-logo');
      setTitleText(file.title || "");
      setExportRange({ startPercent: 0, endPercent: 100 });
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (resolution === "current" && showTitle) {
      setShowTitle(false);
    }
  }, [resolution, showTitle]);

  useEffect(() => {
    if (!isOpen || !timelineViewRef?.current?.generatePreview) return;

    if (previewTimeoutRef.current) {
      clearTimeout(previewTimeoutRef.current);
    }

    previewTimeoutRef.current = setTimeout(async () => {
      setIsGeneratingPreview(true);
      try {
        let previewOpts = {};
        if (bgOption === 'transparent') {
          previewOpts.transparentBg = true;
        } else if (bgOption === 'secondary' || bgOption === 'tertiary') {
          const varName = bgOption === 'secondary' ? '--surface' : '--inset-bg';
          previewOpts.customBg = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
        }
        const data = await timelineViewRef.current.generatePreview(previewOpts);
        setPreviewData(data);
      } catch (error) {
        console.error('Error generating preview:', error);
      } finally {
        setIsGeneratingPreview(false);
      }
    }, 300);

    return () => {
      if (previewTimeoutRef.current) {
        clearTimeout(previewTimeoutRef.current);
      }
    };
  }, [isOpen, bgOption, timelineViewRef]);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.12 : 0.12;
    setPreviewScale((current) => {
      const nextScale = Math.min(10, Math.max(0.3, Number((current + delta).toFixed(2))));
      setPreviewOffset((currentOffset) => clampPreviewOffset(currentOffset, nextScale));
      return nextScale;
    });
  }, [clampPreviewOffset]);

  const isExporting = Boolean(exportState);

  useEscapeKey(isOpen && !isExporting, onClose);

  useEffect(() => {
    const container = previewContainerRef.current;
    if (!container || !isOpen) return;
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [isOpen, handleWheel]);

  useEffect(() => {
    if (!isDraggingPreview) return;

    const handleMouseMove = (e) => {
      const drag = previewDragRef.current;
      const nextOffset = {
        x: drag.startOffsetX + (e.clientX - drag.startX),
        y: drag.startOffsetY + (e.clientY - drag.startY),
      };
      setPreviewOffset(clampPreviewOffset(nextOffset));
    };

    const handleMouseUp = () => {
      setIsDraggingPreview(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDraggingPreview, clampPreviewOffset]);

  useEffect(() => {
    setPreviewOffset((current) => clampPreviewOffset(current));
  }, [previewScale, previewData, resolution, customWidth, customHeight, clampPreviewOffset]);

  if (!isOpen) return null;

  const handleBackdropMouseDown = (e) => {
    backdropPointerDownRef.current = e.target === e.currentTarget;
  };

  const handleBackdropMouseUp = (e) => {
    if (!isExporting && backdropPointerDownRef.current && e.target === e.currentTarget) {
      onClose();
    }
    backdropPointerDownRef.current = false;
  };

  const handlePreviewMouseDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    previewDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startOffsetX: previewOffset.x,
      startOffsetY: previewOffset.y,
    };
    setIsDraggingPreview(true);
  };

  const handleExport = () => {
    let targetWidth, targetHeight;
    if (resolution === 'custom') {
      const parsedW = parseInt(customWidth, 10);
      const parsedH = parseInt(customHeight, 10);
      targetWidth = (parsedW > 0) ? Math.min(parsedW, 16384) : null;
      targetHeight = (parsedH > 0) ? Math.min(parsedH, 16384) : null;
    } else {
      const selectedRes = RESOLUTION_OPTIONS.find(r => r.value === resolution) || RESOLUTION_OPTIONS[0];
      targetWidth = selectedRes.width;
      targetHeight = selectedRes.height;
    }

    let exportBgOpts = {};
    if (bgOption === 'transparent') {
      exportBgOpts.transparentBg = true;
    } else if (bgOption === 'secondary' || bgOption === 'tertiary') {
      const varName = bgOption === 'secondary' ? '--surface' : '--inset-bg';
      exportBgOpts.customBg = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    }

    const startYear = previewData?.percentToYear
      ? previewData.percentToYear(exportRange.startPercent)
      : previewData?.minYear;
    const endYear = previewData?.percentToYear
      ? previewData.percentToYear(exportRange.endPercent)
      : previewData?.maxYear;

    onExport({
      ...exportBgOpts,
      filename: (filename || "").trim() || (timelineData?.file?.id || timelineData?.file?.title || "timeline"),
      targetWidth,
      targetHeight,
      exportStartYear: startYear,
      exportEndYear: endYear,
      showTitle,
      titlePosition,
      titleStyle,
      title: titleText,
    });
  };

  const handleCancel = () => {
    if (isExporting) return;
    setValidationErrors([]);
    setPreviewData(null);
    onClose();
  };

  const selectedRes = RESOLUTION_OPTIONS.find(r => r.value === resolution) || RESOLUTION_OPTIONS[0];
  const rangeRatio = rangeSpanPercent / 100;
  const rangeWidthPx = previewData?.elementWidth ? previewData.elementWidth * rangeRatio : null;

  const getExportDimensions = () => {
    if (!previewData?.elementWidth || !previewData?.elementHeight) return null;
    if (resolution === 'custom') {
      const w = Math.min(16384, parseInt(customWidth, 10));
      const h = Math.min(16384, parseInt(customHeight, 10));
      if (w > 0 && h > 0) return { width: w, height: h };
      if (w > 0) {
        const sourceWidth = rangeWidthPx || previewData.elementWidth;
        if (!sourceWidth) return null;
        const scale = w / sourceWidth;
        return { width: w, height: Math.round(previewData.elementHeight * scale) };
      }
      return null;
    }
    if (selectedRes.width) {
      const sourceWidth = rangeWidthPx || previewData.elementWidth;
      const scale = selectedRes.width / sourceWidth;
      const scaledH = Math.round(previewData.elementHeight * scale);
      return { width: selectedRes.width, height: Math.max(scaledH, selectedRes.height) };
    }
    const sourceWidth = rangeWidthPx || previewData.elementWidth;
    return {
      width: Math.round(sourceWidth * 2),
      height: previewData.elementHeight * 2
    };
  };

  // Calculate the output aspect ratio for the preview wrapper
  const getOutputAspectRatio = () => {
    if (!previewData?.elementWidth || !previewData?.elementHeight) return null;

    let targetW, targetH;
    if (resolution === 'custom') {
      targetW = parseInt(customWidth, 10);
      targetH = parseInt(customHeight, 10);
      if (!(targetW > 0 && targetH > 0)) return null;
    } else {
      targetW = selectedRes.width;
      targetH = selectedRes.height;
      if (!targetW || !targetH) return null;
    }

    const sourceWidth = rangeWidthPx || previewData.elementWidth;
    const scale = targetW / sourceWidth;
    const scaledH = previewData.elementHeight * scale;
    if (targetH <= scaledH) return null; // timeline fills or exceeds target

    return `${targetW} / ${targetH}`;
  };

  const outputAspectRatio = getOutputAspectRatio();
  const previewBgColor = bgOption === 'secondary' ? 'var(--surface)'
    : bgOption === 'tertiary' ? 'var(--inset-bg)'
    : undefined;
  const file = timelineData?.file;
  const displayYear = (value) => {
    if (!Number.isFinite(value)) return "--";
    return formatYear(value, file?.negID, file?.posID, file?.useCalendar === true, file?.hideDecimals);
  };
  const selectedStartYear = previewData?.percentToYear
    ? previewData.percentToYear(exportRange.startPercent)
    : previewData?.minYear;
  const selectedEndYear = previewData?.percentToYear
    ? previewData.percentToYear(exportRange.endPercent)
    : previewData?.maxYear;
  const rangeMinYear = previewData?.minYear;
  const rangeMaxYear = previewData?.maxYear;
  const rangeStep = 0.1;

  const containerWidth = previewContainerRef.current?.clientWidth || 1;
  const panPercent = -(previewOffset.x * effectiveRangeSpanPercent) / containerWidth;
  const effectiveStartPercent = Math.min(
    Math.max(0, baseStartPercent + panPercent),
    maxStartPercent,
  );
  const previewImageStyle = {
    width: `${100 / (effectiveRangeSpanPercent / 100)}%`,
    maxWidth: "none",
    maxHeight: "none",
    marginLeft: `-${(effectiveStartPercent / effectiveRangeSpanPercent) * 100}%`,
  };

  const handleStartRangeChange = (e) => {
    const raw = Number(e.target.value);
    if (!Number.isFinite(raw)) return;
    setExportRange((current) => ({
      startPercent: Math.min(Math.max(0, raw), current.endPercent - minRangePercent),
      endPercent: current.endPercent,
    }));
  };

  const handleEndRangeChange = (e) => {
    const raw = Number(e.target.value);
    if (!Number.isFinite(raw)) return;
    setExportRange((current) => ({
      startPercent: current.startPercent,
      endPercent: Math.max(Math.min(100, raw), current.startPercent + minRangePercent),
    }));
  };

  return (
    <div className="settings-backdrop" onMouseDown={handleBackdropMouseDown} onMouseUp={handleBackdropMouseUp}>
      <div className="settings-modal export-png-modal">
        <div className="settings-header">
          <button
            className="settings-back-button"
            onClick={handleCancel}
            aria-label="Close"
          >
            <ArrowLeft size={20} strokeWidth={2} />
          </button>
          <h2 className="settings-title">EXPORT PNG</h2>
        </div>

        {validationErrors.length > 0 && (
          <div className="settings-errors">
            {validationErrors.map((error, index) => (
              <div key={index} className="settings-error">
                {error}
              </div>
            ))}
          </div>
        )}

        <div className="settings-content">
          <div
            ref={previewContainerRef}
            className={`export-preview-container ${bgOption === 'transparent' ? 'export-preview-transparent' : ''}`}
          >
            {isGeneratingPreview ? (
              <div className="export-preview-loading">Generating preview...</div>
            ) : previewData?.imageUrl ? (
              <div
                ref={previewWrapperRef}
                className={`export-preview-wrapper${isDraggingPreview ? ' is-dragging' : ''}`}
                onMouseDown={handlePreviewMouseDown}
                style={{
                  transform: `translate(${previewOffset.x}px, 0)`,
                  transformOrigin: "center",
                  justifyContent: 'flex-start',
                  ...(outputAspectRatio ? {
                    aspectRatio: outputAspectRatio,
                    backgroundColor: previewBgColor,
                    width: '100%',
                  } : {}),
                }}
              >
                <img
                  src={previewData.imageUrl}
                  alt="Export preview"
                  className="export-preview-image"
                  style={previewImageStyle}
                  draggable={false}
                />
                <div className="export-preview-bounds" style={{
                  border: '1px dashed var(--ui-muted)',
                  position: 'absolute',
                  inset: 0,
                  pointerEvents: 'none',
                  boxSizing: 'border-box',
                }} />
                {showTitle && resolution !== 'current' && (
                  <div className={`export-preview-title export-preview-title-${titlePosition}`}>
                    {titleStyle !== 'logo-only' && (titleText || '')}
                    {titleStyle !== 'title-only' && (
                      <svg
                        className={`export-preview-title-logo${titleStyle === 'logo-only' ? ' export-preview-title-logo-only' : ''}`}
                        viewBox="0 0 67 25"
                        fill="currentColor"
                        xmlns="http://www.w3.org/2000/svg"
                        aria-hidden="true"
                      >
                        <rect y="8.89844" width="28.2656" height="6.80469" />
                        <rect x="35.0703" width="31.9297" height="7.32812" />
                        <rect x="35.0703" y="16.75" width="31.9297" height="7.32812" />
                        <path d="M28.2656 5C28.2656 2.23858 30.5042 0 33.2656 0H35.0703V24.0781H33.2656C30.5042 24.0781 28.2656 21.8395 28.2656 19.0781V5Z" />
                      </svg>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="export-preview-placeholder">Preview will appear here</div>
            )}
          </div>

          {isExporting && (
            <div className="settings-row">
              <div className="settings-row-left" style={{ flex: 1 }}>
                <div className="settings-row-label">{exportState.stage || 'Exporting...'}</div>
                <div className="export-progress-bar">
                  <div
                    className="export-progress-fill"
                    style={{ width: `${exportState.percent || 0}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          <div className="settings-row">
            <div className="settings-row-left">
              <div className="settings-row-label">Resolution</div>
              <div className="settings-row-description">
                {(() => {
                  const dims = getExportDimensions();
                  return dims ? `${dims.width} × ${dims.height} px` : 'Higher resolutions are better for printing.';
                })()}
              </div>
            </div>
            <div className="settings-row-right">
              <select
                className="settings-select"
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
              >
                {RESOLUTION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              {resolution === 'custom' && (
                <div className="export-custom-resolution">
                  <input
                    type="number"
                    className="settings-input export-custom-resolution-input"
                    value={customWidth}
                    onChange={(e) => setCustomWidth(e.target.value)}
                    placeholder="Width"
                    min={1}
                    max={16384}
                  />
                  <span className="settings-scale-section-separator">×</span>
                  <input
                    type="number"
                    className="settings-input export-custom-resolution-input"
                    value={customHeight}
                    onChange={(e) => setCustomHeight(e.target.value)}
                    placeholder="Height"
                    min={1}
                    max={16384}
                  />
                </div>
              )}
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-left">
              <div className="settings-row-label">Timeline Range</div>
              <div className="settings-row-description">
                {`${displayYear(selectedStartYear)} to ${displayYear(selectedEndYear)} (of ${displayYear(rangeMinYear)} to ${displayYear(rangeMaxYear)})`}
              </div>
            </div>
            <div className="settings-row-right">
              <div className="export-range-control">
                <div className="export-range-slider-wrap">
                  <div className="export-range-track" />
                  <div
                    className="export-range-selection"
                    style={{
                      left: `${exportRange.startPercent}%`,
                      width: `${Math.max(0, exportRange.endPercent - exportRange.startPercent)}%`,
                    }}
                  />
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={rangeStep}
                    value={exportRange.startPercent}
                    onChange={handleStartRangeChange}
                    className="export-range-slider export-range-slider-start"
                    aria-label="Export start year"
                    disabled={!previewData}
                  />
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={rangeStep}
                    value={exportRange.endPercent}
                    onChange={handleEndRangeChange}
                    className="export-range-slider export-range-slider-end"
                    aria-label="Export end year"
                    disabled={!previewData}
                  />
                </div>
                <div className="export-range-labels">
                  <span>{displayYear(selectedStartYear)}</span>
                  <span>{displayYear(selectedEndYear)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-left">
              <div className="settings-row-label">Background</div>
              <div className="settings-row-description">Choose the background color for the export.</div>
            </div>
            <div className="settings-row-right">
              <select
                className="settings-select"
                value={bgOption}
                onChange={(e) => setBgOption(e.target.value)}
              >
                <option value="default">Default</option>
                <option value="secondary">Secondary</option>
                <option value="tertiary">Tertiary</option>
                <option value="transparent">Transparent</option>
              </select>
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-left">
              <div className="settings-row-label">Title Watermark</div>
              <div className="settings-row-description">
                {resolution === "current"
                  ? "Available for fixed export resolutions."
                  : "Overlay the timeline title on the export."}
              </div>
            </div>
            <div className="settings-row-right">
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={showTitle}
                  onChange={(e) => setShowTitle(e.target.checked)}
                  disabled={resolution === "current"}
                />
                <span className="settings-toggle-slider"></span>
              </label>
            </div>
          </div>

          {showTitle && resolution !== "current" && (
            <div className="settings-row">
              <div className="settings-row-left">
                <div className="settings-row-label">Title Text</div>
                <div className="settings-row-description">Custom text used only for this export.</div>
              </div>
              <div className="settings-row-right">
                <input
                  type="text"
                  className="settings-input"
                  value={titleText}
                  onChange={(e) => setTitleText(e.target.value)}
                  placeholder="Enter export title"
                  maxLength={120}
                  disabled={titleStyle === "logo-only"}
                />
              </div>
            </div>
          )}

          {showTitle && resolution !== "current" && (
            <div className="settings-row">
              <div className="settings-row-left">
                <div className="settings-row-label">Title Style</div>
                <div className="settings-row-description">Choose what appears in the watermark.</div>
              </div>
              <div className="settings-row-right">
                <select
                  className="settings-select"
                  value={titleStyle}
                  onChange={(e) => setTitleStyle(e.target.value)}
                >
                  <option value="title-logo">Title and Logo</option>
                  <option value="title-only">Title Only</option>
                  <option value="logo-only">Logo Only</option>
                </select>
              </div>
            </div>
          )}

          {showTitle && resolution !== "current" && (
            <div className="settings-row">
              <div className="settings-row-left">
                <div className="settings-row-label">Title Position</div>
                <div className="settings-row-description">Where to place the title on the export.</div>
              </div>
              <div className="settings-row-right">
                <select
                  className="settings-select"
                  value={titlePosition}
                  onChange={(e) => setTitlePosition(e.target.value)}
                >
                  <option value="top-left">Top Left</option>
                  <option value="top-center">Top Center</option>
                  <option value="top-right">Top Right</option>
                  <option value="bottom-left">Bottom Left</option>
                  <option value="bottom-center">Bottom Center</option>
                  <option value="bottom-right">Bottom Right</option>
                </select>
              </div>
            </div>
          )}

        </div>

        <div className="settings-footer">
          <button
            className="settings-footer-button settings-cancel-button"
            onClick={handleCancel}
            disabled={isExporting}
          >
            Cancel
          </button>
          <button
            className="settings-footer-button settings-create-button"
            onClick={handleExport}
            disabled={isExporting}
          >
            {isExporting ? `Exporting ${exportState.percent || 0}%` : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
}
