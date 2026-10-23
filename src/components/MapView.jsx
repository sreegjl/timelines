import { useMemo, useEffect, useRef, useState, memo, forwardRef, useImperativeHandle, Fragment } from "react";
import { MapContainer, TileLayer, Marker, Tooltip, Rectangle, Polyline, useMap, useMapEvents } from "react-leaflet";
import { buildRoutes, screenBearing } from "../utils/mapRoutes";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  buildMarkerSvg,
  resolveElementColor,
  resolveMarkerType,
  isMarkerVisibleAtViewportYear,
  formatElementDate,
  normalizeLng,
  roundCoord,
  TYPE_LABEL,
  DEFAULT_MARKER_TYPE,
  DEFAULT_TILE_URL,
  DEFAULT_ATTRIBUTION,
  isOpenStreetMapTileUrl,
} from "../utils/mapMarkers";

function makeColoredIcon(color, selected, markerType = DEFAULT_MARKER_TYPE) {
  const { svg, iconSize, iconAnchor, tooltipAnchor } = buildMarkerSvg(color, selected, markerType);
  return L.divIcon({
    html: svg,
    className: "",
    iconSize,
    iconAnchor,
    tooltipAnchor,
  });
}

function MapClickHandler({ onSelect, pickMode, onPickCoordinate }) {
  useMapEvents({
    click: (e) => {
      if (e.originalEvent?.target?.closest?.(".leaflet-marker-icon")) return;
      if (pickMode) {
        const lat = Number(e.latlng?.lat);
        const lng = Number(e.latlng?.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        onPickCoordinate?.({ lat: roundCoord(lat), lng: roundCoord(normalizeLng(lng)) });
        return;
      }
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

const arrowIconCache = new Map();
function makeArrowIcon(color, angle) {
  const key = `${color}|${Math.round(angle)}`;
  if (!arrowIconCache.has(key)) {
    arrowIconCache.set(key, L.divIcon({
      html: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 14 14" style="display:block;transform:rotate(${angle}deg)"><path d="M2 2 L12 7 L2 12 L5 7 Z" fill="${color}" stroke="white" stroke-width="1.2" stroke-linejoin="round"/></svg>`,
      className: "map-route-arrow",
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    }));
  }
  return arrowIconCache.get(key);
}

// the journeys. lines under the pins, little arrows so nobody argues about which way they went
function RouteLayer({ routes }) {
  return routes.map((route) => (
    <Fragment key={route.id}>
      <Polyline
        positions={route.points.map((p) => [p.lat, p.lng])}
        pathOptions={{ color: route.color, weight: 3, opacity: 0.8, lineCap: "round", lineJoin: "round" }}
        interactive={false}
      />
      {route.points.slice(1).map((point, index) => {
        const prev = route.points[index];
        return (
          <Marker
            key={`${prev.id}-${point.id}`}
            position={[(prev.lat + point.lat) / 2, (prev.lng + point.lng) / 2]}
            icon={makeArrowIcon(route.color, screenBearing(prev, point))}
            interactive={false}
            keyboard={false}
          />
        );
      })}
    </Fragment>
  ));
}

export default memo(forwardRef(function MapView({ elements = [], onSelect, onOpenContextMenu, onAltWheelPan, onCtrlWheelZoom, viewportYear, selectedId, fileConfig, pickMode = false, onPickCoordinate }, ref) {
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
  const routes = useMemo(() => buildRoutes(elements, fileConfig?.mapRoutes, {
    viewportYear,
    limitToYear: fileConfig?.mapLimitToViewportYear === true,
    tagColors: fileConfig?.tagColors,
    groups: fileConfig?.groups,
  }), [elements, fileConfig?.mapRoutes, fileConfig?.mapLimitToViewportYear, fileConfig?.tagColors, fileConfig?.groups, viewportYear]);

  const [initialView] = useState(() => ({
    center: markers.length > 0 ? [Number(markers[0].lat), Number(markers[0].lng)] : [20, 0],
    zoom: markers.length > 0 ? 5 : 2,
  }));
  const tileUrl = fileConfig?.mapTileUrl || DEFAULT_TILE_URL;
  const tileAttribution = isOpenStreetMapTileUrl(tileUrl) ? DEFAULT_ATTRIBUTION : "";

  return (
    <div className={pickMode ? "timeline-map-view is-picking" : "timeline-map-view"}>
      <MapContainer
        center={initialView.center}
        zoom={initialView.zoom}
        style={{ width: "100%", height: "100%" }}
        zoomControl={true}
        attributionControl={false}
        maxBounds={[[-85.0511, -270], [85.0511, 270]]}
        maxBoundsViscosity={1.0}
      >
        <MapClickHandler onSelect={onSelect} pickMode={pickMode} onPickCoordinate={onPickCoordinate} />
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
        <RouteLayer routes={routes} />
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
