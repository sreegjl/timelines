import { memo, forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { buildRoutes, legMidpoint } from "../utils/mapRoutes";

// file:// builds can't guess where the worker lives, so we tell it. directions matter, even for workers
setWorkerUrl(workerUrl);

// tiles load as plain <img>s, so the csp stays happy without opening connect-src to the planet
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
const ROUTE_HIT_PX = 6;
const legKey = (from, to) => JSON.stringify([from, to]);

// {s} subdomain templates need expanding, maplibre wants the actual list
const expandTileUrl = (url) =>
  (url.includes("{s}") ? ["a", "b", "c"].map((s) => url.replace("{s}", s)) : [url]).map((u) => `${TILE_PROTOCOL}://${u}`);

const DEFAULT_MIN_ZOOM = -2;

const readCssVar = (name, fallback) => {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
};

function buildStyle(tileUrl, attribution, globe) {
  return {
    version: 8,
    projection: { type: globe ? "globe" : "mercator" },
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
        id: "route-selected",
        type: "line",
        source: ROUTE_SOURCE,
        filter: ["==", ["get", "key"], ""],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#ffffff", "line-width": 8, "line-opacity": 0.9 },
      },
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
          "icon-image": ["get", "icon"],
          "icon-rotate": ["get", "rotate"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
      },
    ],
  };
}

// override swaps in the leg being dragged, so the line follows the handle before anything is saved
const legCoords = (leg, override) => (override && override.from === leg.from && override.to === leg.to ? override.coords : leg.coords);

