import { memo, forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Map as MapLibreMap, Marker, Popup, setWorkerUrl, addProtocol } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  buildMarkerSvg,
  resolveElementColor,
  resolveMarkerType,
  isMarkerVisibleAtViewportYear,
  formatElementDate,
  normalizeLng,
  roundCoord,
  TYPE_LABEL,
  DEFAULT_TILE_URL,
  DEFAULT_ATTRIBUTION,
  isOpenStreetMapTileUrl,
} from "../utils/mapMarkers";
import { buildRoutes } from "../utils/mapRoutes";

// file:// builds can't guess where the worker lives, so we tell it. directions matter, even for workers
setWorkerUrl(workerUrl);

// tiles load as plain <img>s like leaflet's, so the csp stays happy without opening connect-src to the planet
const TILE_PROTOCOL = "timelines-tile";
addProtocol(TILE_PROTOCOL, (params, abortController) => new Promise((resolve, reject) => {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.referrerPolicy = "strict-origin-when-cross-origin";
  img.onload = () => resolve({ data: img });
  img.onerror = () => reject(new Error(`Tile failed to load: ${img.src}`));
  abortController.signal.addEventListener("abort", () => {
    img.src = "";
    reject(new DOMException("Tile request aborted", "AbortError"));
  });
  img.src = params.url.slice(TILE_PROTOCOL.length + 3);
}));

const ROUTE_SOURCE = "timeline-routes";
const ROUTE_ARROW_SOURCE = "timeline-route-arrows";
const EMPTY_ROUTES = { type: "FeatureCollection", features: [] };

// {s} subdomain templates are a leaflet-ism, maplibre wants the actual list
const expandTileUrl = (url) =>
  (url.includes("{s}") ? ["a", "b", "c"].map((s) => url.replace("{s}", s)) : [url]).map((u) => `${TILE_PROTOCOL}://${u}`);

const readCssVar = (name, fallback) => {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
};

