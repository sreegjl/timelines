import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { hexToHsv, hsvToHex, normalizeColor } from "../utils/colorUtils";

const POPOVER_WIDTH = 216;
const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 6;

const clamp01 = (n) => Math.min(1, Math.max(0, n));

function ColorPopover({ anchorRef, value, onChange, onClose }) {
  const popRef = useRef(null);
  const areaRef = useRef(null);
  const hueRef = useRef(null);
  const lastEmitted = useRef(null);
  const [pos, setPos] = useState(null);
  const [hsv, setHsv] = useState(() => hexToHsv(normalizeColor(value)));
  const [hexDraft, setHexDraft] = useState(() => normalizeColor(value));

  // Hex loses hue at black and gray, so re-parsing our own emit would snap the slider to red
  useEffect(() => {
    const next = normalizeColor(value);
    if (next.toLowerCase() === lastEmitted.current) return;
    setHsv(hexToHsv(next));
    setHexDraft(next);
  }, [value]);

  const emit = useCallback((next) => {
    setHsv(next);
    const hex = hsvToHex(next.h, next.s, next.v);
    lastEmitted.current = hex.toLowerCase();
    setHexDraft(hex);
    onChange(hex);
  }, [onChange]);

  const place = useCallback(() => {
    const anchor = anchorRef.current?.getBoundingClientRect();
    if (!anchor) return;
    const rect = popRef.current?.getBoundingClientRect();
    const width = rect?.width || POPOVER_WIDTH;
    const height = rect?.height || 220;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top = anchor.bottom + ANCHOR_GAP;
    if (top + height > vh - VIEWPORT_MARGIN) {
      const above = anchor.top - ANCHOR_GAP - height;
      top = above >= VIEWPORT_MARGIN ? above : Math.max(VIEWPORT_MARGIN, vh - VIEWPORT_MARGIN - height);
    }

    let left = anchor.right - width;
    if (left < VIEWPORT_MARGIN) left = anchor.left;
    left = Math.max(VIEWPORT_MARGIN, Math.min(left, vw - VIEWPORT_MARGIN - width));

    setPos({ top, left });
  }, [anchorRef]);

  useLayoutEffect(() => { place(); }, [place]);

  useEffect(() => {
    const onScroll = () => place();
    window.addEventListener("resize", onScroll);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [place]);

  useEffect(() => {
    const onPointerDown = (e) => {
      if (popRef.current?.contains(e.target)) return;
      if (anchorRef.current?.contains(e.target)) return;
      onClose();
    };
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [anchorRef, onClose]);

  const pickArea = (e) => {
    const rect = areaRef.current?.getBoundingClientRect();
    if (!rect) return;
    emit({
      h: hsv.h,
      s: clamp01((e.clientX - rect.left) / rect.width),
      v: 1 - clamp01((e.clientY - rect.top) / rect.height),
    });
  };

  const pickHue = (e) => {
    const rect = hueRef.current?.getBoundingClientRect();
    if (!rect) return;
    emit({ ...hsv, h: clamp01((e.clientX - rect.left) / rect.width) * 360 });
  };

  const onAreaKey = (e) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    if (e.key === "ArrowLeft") emit({ ...hsv, s: clamp01(hsv.s - step) });
    else if (e.key === "ArrowRight") emit({ ...hsv, s: clamp01(hsv.s + step) });
    else if (e.key === "ArrowUp") emit({ ...hsv, v: clamp01(hsv.v + step) });
    else if (e.key === "ArrowDown") emit({ ...hsv, v: clamp01(hsv.v - step) });
    else return;
    e.preventDefault();
  };

  const onHueKey = (e) => {
    const step = e.shiftKey ? 12 : 2;
    if (e.key === "ArrowLeft") emit({ ...hsv, h: (hsv.h - step + 360) % 360 });
    else if (e.key === "ArrowRight") emit({ ...hsv, h: (hsv.h + step) % 360 });
    else return;
    e.preventDefault();
  };

  const commitHex = (raw) => {
    const next = normalizeColor(raw);
    lastEmitted.current = next.toLowerCase();
    setHsv(hexToHsv(next));
    setHexDraft(next);
    onChange(next);
  };

  const hueHex = hsvToHex(hsv.h, 1, 1);
  const currentHex = hsvToHex(hsv.h, hsv.s, hsv.v);

  return createPortal(
    <div
      ref={popRef}
      className="cp-popover"
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, visibility: pos ? "visible" : "hidden" }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        ref={areaRef}
        className="cp-area"
        style={{ background: `linear-gradient(to top, #000, rgba(0,0,0,0)), linear-gradient(to right, #fff, ${hueHex})` }}
        tabIndex={0}
        role="application"
        aria-label="Saturation and brightness"
        onKeyDown={onAreaKey}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); pickArea(e); }}
        onPointerMove={(e) => { if (e.buttons & 1) pickArea(e); }}
      >
        <span
          className="cp-area-thumb"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: currentHex }}
        />
      </div>

      <div
        ref={hueRef}
        className="cp-hue"
        tabIndex={0}
        role="slider"
        aria-label="Hue"
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        onKeyDown={onHueKey}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); pickHue(e); }}
        onPointerMove={(e) => { if (e.buttons & 1) pickHue(e); }}
      >
        <span className="cp-hue-thumb" style={{ left: `${(hsv.h / 360) * 100}%`, background: hueHex }} />
      </div>

      <div className="cp-footer">
        <span className="cp-preview" style={{ background: currentHex }} />
        <input
          className="cp-hex"
          type="text"
          value={hexDraft}
          maxLength={7}
          spellCheck={false}
          aria-label="Hex color"
          onChange={(e) => setHexDraft(e.target.value)}
          onBlur={(e) => commitHex(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commitHex(e.currentTarget.value); }
          }}
        />
      </div>
    </div>,
    document.body
  );
}

export default function ColorPicker({
  value,
  onChange,
  className = "",
  style,
  id,
  title,
  ariaLabel = "Pick color",
  disabled = false,
  children,
}) {
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        id={id}
        className={`cp-trigger${className ? ` ${className}` : ""}${open ? " is-open" : ""}`}
        style={{ background: normalizeColor(value), ...style }}
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
      >
        {children}
      </button>
      {open && (
        <ColorPopover anchorRef={anchorRef} value={value} onChange={onChange} onClose={close} />
      )}
    </>
  );
}
