import { useMemo, useEffect, useRef, useState, memo, forwardRef, useImperativeHandle } from "react";
import { MapContainer, TileLayer, Marker, Tooltip, Rectangle, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { formatYear } from "../utils/timelineUtils";
import { displayDateLabel } from "../utils/dateUtils";

const DEFAULT_COLOR = "#6b7280";
const TYPE_LABEL = { event: "Event", span: "Span", era: "Era" };
const DEFAULT_MARKER_TYPE = "pin";
const DEFAULT_MARKER_TYPES = {
  event: "pin",
  span: "circle",
  era: "diamond",
};

function resolveElementColor(el, spanById) {
  if (el.type === "event") {
    const parentId = el.parents?.[0];
    const parentSpan = parentId ? spanById.get(parentId) : null;
    if (parentSpan?.color) return parentSpan.color;
  }
  if (el.color) return el.color;
  return DEFAULT_COLOR;
}

function makeColoredIcon(color, selected, markerType = DEFAULT_MARKER_TYPE) {
  const stroke = selected
    ? getComputedStyle(document.documentElement).getPropertyValue("--selection-color").trim() || "#5282DB"
    : "white";
  const strokeWidth = selected ? 4 : 1.5;
  let svg = "";
  let iconSize = [24, 36];
  let iconAnchor = [12, 36];
  let tooltipAnchor = [14, -18];

  if (markerType === "circle") {
    iconSize = [24, 24];
    iconAnchor = [12, 12];
    tooltipAnchor = [0, -12];
    svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" style="cursor:pointer;display:block;">
        <circle cx="12" cy="12" r="9" fill="${color}" stroke="${stroke}" stroke-width="${strokeWidth}"/>
        <circle cx="12" cy="12" r="3.5" fill="white" opacity="0.7"/>
      </svg>`;
  } else if (markerType === "square") {
    iconSize = [24, 24];
    iconAnchor = [12, 12];
    tooltipAnchor = [0, -12];
    svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" style="cursor:pointer;display:block;">
        <rect x="4" y="4" width="16" height="16" rx="2" fill="${color}" stroke="${stroke}" stroke-width="${strokeWidth}"/>
        <circle cx="12" cy="12" r="3.5" fill="white" opacity="0.7"/>
      </svg>`;
  } else if (markerType === "diamond") {
    iconSize = [24, 24];
    iconAnchor = [12, 12];
    tooltipAnchor = [0, -12];
    svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" style="cursor:pointer;display:block;">
        <path d="M12 2 L22 12 L12 22 L2 12 Z" fill="${color}" stroke="${stroke}" stroke-width="${strokeWidth}"/>
        <circle cx="12" cy="12" r="3.2" fill="white" opacity="0.7"/>
      </svg>`;
  } else if (markerType === "triangle") {
    iconSize = [24, 24];
    iconAnchor = [12, 18];
    tooltipAnchor = [0, -14];
    svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" style="cursor:pointer;display:block;">
        <path d="M12 3 L22 20 H2 Z" fill="${color}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linejoin="round"/>
        <circle cx="12" cy="14" r="3" fill="white" opacity="0.7"/>
      </svg>`;
  } else {
    iconSize = [20, 30];
    iconAnchor = [10, 30];
    tooltipAnchor = [0, -14];
    svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="30" viewBox="0 0 24 36" style="cursor:pointer;display:block;">
        <rect x="0" y="0" width="24" height="36" fill="transparent"/>
        <path d="M12 0C5.373 0 0 5.373 0 12c0 9 12 24 12 24s12-15 12-24C24 5.373 18.627 0 12 0z"
          fill="${color}" stroke="${stroke}" stroke-width="${strokeWidth}"/>
        <circle cx="12" cy="12" r="5" fill="white" opacity="0.7"/>
      </svg>`;
  }

  return L.divIcon({
    html: svg,
    className: "",
    iconSize,
    iconAnchor,
    tooltipAnchor,
  });
}

function resolveMarkerType(elType, fileConfig) {
  if (elType === "span") return fileConfig?.mapSpanMarker || DEFAULT_MARKER_TYPES.span;
  if (elType === "era") return fileConfig?.mapEraMarker || DEFAULT_MARKER_TYPES.era;
  return fileConfig?.mapEventMarker || DEFAULT_MARKER_TYPES.event;
}

function isMarkerVisibleAtViewportYear(el, viewportYear, fileConfig) {
  if (!fileConfig?.mapLimitToViewportYear || !Number.isFinite(viewportYear)) return true;

  if (el.type === "event") {
    return Number.isFinite(el.date) && Math.abs(el.date - viewportYear) < 1e-6;
  }

  const start = Number.isFinite(el.start) ? el.start : null;
  const end = Number.isFinite(el.end) ? el.end : null;
  if (start == null && end == null) return false;
  if (start == null) return viewportYear <= end;
  if (end == null) return viewportYear >= start;
  return viewportYear >= start && viewportYear <= end;
}

function formatElementDate(el, fileConfig) {
  const { negID, posID, useCalendar, hideDecimals } = fileConfig ?? {};
  if (el.type === "event") {
    const year = displayDateLabel(el.dateLabel) ?? (el.date != null ? formatYear(el.date, negID, posID, useCalendar === true, hideDecimals) : null);
    return year ?? "";
  }
  const start = displayDateLabel(el.startLabel) ?? (el.start != null ? formatYear(el.start, negID, posID, useCalendar === true, hideDecimals) : null);
  const end = displayDateLabel(el.endLabel) ?? (el.end != null ? formatYear(el.end, negID, posID, useCalendar === true, hideDecimals) : null);
  if (start && end) return `${start} - ${end}`;
  return start ?? end ?? "";
}

function MapClickHandler({ onSelect }) {
  useMapEvents({
    click: (e) => {
      if (e.originalEvent?.target?.closest?.(".leaflet-marker-icon")) return;
      onSelect?.(null);
    }
  });
  return null;
}

function MapContextMenuHandler({ onOpenContextMenu }) {
  useMapEvents({
    contextmenu: (e) => {
      if (e.originalEvent?.target?.closest?.(".leaflet-marker-icon")) return;
      L.DomEvent.stop(e.originalEvent);
      onOpenContextMenu?.({
        x: e.originalEvent?.clientX ?? 0,
        y: e.originalEvent?.clientY ?? 0,
        lat: Number(e.latlng?.lat),
        lng: Number(e.latlng?.lng),
      });
    },
  });
  return null;
}

function HoverCleanupHandler({ onHoverChange }) {
  const map = useMap();

  useMapEvents({
    mousemove: (e) => {
      const overMarker = e.originalEvent?.target?.closest?.(".leaflet-marker-icon");
      if (!overMarker) onHoverChange(null);
    },
    dragstart: () => onHoverChange(null),
    zoomstart: () => onHoverChange(null),
    click: () => onHoverChange(null),
  });

  useEffect(() => {
    const container = map.getContainer();
    const handleMouseLeave = () => onHoverChange(null);
    container.addEventListener("mouseleave", handleMouseLeave);
    return () => container.removeEventListener("mouseleave", handleMouseLeave);
  }, [map, onHoverChange]);

  return null;
}

function MapControls({ controlRef }) {
  const map = useMap();
  useImperativeHandle(controlRef, () => ({
    zoomIn: () => map.zoomIn(),
    zoomOut: () => map.zoomOut(),
  }), [map]);
  return null;
}

function MinZoomEnforcer() {
  const map = useMap();

  useEffect(() => {
    const update = () => {
      const h = map.getContainer().clientHeight;
      // At zoom z, world height = 256 * 2^z px — find min z where it fills the container
      const minZoom = Math.ceil(Math.log2(h / 256));
      map.setMinZoom(minZoom);
      if (map.getZoom() < minZoom) map.setZoom(minZoom);
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);

  return null;
}

function WheelShortcutHandler({ onAltWheelPan, onCtrlWheelZoom }) {
  const map = useMap();

  useEffect(() => {
    if (!onAltWheelPan && !onCtrlWheelZoom) return undefined;

    const container = map.getContainer();
    const handleWheel = (e) => {
      if (e.altKey && onAltWheelPan) {
        e.preventDefault();
        e.stopPropagation();
        onAltWheelPan({
          deltaX: e.deltaX,
          deltaY: e.deltaY,
          shiftKey: e.shiftKey,
        });
        return;
      }
      if (!(e.ctrlKey || e.metaKey) || !onCtrlWheelZoom) return;
      e.preventDefault();
      e.stopPropagation();
      onCtrlWheelZoom({
        deltaY: e.deltaY,
        clientX: e.clientX,
        clientY: e.clientY,
      });
    };

    container.addEventListener("wheel", handleWheel, { passive: false, capture: true });
    return () => container.removeEventListener("wheel", handleWheel, true);
  }, [map, onAltWheelPan, onCtrlWheelZoom]);

  return null;
}

function MapAttribution({ attribution }) {
  const map = useMap();
  useEffect(() => {
    const control = new L.Control.Attribution({ prefix: false, position: "bottomright" });
    control.addTo(map);
    map.attributionControl = control;
    if (attribution) control.addAttribution(attribution);
    return () => { control.remove(); };
  }, [map, attribution]);
  return null;
}

function FlyToSelected({ markers, selectedId }) {
  const map = useMap();
  const lastSnappedId = useRef(null);
  useEffect(() => {
    if (!selectedId || selectedId === lastSnappedId.current) return;
    const el = markers.find((m) => m.id === selectedId);
    if (el) {
      lastSnappedId.current = selectedId;
      map.flyTo([Number(el.lat), Number(el.lng)], Math.max(map.getZoom(), 5), { duration: 0.8 });
    }
  }, [selectedId, markers, map]);
  return null;
}

const REPEAT_OVERLAY_OPTIONS = { fillColor: "#000", fillOpacity: 0.25, stroke: false, interactive: false };

function RepeatOverlay() {
  return (
    <>
      <Rectangle bounds={[[-200, -10000], [200, -180]]} pathOptions={REPEAT_OVERLAY_OPTIONS} />
      <Rectangle bounds={[[-200, 180], [200, 10000]]} pathOptions={REPEAT_OVERLAY_OPTIONS} />
    </>
  );
}

const DEFAULT_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const DEFAULT_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function isOpenStreetMapTileUrl(url) {
  if (!url) return true;
  return /^https:\/\/(?:[a-z0-9-]+\.)*tile\.openstreetmap\.org\//i.test(url);
}

export default memo(forwardRef(function MapView({ elements = [], onSelect, onOpenContextMenu, onAltWheelPan, onCtrlWheelZoom, viewportYear, selectedId, fileConfig }, ref) {
  const spanById = useMemo(() => {
    const map = new Map();
    elements.forEach((el) => { if (el.type === "span") map.set(el.id, el); });
    return map;
  }, [elements]);

  const markers = useMemo(() =>
    elements
      .filter((el) => el.lat != null && el.lat !== "" && el.lng != null && el.lng !== "")
      .filter((el) => isMarkerVisibleAtViewportYear(el, viewportYear, fileConfig))
      .map((el) => ({ ...el, resolvedColor: resolveElementColor(el, spanById) })),
    [elements, spanById, viewportYear, fileConfig]
  );
  const [hoveredId, setHoveredId] = useState(null);

  const [initialView] = useState(() => ({
    center: markers.length > 0 ? [Number(markers[0].lat), Number(markers[0].lng)] : [20, 0],
    zoom: markers.length > 0 ? 5 : 2,
  }));
  const tileUrl = fileConfig?.mapTileUrl || DEFAULT_TILE_URL;
  const tileAttribution = isOpenStreetMapTileUrl(tileUrl) ? DEFAULT_ATTRIBUTION : "";

  return (
    <div className="timeline-map-view">
      <MapContainer
        center={initialView.center}
        zoom={initialView.zoom}
        style={{ width: "100%", height: "100%" }}
        zoomControl={true}
        attributionControl={false}
        maxBounds={[[-85.0511, -270], [85.0511, 270]]}
        maxBoundsViscosity={1.0}
      >
        <MapClickHandler onSelect={onSelect} />
        <MapContextMenuHandler onOpenContextMenu={onOpenContextMenu} />
        <HoverCleanupHandler onHoverChange={setHoveredId} />
        <MapControls controlRef={ref} />
        <MinZoomEnforcer />
        <WheelShortcutHandler onAltWheelPan={onAltWheelPan} onCtrlWheelZoom={onCtrlWheelZoom} />
        <FlyToSelected markers={markers} selectedId={selectedId} />
        <MapAttribution attribution={tileAttribution} />
        <TileLayer
          url={tileUrl}
          attribution={tileAttribution}
          referrerPolicy="strict-origin-when-cross-origin"
        />
        <RepeatOverlay />
        {markers.map((el) => {
          const dateStr = formatElementDate(el, fileConfig);
          const tags = Array.isArray(el.tags) && el.tags.length > 0 ? el.tags : null;
          return (
            <Marker
              key={el.id}
              position={[Number(el.lat), Number(el.lng)]}
              icon={makeColoredIcon(el.resolvedColor, el.id === selectedId, resolveMarkerType(el.type, fileConfig))}
              bubblingMouseEvents={false}
              eventHandlers={{
                click: () => onSelect?.(el.id),
                mouseover: () => setHoveredId(el.id),
                mouseout: () => {
                  setHoveredId((current) => (current === el.id ? null : current));
                },
              }}
            >
              {hoveredId === el.id && (
                <Tooltip
                  className="map-element-tooltip"
                  direction="top"
                  offset={[0, -12]}
                  opacity={1}
                  interactive={false}
                  permanent
                >
                  <div className="map-popup-box" style={{ borderColor: el.resolvedColor }}>
                    <div className="map-popup-header">
                      <span className="map-popup-type" style={{ background: el.resolvedColor }}>{TYPE_LABEL[el.type] ?? el.type}</span>
                      {dateStr && <span className="map-popup-date">{dateStr}</span>}
                    </div>
                    <div className="map-popup-title">{el.title || el.id}</div>
                    {tags && (
                      <div className="map-popup-tags">
                        {tags.map((t) => <span key={t} className="map-popup-tag">{t}</span>)}
                      </div>
                    )}
                  </div>
                </Tooltip>
              )}
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}));