function buildStyle(tileUrl, attribution) {
  return {
    version: 8,
    projection: { type: "globe" },
    sources: {
      base: {
        type: "raster",
        tiles: expandTileUrl(tileUrl),
        tileSize: 256,
        maxzoom: 19,
        attribution,
      },
      [ROUTE_SOURCE]: { type: "geojson", data: EMPTY_ROUTES },
      [ROUTE_ARROW_SOURCE]: { type: "geojson", data: EMPTY_ROUTES },
    },
    layers: [
      // the planet's base coat, so it still reads as a sphere while tiles are fashionably late
      { id: "ocean", type: "background", paint: { "background-color": readCssVar("--accent-color", "#e6dccb") } },
      { id: "base", type: "raster", source: "base" },
      {
        id: "routes",
        type: "line",
        source: ROUTE_SOURCE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["get", "color"], "line-width": 3, "line-opacity": 0.85 },
      },
      {
        id: "route-arrows",
        type: "symbol",
        source: ROUTE_ARROW_SOURCE,
        layout: {
          "symbol-placement": "line-center",
          "icon-image": ["get", "icon"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
      },
    ],
  };
}

function routesToGeoJson(routes) {
  return {
    type: "FeatureCollection",
    features: routes.map((route) => ({
      type: "Feature",
      properties: { id: route.id, color: route.color },
      geometry: { type: "LineString", coordinates: route.points.map((p) => [p.lng, p.lat]) },
    })),
  };
}

const arrowIconName = (color) => `route-arrow-${color}`;

// points right; maplibre turns it along each segment
function makeArrowImage(color) {
  const size = 36;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.scale(size / 14, size / 14);
  ctx.beginPath();
  ctx.moveTo(2, 2);
  ctx.lineTo(12, 7);
  ctx.lineTo(2, 12);
  ctx.lineTo(5, 7);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1.2;
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#ffffff";
  ctx.stroke();
  return ctx.getImageData(0, 0, size, size);
}

function routeArrowsToGeoJson(routes) {
  return {
    type: "FeatureCollection",
    features: routes.flatMap((route) => route.points.slice(1).map((point, index) => ({
      type: "Feature",
      properties: { icon: arrowIconName(route.color) },
      geometry: { type: "LineString", coordinates: [[route.points[index].lng, route.points[index].lat], [point.lng, point.lat]] },
    }))),
  };
}

// same card the flat map shows on hover, built with dom nodes so titles can't sneak html in
function buildTooltip(el, fileConfig) {
  const box = document.createElement("div");
  box.className = "map-popup-box";
  box.style.borderColor = el.resolvedColor;
  const header = document.createElement("div");
  header.className = "map-popup-header";
  const type = document.createElement("span");
  type.className = "map-popup-type";
  type.style.background = el.resolvedColor;
  type.textContent = TYPE_LABEL[el.type] ?? el.type;
  header.appendChild(type);
  const dateStr = formatElementDate(el, fileConfig);
  if (dateStr) {
    const date = document.createElement("span");
    date.className = "map-popup-date";
    date.textContent = dateStr;
    header.appendChild(date);
  }
  const title = document.createElement("div");
  title.className = "map-popup-title";
  title.textContent = el.title || el.id;
  box.append(header, title);
  if (Array.isArray(el.tags) && el.tags.length > 0) {
    const tags = document.createElement("div");
    tags.className = "map-popup-tags";
    for (const tag of el.tags) {
      const chip = document.createElement("span");
      chip.className = "map-popup-tag";
      chip.textContent = tag;
      tags.appendChild(chip);
    }
    box.appendChild(tags);
  }
  return box;
}

export default memo(forwardRef(function GlobeView({
  elements = [],
  onSelect,
  onOpenContextMenu,
  onAltWheelPan,
  onCtrlWheelZoom,
  viewportYear,
  selectedId,
  fileConfig,
  pickMode = false,
  onPickCoordinate,
  onUnavailable,
  autoRotate = false,
}, ref) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(new Map());
  const popupRef = useRef(null);
  const [isReady, setIsReady] = useState(false);
  const lastFlownIdRef = useRef(null);

  // callbacks live in a ref so the map listeners never go stale and never need re-wiring
  const handlersRef = useRef({});
  handlersRef.current = { onSelect, onOpenContextMenu, onAltWheelPan, onCtrlWheelZoom, onPickCoordinate, pickMode, fileConfig };

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

  const routes = useMemo(() => buildRoutes(elements, fileConfig?.mapRoutes, {
    // match marker visibility
    isPointVisible: (el) => isMarkerVisibleAtViewportYear(el, viewportYear, { mapLimitToViewportYear: fileConfig?.mapLimitToViewportYear }),
    tagColors: fileConfig?.tagColors,
    groups: fileConfig?.groups,
  }), [elements, fileConfig?.mapRoutes, fileConfig?.mapLimitToViewportYear, fileConfig?.tagColors, fileConfig?.groups, viewportYear]);

  const tileUrl = fileConfig?.mapTileUrl || DEFAULT_TILE_URL;
  const attribution = isOpenStreetMapTileUrl(tileUrl) ? DEFAULT_ATTRIBUTION : "";

  useImperativeHandle(ref, () => ({
    zoomIn: () => mapRef.current?.zoomIn(),
    zoomOut: () => mapRef.current?.zoomOut(),
  }), []);

  // birth of a planet. happens once per tile url, which is about as often as planets get born
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    let map;
    try {
      const first = markers[0];
      map = new MapLibreMap({
        container,
        style: buildStyle(tileUrl, attribution),
        center: first ? [Number(first.lng), Number(first.lat)] : [0, 20],
        zoom: first ? 3 : 1.4,
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
      });
    } catch (error) {
      console.warn("Globe view unavailable:", error);
      onUnavailable?.(error);
      return undefined;
    }
    mapRef.current = map;
    map.on("error", (e) => {
      // tile hiccups are normal life, a dead gl context is not
      if (String(e?.error?.message || "").toLowerCase().includes("webgl")) onUnavailable?.(e.error);
    });
    map.on("load", () => setIsReady(true));

    map.on("click", (e) => {
      if (e.originalEvent?.target?.closest?.(".maplibregl-marker")) return;
      const h = handlersRef.current;
      if (h.pickMode) {
        h.onPickCoordinate?.({ lat: roundCoord(e.lngLat.lat), lng: roundCoord(normalizeLng(e.lngLat.lng)) });
        return;
      }
      h.onSelect?.(null);
    });
    map.on("contextmenu", (e) => {
      if (e.originalEvent?.target?.closest?.(".maplibregl-marker")) return;
      e.originalEvent?.preventDefault?.();
      handlersRef.current.onOpenContextMenu?.({
        x: e.originalEvent?.clientX ?? 0,
        y: e.originalEvent?.clientY ?? 0,
        lat: e.lngLat.lat,
        lng: normalizeLng(e.lngLat.lng),
      });
    });

    const handleWheel = (e) => {
      const h = handlersRef.current;
      if (e.altKey && h.onAltWheelPan) {
        e.preventDefault();
        e.stopPropagation();
        h.onAltWheelPan({ deltaX: e.deltaX, deltaY: e.deltaY, shiftKey: e.shiftKey });
      } else if ((e.ctrlKey || e.metaKey) && h.onCtrlWheelZoom) {
        e.preventDefault();
        e.stopPropagation();
        h.onCtrlWheelZoom({ deltaY: e.deltaY, clientX: e.clientX, clientY: e.clientY });
      }
    };
    container.addEventListener("wheel", handleWheel, { passive: false, capture: true });

    const markerStore = markersRef.current;
    return () => {
      container.removeEventListener("wheel", handleWheel, true);
      markerStore.forEach(({ marker }) => marker.remove());
      markerStore.clear();
      popupRef.current?.remove();
      popupRef.current = null;
      map.remove();
      mapRef.current = null;
      setIsReady(false);
    };
  }, [tileUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // markers: add the new kids, restyle the old ones, wave goodbye to the rest
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const store = markersRef.current;
    const seen = new Set();
    for (const el of markers) {
      seen.add(el.id);
      const selected = el.id === selectedId;
      const markerType = resolveMarkerType(el.type, fileConfig);
      const signature = `${el.resolvedColor}|${selected}|${markerType}`;
      let entry = store.get(el.id);
      if (!entry) {
        const node = document.createElement("div");
        node.className = "globe-marker";
        node.addEventListener("click", (e) => {
          e.stopPropagation();
          handlersRef.current.onSelect?.(node.dataset.id);
        });
        node.addEventListener("mouseenter", () => {
          const current = store.get(node.dataset.id);
          if (!current) return;
          popupRef.current?.remove();
          popupRef.current = new Popup({ closeButton: false, closeOnClick: false, offset: 18, className: "map-element-tooltip" })
            .setLngLat(current.marker.getLngLat())
            .setDOMContent(buildTooltip(current.el, handlersRef.current.fileConfig))
            .addTo(map);
        });
        node.addEventListener("mouseleave", () => {
          popupRef.current?.remove();
          popupRef.current = null;
        });
        entry = { node, marker: null, signature: "", el };
        store.set(el.id, entry);
      }
      entry.el = el;
      entry.node.dataset.id = el.id;
      if (entry.signature !== signature) {
        const { svg } = buildMarkerSvg(el.resolvedColor, selected, markerType);
        entry.node.innerHTML = svg;
        entry.node.style.zIndex = selected ? "2" : "1";
        entry.signature = signature;
      }
      const lngLat = [Number(el.lng), Number(el.lat)];
      if (!entry.marker) {
        entry.marker = new Marker({ element: entry.node, anchor: markerType === "pin" ? "bottom" : "center" })
          .setLngLat(lngLat)
          .addTo(map);
      } else {
        entry.marker.setLngLat(lngLat);
      }
      // far-side markers: faint (default) or hidden
      const coveredOpacity = fileConfig?.mapGlobeHideFarSide === true ? "0" : "0.2";
      if (entry.coveredOpacity !== coveredOpacity) {
        entry.marker.setOpacity("1", coveredOpacity);
        entry.coveredOpacity = coveredOpacity;
      }
    }
    for (const [id, entry] of store) {
      if (seen.has(id)) continue;
      entry.marker?.remove();
      store.delete(id);
    }
  }, [markers, selectedId, fileConfig, isReady]);

  const showRouteArrows = fileConfig?.mapHideRouteArrows !== true;

  useEffect(() => {
    const map = isReady ? mapRef.current : null;
    if (!map) return;
    map.getSource(ROUTE_SOURCE)?.setData(routes.length ? routesToGeoJson(routes) : EMPTY_ROUTES);
    if (showRouteArrows) {
      for (const route of routes) {
        const name = arrowIconName(route.color);
        if (!map.hasImage(name)) map.addImage(name, makeArrowImage(route.color), { pixelRatio: 2 });
      }
    }
    map.getSource(ROUTE_ARROW_SOURCE)?.setData(showRouteArrows && routes.length ? routeArrowsToGeoJson(routes) : EMPTY_ROUTES);
  }, [routes, isReady, showRouteArrows]);

  // pauses while the pointer is down or the map is moving: moving the camera mid-gesture cancels drags
  useEffect(() => {
    const map = mapRef.current;
    if (!autoRotate || !isReady || !map) return undefined;
    const DEGREES_PER_SECOND = 4;
    const surface = map.getCanvasContainer();
    let held = false;
    const hold = () => { held = true; };
    const release = () => { held = false; };
    surface.addEventListener("pointerdown", hold);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    let frame = null;
    let last = null;
    const spin = (time) => {
      if (last !== null && !held && !map.isMoving()) {
        const center = map.getCenter();
        map.setCenter([center.lng - (DEGREES_PER_SECOND * (time - last)) / 1000, center.lat]);
      }
      last = time;
      frame = requestAnimationFrame(spin);
    };
    frame = requestAnimationFrame(spin);
    return () => {
      cancelAnimationFrame(frame);
      surface.removeEventListener("pointerdown", hold);
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, [autoRotate, isReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId || selectedId === lastFlownIdRef.current) return;
    const el = markers.find((m) => m.id === selectedId);
    if (!el) return;
    lastFlownIdRef.current = selectedId;
    map.flyTo({ center: [Number(el.lng), Number(el.lat)], zoom: Math.max(map.getZoom(), 4), duration: 900 });
  }, [selectedId, markers]);

  return (
    <div className={pickMode ? "timeline-map-view timeline-globe-view is-picking" : "timeline-map-view timeline-globe-view"}>
      <div ref={containerRef} className="globe-container" />
    </div>
  );
}));
