import { ArrowLeft } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import { formatYear } from "../utils/timelineUtils";
import useEscapeKey from "../hooks/useEscapeKey";
import "../styles/07-modals-menus.css";

const RESOLUTION_OPTIONS = [
  { value: 'hd', label: '1080p (1920 × 1080)', width: 1920, height: 1080 },
  { value: '4k', label: '4K (3840 × 2160)', width: 3840, height: 2160 },
  { value: 'custom', label: 'Custom', width: null, height: null },
];

const DURATION_OPTIONS = [
  { value: 5, label: '5 seconds' },
  { value: 10, label: '10 seconds' },
  { value: 15, label: '15 seconds' },
  { value: 30, label: '30 seconds' },
  { value: 'custom', label: 'Custom' },
];

const FPS_OPTIONS = [
  { value: 24, label: '24 fps' },
  { value: 30, label: '30 fps' },
  { value: 60, label: '60 fps' },
];
const VIDEO_ZOOM_MIN = 0.2;
const VIDEO_ZOOM_MAX = 1;


export default function ExportVideoModal({ isOpen, onClose, timelineData, timelineViewRef, onExportComplete }) {
  const [filename, setFilename] = useState("");
  const [previewData, setPreviewData] = useState(null);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [resolution, setResolution] = useState('hd');
  const [customWidth, setCustomWidth] = useState('1920');
  const [customHeight, setCustomHeight] = useState('1080');
  const [duration, setDuration] = useState(10);
  const [customDuration, setCustomDuration] = useState('10');
  const [fps, setFps] = useState(30);
  const [bgOption, setBgOption] = useState('default');
  const [zoom, setZoom] = useState(1);
  const [exportRange, setExportRange] = useState({ startPercent: 0, endPercent: 100 });
  const [showTitle, setShowTitle] = useState(false);
  const [titlePosition, setTitlePosition] = useState('bottom-right');
  const [titleStyle, setTitleStyle] = useState('title-logo');
  const [titleText, setTitleText] = useState('');

  const previewTimeoutRef = useRef(null);
  const backdropPointerDownRef = useRef(false);
  const exportCancelRef = useRef(false);

  useEscapeKey(isOpen && !isExporting, onClose);

  // Reset state when modal opens
  useEffect(() => {
    if (!isOpen) {
      setPreviewData(null);
      return;
    }
    if (timelineData?.file) {
      const file = timelineData.file;
      setFilename(file.id || file.title || "timeline");
      setPreviewData(null);
      setIsExporting(false);
      setExportProgress(0);
      setResolution('hd');
      setBgOption('default');
      setDuration(10);
      setCustomDuration('10');
      setFps(30);
      setZoom(1);
      setExportRange({ startPercent: 0, endPercent: 100 });
      setShowTitle(false);
      setTitlePosition('bottom-right');
      setTitleStyle('title-logo');
      setTitleText(file.title || "");
      exportCancelRef.current = false;
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // preview image
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

  if (!isOpen) return null;

  const getDurationValue = () => {
    if (duration === 'custom') {
      return Math.min(300, Math.max(1, parseInt(customDuration, 10) || 10));
    }
    return duration;
  };

  const getOutputDimensions = () => {
    if (resolution === 'custom') {
      const w = Math.min(7680, parseInt(customWidth, 10));
      const h = Math.min(4320, parseInt(customHeight, 10));
      if (w > 0 && h > 0) return { width: w, height: h };
      return null;
    }
    const selectedRes = RESOLUTION_OPTIONS.find(r => r.value === resolution);
    return selectedRes ? { width: selectedRes.width, height: selectedRes.height } : null;
  };

  const handleBackdropMouseDown = (e) => {
    backdropPointerDownRef.current = e.target === e.currentTarget;
  };

  const handleBackdropMouseUp = (e) => {
    if (backdropPointerDownRef.current && e.target === e.currentTarget) {
      if (!isExporting) onClose();
    }
    backdropPointerDownRef.current = false;
  };

  const handleExport = async () => {
    if (isExporting) return;
    if (!previewData?.imageUrl) return;
    const dims = getOutputDimensions();
    if (!dims) return;

    setIsExporting(true);
    setExportProgress(0);
    exportCancelRef.current = false;

    let encoder = null;
    try {
      const actualDuration = getDurationValue();
      const actualFps = fps;

      const img = new Image();
      img.crossOrigin = 'anonymous';
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = previewData.imageUrl;
      });

      const rangeRatio = Math.max(0.05, (exportRange.endPercent - exportRange.startPercent) / 100);
      const startOffset = exportRange.startPercent / 100;

      const sourceFullWidth = img.naturalWidth;
      const sourceFullHeight = img.naturalHeight;
      const sourceRegionStart = startOffset * sourceFullWidth;
      const sourceRegionWidth = rangeRatio * sourceFullWidth;

      const outputW = dims.width;
      const outputH = dims.height;
      const outputAspect = outputW / outputH;

      const effectiveZoom = Math.min(VIDEO_ZOOM_MAX, Math.max(VIDEO_ZOOM_MIN, zoom));

      const cropHeight = sourceFullHeight / effectiveZoom;
      const cropWidth = cropHeight * outputAspect;

      const yOffset = (sourceFullHeight - cropHeight) / 2;

      const totalPanPx = Math.max(0, sourceRegionWidth - cropWidth);

      const canvas = document.createElement('canvas');
      canvas.width = outputW;
      canvas.height = outputH;
      const ctx = canvas.getContext('2d');

      const muxerTarget = new ArrayBufferTarget();
      const muxer = new Muxer({
        target: muxerTarget,
        video: { codec: 'avc', width: outputW, height: outputH },
        fastStart: 'in-memory',
      });

      encoder = new VideoEncoder({
        output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
        error: (e) => console.error('Encoder error:', e),
      });

      // PLevel 4.0 caps at ~2MP, need 5.1+ for 4K
      const codedArea = outputW * outputH;
      const avcLevel = codedArea <= 2097152 ? '28' : codedArea <= 8388608 ? '33' : '34';
      encoder.configure({
        codec: `avc1.6400${avcLevel}`,
        width: outputW,
        height: outputH,
        bitrate: 8_000_000,
        framerate: actualFps,
      });

      let bgColor = null;
      if (bgOption === 'secondary' || bgOption === 'tertiary') {
        const varName = bgOption === 'secondary' ? '--surface' : '--inset-bg';
        bgColor = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
      } else if (bgOption !== 'transparent') {
        bgColor = getComputedStyle(document.documentElement).getPropertyValue('--app-bg').trim();
      }

      const titleStyleValue = titleStyle || 'title-logo';
      const showText = titleStyleValue !== 'logo-only';
      const showLogo = titleStyleValue !== 'title-only';
      const watermarkText = showText ? String(titleText || '') : '';
      const canRenderTitleWatermark =
        showTitle && (titleStyleValue === 'logo-only' || Boolean(watermarkText));
      let watermarkCanvas = null;
      if (canRenderTitleWatermark) {
        const wmCanvas = document.createElement('canvas');
        wmCanvas.width = outputW;
        wmCanvas.height = outputH;
        const wmCtx = wmCanvas.getContext('2d');
        const fontSize = Math.max(14, Math.round(outputW * 0.018));
        const padding = Math.round(fontSize * 1.5);
        const computedStyle = getComputedStyle(document.documentElement);
        const themeFont = computedStyle.getPropertyValue('--app-font-family').trim() || 'Inter, system-ui, sans-serif';
        const themeColor = computedStyle.getPropertyValue('--text-primary').trim() || '#888';
        wmCtx.font = `700 ${fontSize}px ${themeFont}`;
        wmCtx.fillStyle = themeColor;

        const pos = titlePosition || 'bottom-right';
        const metrics = wmCtx.measureText(watermarkText);
        const logoHeight = Math.round(fontSize * 0.8);
        const logoWidth = (67 / 25) * logoHeight;
        const logoGap = Math.round(fontSize * 0.35);
        const logoBaselineOffset = fontSize * 0.08;
        const totalWidth = metrics.width + (showLogo ? ((showText ? logoGap : 0) + logoWidth) : 0);
        let x;
        let y;

        if (pos.includes('left')) x = padding;
        else if (pos.includes('center')) x = (outputW - totalWidth) / 2;
        else x = outputW - totalWidth - padding;

        if (pos.includes('top')) y = padding + fontSize;
        else y = outputH - padding;

        if (showText) {
          wmCtx.fillText(watermarkText, x, y);
        }

        if (showLogo) {
          const logoX = x + metrics.width + (showText ? logoGap : 0);
          const logoY = y - logoHeight + logoBaselineOffset;
          const scale = logoHeight / 25;
          wmCtx.save();
          wmCtx.translate(logoX, logoY);
          wmCtx.scale(scale, scale);
          wmCtx.fillRect(0, 8.89844, 28.2656, 6.80469);
          wmCtx.fillRect(35.0703, 0, 31.9297, 7.32812);
          wmCtx.fillRect(35.0703, 16.75, 31.9297, 7.32812);
          wmCtx.beginPath();
          wmCtx.moveTo(35.0703, 0);
          wmCtx.lineTo(35.0703, 24.0781);
          wmCtx.lineTo(33.2656, 24.0781);
          wmCtx.bezierCurveTo(30.5042, 24.0781, 28.2656, 21.8395, 28.2656, 19.0781);
          wmCtx.lineTo(28.2656, 5);
          wmCtx.bezierCurveTo(28.2656, 2.23858, 30.5042, 0, 33.2656, 0);
          wmCtx.closePath();
          wmCtx.fill();
          wmCtx.restore();
        }
        watermarkCanvas = wmCanvas;
      }

      const totalFrames = Math.ceil(actualDuration * actualFps);
      const frameDurationUs = Math.round(1_000_000 / actualFps);
      let lastPct = -1;

      for (let i = 0; i < totalFrames; i++) {
        if (exportCancelRef.current) break;

        const progress = i / totalFrames;

        if (bgColor) {
          ctx.fillStyle = bgColor;
          ctx.fillRect(0, 0, outputW, outputH);
        } else {
          ctx.clearRect(0, 0, outputW, outputH);
        }

        const vpLeft = sourceRegionStart + progress * totalPanPx;
        const vpTop = yOffset;

        const srcX = Math.max(0, vpLeft);
        const srcY = Math.max(0, vpTop);
        const srcRight = Math.min(sourceFullWidth, vpLeft + cropWidth);
        const srcBottom = Math.min(sourceFullHeight, vpTop + cropHeight);
        const srcW = srcRight - srcX;
        const srcH = srcBottom - srcY;
        const dstX = (srcX - vpLeft) / cropWidth * outputW;
        const dstY = (srcY - vpTop) / cropHeight * outputH;
        const dstW = srcW / cropWidth * outputW;
        const dstH = srcH / cropHeight * outputH;
        ctx.drawImage(img, srcX, srcY, srcW, srcH, dstX, dstY, dstW, dstH);
        if (watermarkCanvas) {
          ctx.drawImage(watermarkCanvas, 0, 0);
        }

        const frame = new VideoFrame(canvas, { timestamp: i * frameDurationUs });
        encoder.encode(frame, { keyFrame: i % (actualFps * 2) === 0 });
        frame.close();

        if (encoder.encodeQueueSize > 5) {
          await new Promise(r => encoder.addEventListener('dequeue', r, { once: true }));
        }

        const pct = Math.round(((i + 1) / totalFrames) * 100);
        if (pct >= lastPct + 5) {
          lastPct = pct;
          setExportProgress(pct);
          await new Promise(r => setTimeout(r, 0));
        }
      }

      if (exportCancelRef.current) {
        encoder.close();
        onExportComplete?.({ canceled: true });
        return;
      }

      await encoder.flush();
      encoder.close();
      muxer.finalize();

      const blob = new Blob([muxerTarget.buffer], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const exportFilename = (filename || "").trim() || (timelineData?.file?.id || 'timeline');
      link.download = `${exportFilename}.mp4`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      onExportComplete?.({ success: true });
    } catch (error) {
      console.error('Error exporting video:', error);
      onExportComplete?.({ success: false, error: error.message });
    } finally {
      try { if (encoder && encoder.state !== 'closed') encoder.close(); } catch { /* ignore close failures */ }
      setIsExporting(false);
      setExportProgress(0);
    }
  };

  const handleCancel = () => {
    if (isExporting) {
      exportCancelRef.current = true;
      return;
    }
    onClose();
  };

  const minRangePercent = 5;

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

  const outputDims = getOutputDimensions();
  const previewBgColor = bgOption === 'secondary'
    ? 'var(--surface)'
    : bgOption === 'tertiary'
      ? 'var(--inset-bg)'
      : 'var(--app-bg)';
  const previewMetrics = (() => {
    if (!previewData || !outputDims) return null;
    const sourceFullWidth = previewData.canvasWidth || previewData.elementWidth || 1;
    const sourceFullHeight = previewData.canvasHeight || previewData.elementHeight || 1;
    const outputAspect = outputDims.width / outputDims.height;
    const rangeRatioClamped = Math.max(0.05, (exportRange.endPercent - exportRange.startPercent) / 100);
    const sourceRegionStart = (exportRange.startPercent / 100) * sourceFullWidth;
    const sourceRegionWidth = rangeRatioClamped * sourceFullWidth;
    const effectiveZoom = Math.min(VIDEO_ZOOM_MAX, Math.max(VIDEO_ZOOM_MIN, zoom));
    const cropHeight = sourceFullHeight / effectiveZoom;
    const cropWidth = cropHeight * outputAspect;
    const yOffset = (sourceFullHeight - cropHeight) / 2;
    const totalPanPx = Math.max(0, sourceRegionWidth - cropWidth);
    const startVpLeft = sourceRegionStart;
    const endVpLeft = sourceRegionStart + totalPanPx;
    const widthPercent = (sourceFullWidth / cropWidth) * 100;
    const heightPercent = (sourceFullHeight / cropHeight) * 100;
    const topPercent = -(yOffset / cropHeight) * 100;
    const panLeftStartPercent = -(startVpLeft / cropWidth) * 100;
    const panLeftEndPercent = -(endVpLeft / cropWidth) * 100;
    return {
      widthPercent,
      heightPercent,
      topPercent,
      panLeftStartPercent,
      panLeftEndPercent,
      durationSeconds: getDurationValue(),
    };
  })();

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
          <h2 className="settings-title">EXPORT VIDEO</h2>
        </div>

        <div className="settings-content">
          <div className="export-preview-container">
            {isGeneratingPreview ? (
              <div className="export-preview-loading">Generating preview...</div>
            ) : previewData?.imageUrl ? (
              <div
                className="export-preview-wrapper export-video-preview-wrapper"
                style={{
                  aspectRatio: outputDims ? `${outputDims.width} / ${outputDims.height}` : undefined,
                  overflow: 'hidden',
                  width: '100%',
                  backgroundColor: previewBgColor,
                }}
              >
                <img
                  src={previewData.imageUrl}
                  alt="Export preview"
                  className="export-preview-image export-video-pan-image"
                  draggable={false}
                  style={{
                    width: `${previewMetrics?.widthPercent || 100}%`,
                    maxWidth: 'none',
                    maxHeight: 'none',
                    height: `${previewMetrics?.heightPercent || 100}%`,
                    position: 'absolute',
                    left: `${previewMetrics?.panLeftStartPercent || 0}%`,
                    top: `${previewMetrics?.topPercent || 0}%`,
                    '--pan-left-start': `${previewMetrics?.panLeftStartPercent || 0}%`,
                    '--pan-left-end': `${previewMetrics?.panLeftEndPercent || 0}%`,
                    animation: `panPreviewLeft ${previewMetrics?.durationSeconds || getDurationValue()}s linear infinite`,
                  }}
                />
                {showTitle && (
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
                <div className="export-preview-bounds" style={{
                  border: '1px dashed var(--ui-muted)',
                  position: 'absolute',
                  inset: 0,
                  pointerEvents: 'none',
                  boxSizing: 'border-box',
                }} />
              </div>
            ) : (
              <div className="export-preview-placeholder">Preview will appear here</div>
            )}
          </div>

          {isExporting && (
            <div className="settings-row">
              <div className="settings-row-left" style={{ flex: 1 }}>
                <div className="settings-row-label">Exporting...</div>
                <div className="export-progress-bar">
                  <div
                    className="export-progress-fill"
                    style={{ width: `${exportProgress}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          <div className="settings-row">
            <div className="settings-row-left">
              <div className="settings-row-label">Resolution</div>
              <div className="settings-row-description">
                {outputDims ? `${outputDims.width} × ${outputDims.height} px` : 'Output video dimensions.'}
              </div>
            </div>
            <div className="settings-row-right">
              <select
                className="settings-select"
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                disabled={isExporting}
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
                    max={7680}
                    disabled={isExporting}
                  />
                  <span className="settings-scale-section-separator">&times;</span>
                  <input
                    type="number"
                    className="settings-input export-custom-resolution-input"
                    value={customHeight}
                    onChange={(e) => setCustomHeight(e.target.value)}
                    placeholder="Height"
                    min={1}
                    max={4320}
                    disabled={isExporting}
                  />
                </div>
              )}
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-left">
              <div className="settings-row-label">Zoom</div>
              <div className="settings-row-description">
                {zoom < 1 ? `${zoom.toFixed(1)}x — zoomed out, more context visible.` : 'Fit full timeline height.'}
              </div>
            </div>
            <div className="settings-row-right">
              <div className="settings-slider-wrap">
                <input
                  type="range"
                  className="settings-slider"
                  min={VIDEO_ZOOM_MIN}
                  max={VIDEO_ZOOM_MAX}
                  step={0.1}
                  value={zoom}
                  onChange={(e) =>
                    setZoom(
                      Math.min(
                        VIDEO_ZOOM_MAX,
                        Math.max(VIDEO_ZOOM_MIN, Number(e.target.value)),
                      ),
                    )
                  }
                  disabled={isExporting}
                />
                <div className="settings-slider-labels">
                  <span className="settings-slider-label settings-slider-label-min">{VIDEO_ZOOM_MIN}x</span>
                  <span className="settings-slider-label settings-slider-label-max">{VIDEO_ZOOM_MAX}x</span>
                </div>
              </div>
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-left">
              <div className="settings-row-label">Duration</div>
              <div className="settings-row-description">How long the pan animation takes.</div>
            </div>
            <div className="settings-row-right">
              <select
                className="settings-select"
                value={duration}
                onChange={(e) => {
                  const val = e.target.value;
                  setDuration(val === 'custom' ? 'custom' : Number(val));
                }}
                disabled={isExporting}
              >
                {DURATION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              {duration === 'custom' && (
                <div className="export-custom-resolution">
                  <input
                    type="number"
                    className="settings-input export-custom-resolution-input"
                    value={customDuration}
                    onChange={(e) => setCustomDuration(e.target.value)}
                    placeholder="Seconds"
                    min={1}
                    max={300}
                    disabled={isExporting}
                  />
                  <span className="settings-scale-section-separator">sec</span>
                </div>
              )}
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-left">
              <div className="settings-row-label">Frame Rate</div>
              <div className="settings-row-description">Higher values produce smoother video.</div>
            </div>
            <div className="settings-row-right">
              <select
                className="settings-select"
                value={fps}
                onChange={(e) => setFps(Number(e.target.value))}
                disabled={isExporting}
              >
                {FPS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
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
                    disabled={!previewData || isExporting}
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
                    disabled={!previewData || isExporting}
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
                disabled={isExporting}
              >
                <option value="default">Default</option>
                <option value="secondary">Secondary</option>
                <option value="tertiary">Tertiary</option>
              </select>
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-left">
              <div className="settings-row-label">Title Watermark</div>
              <div className="settings-row-description">Overlay the timeline title on the video.</div>
            </div>
            <div className="settings-row-right">
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={showTitle}
                  onChange={(e) => setShowTitle(e.target.checked)}
                  disabled={isExporting}
                />
                <span className="settings-toggle-slider"></span>
              </label>
            </div>
          </div>

          {showTitle && (
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
                  disabled={isExporting || titleStyle === "logo-only"}
                />
              </div>
            </div>
          )}

          {showTitle && (
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
                  disabled={isExporting}
                >
                  <option value="title-logo">Title and Logo</option>
                  <option value="title-only">Title Only</option>
                  <option value="logo-only">Logo Only</option>
                </select>
              </div>
            </div>
          )}

          {showTitle && (
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
                  disabled={isExporting}
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
          >
            {isExporting ? 'Cancel' : 'Close'}
          </button>
          <button
            className="settings-footer-button settings-create-button"
            onClick={handleExport}
            disabled={isExporting || !previewData || !outputDims}
          >
            {isExporting ? `Exporting ${exportProgress}%` : 'Export'}
          </button>
        </div>
      </div>
    </div>
  );
}