function routesToGeoJson(routes, override) {
  return {
    type: "FeatureCollection",
    features: routes.flatMap((route) => route.legs.map((leg) => ({
      type: "Feature",
      properties: { color: route.color, from: leg.from, to: leg.to, key: legKey(leg.from, leg.to) },
      geometry: { type: "LineString", coordinates: legCoords(leg, override) },
    }))),
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

// one arrow per leg, however winding, so a road doesn't sprout one at every bend
function routeArrowsToGeoJson(routes, override) {
  return {
    type: "FeatureCollection",
    features: routes.flatMap((route) => route.legs.flatMap((leg) => {
      const mid = legMidpoint(legCoords(leg, override));
      if (!mid) return [];
      return [{
        type: "Feature",
        properties: { icon: arrowIconName(route.color), rotate: mid.bearing },
        geometry: { type: "Point", coordinates: mid.coord },
      }];
    })),
  };
}

function drawRoutes(map, routes, showArrows, override = null) {
  map.getSource(ROUTE_SOURCE)?.setData(routes.length ? routesToGeoJson(routes, override) : EMPTY_ROUTES);
  map.getSource(ROUTE_ARROW_SOURCE)?.setData(showArrows && routes.length ? routeArrowsToGeoJson(routes, override) : EMPTY_ROUTES);
}

// waypoints are saved wrapped to ±180; the map draws them unwrapped next to their neighbours
const toSaved = ([lng, lat]) => [roundCoord(normalizeLng(lng)), roundCoord(lat)];
const nearLng = (lng, ref) => {
  let out = lng;
  while (out - ref > 180) out -= 360;
  while (out - ref < -180) out += 360;
  return out;
};

const mercatorMid = (a, b) => legMidpoint([a, b])?.coord ?? a;

// hover card, built with dom nodes so titles can't sneak html in
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

export default memo(forwardRef(function MapView({
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
  globe = false,
  onUpdateLegPath,
}, ref) {
  const { t } = useTranslation(["timeline"]);
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef(new Map());
  const popupRef = useRef(null);
  const [isReady, setIsReady] = useState(false);
  const lastFlownIdRef = useRef(null);
  const haloRef = useRef(null);
  const [activeLeg, setActiveLeg] = useState(null);
  const canEditRoutes = typeof onUpdateLegPath === "function";

  // callbacks live in a ref so the map listeners never go stale and never need re-wiring
  const handlersRef = useRef({});
  handlersRef.current = { onSelect, onOpenContextMenu, onAltWheelPan, onCtrlWheelZoom, onPickCoordinate, pickMode, fileConfig, globe, canEditRoutes };

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
    isPointVisible: (el) => isMarkerVisibleAtViewportYear(el, viewportYear, fileConfig),
    tagColors: fileConfig?.tagColors,
    groups: fileConfig?.groups,
    legPaths: fileConfig?.mapLegPaths,
  }), [elements, fileConfig?.mapRoutes, fileConfig?.mapLimitToViewportYear, fileConfig?.mapDateFilter, fileConfig?.tagColors, fileConfig?.groups, fileConfig?.mapLegPaths, viewportYear]);

  // the same leg can sit on several routes (an element with two tags); any copy has the same coords
  const activeLegData = useMemo(() => {
    if (!activeLeg) return null;
    for (const route of routes) {
      const leg = route.legs.find((l) => l.from === activeLeg.from && l.to === activeLeg.to);
      if (leg) return { ...leg, color: route.color };
    }
    return null;
  }, [routes, activeLeg]);
  const routesRef = useRef(routes);
  routesRef.current = routes;

  const tileUrl = fileConfig?.mapTileUrl || DEFAULT_TILE_URL;
  const attribution = isOpenStreetMapTileUrl(tileUrl) ? DEFAULT_ATTRIBUTION : "";

  useImperativeHandle(ref, () => ({
    zoomIn: () => mapRef.current?.zoomIn(),
    zoomOut: () => mapRef.current?.zoomOut(),
  }), []);

  // built once per tile url; switching 2d/3d only swaps the projection
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    let map;
    try {
      const first = markers[0];
      map = new MapLibreMap({
        container,
        style: buildStyle(tileUrl, attribution, globe),
        center: first ? [Number(first.lng), Number(first.lat)] : [0, 20],
        zoom: first ? (globe ? 3 : 4) : (globe ? 1.4 : 1),
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
        boxZoom: false,
      });
    } catch (error) {
      console.warn("Map view unavailable:", error);
      onUnavailable?.(error);
      return undefined;
    }
    mapRef.current = map;
    map.on("error", (e) => {
      // tile hiccups are normal life, a dead gl context is not
      if (String(e?.error?.message || "").toLowerCase().includes("webgl")) onUnavailable?.(e.error);
    });
    map.on("load", () => setIsReady(true));

    // globe's screen center and radius for the css atmosphere; a point 90° away sits on the rim
    const updateHalo = () => {
      const view = container.parentElement;
      if (!view || !handlersRef.current.globe) return;
      const center = map.getCenter();
      const middle = map.project(center);
      const rim = map.project([center.lng + 90, 0]);
      view.style.setProperty("--globe-x", `${middle.x}px`);
      view.style.setProperty("--globe-y", `${middle.y}px`);
      view.style.setProperty("--globe-r", `${Math.hypot(rim.x - middle.x, rim.y - middle.y)}px`);
    };
    map.on("load", updateHalo);
    map.on("move", updateHalo);
    map.on("resize", updateHalo);

    map.on("click", (e) => {
      if (e.originalEvent?.target?.closest?.(".maplibregl-marker")) return;
      const h = handlersRef.current;
      if (h.pickMode) {
        h.onPickCoordinate?.({ lat: roundCoord(e.lngLat.lat), lng: roundCoord(normalizeLng(e.lngLat.lng)) });
        return;
      }
      if (h.canEditRoutes && map.getLayer("routes")) {
        const { x, y } = e.point;
        const [hit] = map.queryRenderedFeatures([[x - ROUTE_HIT_PX, y - ROUTE_HIT_PX], [x + ROUTE_HIT_PX, y + ROUTE_HIT_PX]], { layers: ["routes"] });
        if (hit) {
          setActiveLeg({ from: hit.properties.from, to: hit.properties.to });
          return;
        }
      }
      setActiveLeg(null);
      h.onSelect?.(null);
    });
    map.on("mouseenter", "routes", () => {
      if (handlersRef.current.canEditRoutes && !handlersRef.current.pickMode) map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "routes", () => { map.getCanvas().style.cursor = ""; });
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

    // shift + drag slides the globe via uneven padding; captured so maplibre's drag never starts
    let slide = null;
    const handleSlideStart = (e) => {
      if (!handlersRef.current.globe || !e.shiftKey || e.button !== 0 || e.target.closest(".maplibregl-marker, .maplibregl-ctrl")) return;
      e.preventDefault();
      e.stopPropagation();
      const { left, right, top, bottom } = map.getPadding();
      slide = { x: e.clientX, y: e.clientY, offsetX: (left - right) / 2, offsetY: (top - bottom) / 2 };
      container.classList.add("is-sliding");
    };
    const handleSlideMove = (e) => {
      if (!slide) return;
      const maxX = container.clientWidth * 0.4;
      const maxY = container.clientHeight * 0.4;
      const x = Math.max(-maxX, Math.min(maxX, slide.offsetX + e.clientX - slide.x));
      const y = Math.max(-maxY, Math.min(maxY, slide.offsetY + e.clientY - slide.y));
      map.setPadding({ left: Math.max(0, 2 * x), right: Math.max(0, -2 * x), top: Math.max(0, 2 * y), bottom: Math.max(0, -2 * y) });
      updateHalo();
    };
    const handleSlideEnd = () => {
      if (!slide) return;
      slide = null;
      container.classList.remove("is-sliding");
    };
    container.addEventListener("mousedown", handleSlideStart, true);
    haloRef.current = updateHalo;
    window.addEventListener("mousemove", handleSlideMove);
    window.addEventListener("mouseup", handleSlideEnd);

    const markerStore = markersRef.current;
    return () => {
      container.removeEventListener("wheel", handleWheel, true);
      container.removeEventListener("mousedown", handleSlideStart, true);
      window.removeEventListener("mousemove", handleSlideMove);
      window.removeEventListener("mouseup", handleSlideEnd);
      markerStore.forEach(({ marker }) => marker.remove());
      markerStore.clear();
      popupRef.current?.remove();
      popupRef.current = null;
      map.remove();
      mapRef.current = null;
      haloRef.current = null;
      setIsReady(false);
    };
  }, [tileUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const map = isReady ? mapRef.current : null;
    if (!map) return;
    map.setProjection({ type: globe ? "globe" : "mercator" });
    if (globe) {
      map.setMinZoom(DEFAULT_MIN_ZOOM);
      haloRef.current?.();
      return undefined;
    }
    // drop any shift-drag offset, the flat map has nowhere to slide to
    map.setPadding({ left: 0, right: 0, top: 0, bottom: 0 });
    // world is 512 * 2^z px tall, so stop zooming out once it would stop filling the height
    const fitHeight = () => {
      const minZoom = Math.max(DEFAULT_MIN_ZOOM, Math.log2(map.getContainer().clientHeight / 512));
      map.setMinZoom(minZoom);
    };
    fitHeight();
    map.on("resize", fitHeight);
    return () => map.off("resize", fitHeight);
  }, [globe, isReady]);

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

  const showArrowsRef = useRef(showRouteArrows);
  showArrowsRef.current = showRouteArrows;

  useEffect(() => {
    const map = isReady ? mapRef.current : null;
    if (!map) return;
    if (showRouteArrows) {
      for (const route of routes) {
        const name = arrowIconName(route.color);
        if (!map.hasImage(name)) map.addImage(name, makeArrowImage(route.color), { pixelRatio: 2 });
      }
    }
    drawRoutes(map, routes, showRouteArrows);
  }, [routes, isReady, showRouteArrows]);

  // a leg that left the map (mode change, filter, deleted stop) can't stay selected
  useEffect(() => {
    if (activeLeg && !activeLegData) setActiveLeg(null);
  }, [activeLeg, activeLegData]);
  useEffect(() => {
    if (!canEditRoutes || pickMode) setActiveLeg(null);
  }, [canEditRoutes, pickMode]);

  useEffect(() => {
    if (!activeLeg) return undefined;
    const handleKey = (e) => {
      if (e.key === "Escape") setActiveLeg(null);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [activeLeg]);

  useEffect(() => {
    const map = isReady ? mapRef.current : null;
    map?.setFilter("route-selected", ["==", ["get", "key"], activeLegData ? legKey(activeLegData.from, activeLegData.to) : ""]);
  }, [activeLegData, isReady]);

  useEffect(() => {
    const map = isReady ? mapRef.current : null;
    if (!map || !activeLegData || !canEditRoutes) return undefined;
    const { from, to, coords, color } = activeLegData;
    const container = map.getContainer();
    const save = (next) => onUpdateLegPath(from, to, next.slice(1, -1).map(toSaved));
    const redraw = (draft) => drawRoutes(map, routesRef.current, showArrowsRef.current, { from, to, coords: draft });
    // wrapped world copies hand back lng ±360 away; pull it next to its neighbour so the line doesn't loop the planet
    const draggedCoord = (marker, ref) => {
      const { lng, lat } = marker.getLngLat();
      return [nearLng(lng, ref[0]), lat];
    };

    const makeHandle = (lngLat, ghost) => {
      const node = document.createElement("div");
      node.className = `route-handle${ghost ? " is-ghost" : ""}`;
      node.style.setProperty("--route-color", color);
      return { node, marker: new Marker({ element: node, draggable: true }).setLngLat(lngLat).addTo(map) };
    };
    const startDrag = (node) => {
      container.classList.add("is-dragging-route");
      node.classList.add("is-active");
    };
    const endDrag = (node) => {
      container.classList.remove("is-dragging-route");
      node?.classList.remove("is-active");
    };

    const handles = [];
    for (let i = 1; i < coords.length - 1; i += 1) {
      const { node, marker } = makeHandle(coords[i], false);
      node.title = t("map.routeHandleHint", "Drag to move, double-click to remove");
      let draft = null;
      marker.on("dragstart", () => { startDrag(node); draft = coords.map((c) => [...c]); });
      marker.on("drag", () => { draft[i] = draggedCoord(marker, draft[i - 1]); redraw(draft); });
      marker.on("dragend", () => { endDrag(node); save(draft); });
      const remove = (e) => {
        e.preventDefault();
        e.stopPropagation();
        save(coords.filter((_, index) => index !== i));
      };
      node.addEventListener("dblclick", remove);
      node.addEventListener("contextmenu", remove);
      handles.push(marker);
    }
    for (let i = 0; i < coords.length - 1; i += 1) {
      const { node, marker } = makeHandle(mercatorMid(coords[i], coords[i + 1]), true);
      node.title = t("map.routeGhostHint", "Drag to bend the route");
      node.addEventListener("dblclick", (e) => { e.preventDefault(); e.stopPropagation(); });
      let draft = null;
      marker.on("dragstart", () => {
        startDrag(node);
        draft = [...coords.slice(0, i + 1), mercatorMid(coords[i], coords[i + 1]), ...coords.slice(i + 1)].map((c) => [...c]);
      });
      marker.on("drag", () => { draft[i + 1] = draggedCoord(marker, draft[i]); redraw(draft); });
      marker.on("dragend", () => { endDrag(node); save(draft); });
      handles.push(marker);
    }
    return () => {
      endDrag();
      handles.forEach((marker) => marker.remove());
    };
  }, [activeLegData, isReady, canEditRoutes, onUpdateLegPath, t]);

  const elementTitle = (id) => elements.find((el) => el.id === id)?.title || id;

  // pauses while the pointer is down or the map is moving: moving the camera mid-gesture cancels drags
  useEffect(() => {
    const map = mapRef.current;
    if (!autoRotate || !globe || !isReady || !map) return undefined;
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
  }, [autoRotate, globe, isReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedId || selectedId === lastFlownIdRef.current) return;
    const el = markers.find((m) => m.id === selectedId);
    if (!el) return;
    lastFlownIdRef.current = selectedId;
    map.flyTo({ center: [Number(el.lng), Number(el.lat)], zoom: Math.max(map.getZoom(), 4), duration: 900 });
  }, [selectedId, markers]);

  return (
    <div className={`timeline-map-view timeline-globe-view${globe ? "" : " is-flat"}${pickMode ? " is-picking" : ""}${fileConfig?.mapGlobeHideGlow === true ? " no-glow" : ""}${fileConfig?.mapGlobeStars === true ? " stars" : ""}`}>
      <div ref={containerRef} className="globe-container" />
      {activeLegData && (
        <div className="map-route-editor" role="group" aria-label={t("map.routeEditor", "Route path")}>
          <span className="map-route-editor-swatch" style={{ background: activeLegData.color }} />
          <div className="map-route-editor-text">
            <div className="map-route-editor-title">{elementTitle(activeLegData.from)} → {elementTitle(activeLegData.to)}</div>
            <div className="map-route-editor-hint">{t("map.routeEditorHint", "Drag the small dots to bend this leg. Double-click a point to remove it.")}</div>
          </div>
          <button
            type="button"
            className="map-route-editor-button"
            disabled={activeLegData.coords.length <= 2}
            onClick={() => onUpdateLegPath?.(activeLegData.from, activeLegData.to, [])}
          >
            {t("map.routeStraighten", "Straighten")}
          </button>
          <button type="button" className="map-route-editor-button is-primary" onClick={() => setActiveLeg(null)}>
            {t("map.routeDone", "Done")}
          </button>
        </div>
      )}
    </div>
  );
}));
