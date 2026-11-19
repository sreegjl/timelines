// routes connect the dots in date order, so journeys stop looking like confetti dropped on europe

export const ROUTE_MODES = ["off", "span", "lineage", "tag", "group", "all"];

const ROUTE_PALETTE = ["#5282DB", "#C65D3B", "#6AA84F", "#8E7CC3", "#E69138", "#3D85C6", "#A64D79", "#45818E"];
const FALLBACK_COLOR = "#6b7280";

const hasCoords = (el) => Number.isFinite(Number(el?.lat)) && Number.isFinite(Number(el?.lng)) && el.lat !== "" && el.lng !== "" && el.lat != null && el.lng != null;
const dateKey = (el) => (el?.type === "event" ? el.date : el?.start);

// shift each longitude so the line takes the short way around instead of crossing the whole planet
export function unwrapLongitudes(points) {
  const out = [];
  let prev = null;
  for (const point of points) {
    let lng = Number(point.lng);
    if (prev != null) {
      while (lng - prev > 180) lng -= 360;
      while (lng - prev < -180) lng += 360;
    }
    out.push({ ...point, lng });
    prev = lng;
  }
  return out;
}

const isCoord = (c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]);

// legPaths is { [fromId]: { [toId]: [[lng, lat], ...] } }; a path drawn one way also serves the trip back
export function getLegPath(legPaths, fromId, toId) {
  const forward = legPaths?.[fromId]?.[toId];
  if (Array.isArray(forward)) return forward.filter(isCoord);
  const backward = legPaths?.[toId]?.[fromId];
  if (Array.isArray(backward)) return backward.filter(isCoord).reverse();
  return [];
}

// no waypoints clears both directions, otherwise the reverse path would quietly take over
export function setLegPath(legPaths, fromId, toId, waypoints) {
  const next = { ...(legPaths || {}) };
  const write = (a, b, value) => {
    const inner = { ...(next[a] || {}) };
    if (value) inner[b] = value;
    else delete inner[b];
    if (Object.keys(inner).length) next[a] = inner;
    else delete next[a];
  };
  if (Array.isArray(waypoints) && waypoints.length) write(fromId, toId, waypoints);
  else {
    write(fromId, toId, null);
    write(toId, fromId, null);
  }
  return Object.keys(next).length ? next : undefined;
}

export function pruneLegPaths(legPaths, removedIds) {
  if (!legPaths) return legPaths;
  const removed = removedIds instanceof Set ? removedIds : new Set(removedIds);
  const next = {};
  for (const [fromId, inner] of Object.entries(legPaths)) {
    if (removed.has(fromId) || !inner) continue;
    const kept = Object.fromEntries(Object.entries(inner).filter(([toId]) => !removed.has(toId)));
    if (Object.keys(kept).length) next[fromId] = kept;
  }
  return Object.keys(next).length ? next : undefined;
}

// unwraps stops and waypoints as one line, so a waypoint past the date line still goes the short way
function layoutLegs(stops, legPaths) {
  const sequence = [];
  stops.forEach((stop, index) => {
    sequence.push({ ...stop, isStop: true });
    const next = stops[index + 1];
    if (next) for (const [lng, lat] of getLegPath(legPaths, stop.id, next.id)) sequence.push({ lng, lat });
  });
  const points = [];
  const legs = [];
  let current = null;
  for (const { isStop, ...point } of unwrapLongitudes(sequence)) {
    if (current) current.coords.push([point.lng, point.lat]);
    if (!isStop) continue;
    if (current) legs.push({ ...current, to: point.id });
    points.push(point);
    current = { from: point.id, coords: [[point.lng, point.lat]] };
  }
  return { points, legs };
}

// web mercator y, in degrees so it sits on the same scale as longitude
const mercatorY = (lat) => (Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * Math.PI) / 360)) * 180) / Math.PI;
const inverseMercatorY = (y) => (Math.atan(Math.exp((y * Math.PI) / 180)) * 360) / Math.PI - 90;

// halfway along the line as drawn on a flat map, plus the clockwise screen angle there
export function legMidpoint(coords) {
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const projected = coords.map(([lng, lat]) => [lng, mercatorY(lat)]);
  const lengths = projected.slice(1).map((p, i) => Math.hypot(p[0] - projected[i][0], p[1] - projected[i][1]));
  const total = lengths.reduce((sum, len) => sum + len, 0);
  let remaining = total / 2;
  let index = 0;
  while (index < lengths.length - 1 && remaining > lengths[index]) remaining -= lengths[index++];
  const [x1, y1] = projected[index];
  const [x2, y2] = projected[index + 1];
  const t = lengths[index] > 0 ? remaining / lengths[index] : 0.5;
  return {
    coord: [x1 + (x2 - x1) * t, inverseMercatorY(y1 + (y2 - y1) * t)],
    bearing: (Math.atan2(-(y2 - y1), x2 - x1) * 180) / Math.PI,
  };
}

export function buildRoutes(elements, mode, options = {}) {
  if (!mode || mode === "off" || !Array.isArray(elements)) return [];
  const { viewportYear = null, limitToYear = false, isPointVisible = null, tagColors = {}, groups = [], legPaths = null } = options;
  const byId = new Map(elements.map((el) => [el.id, el]));
  // isPointVisible is the map's own marker rule, so a route never runs to a point with no marker
  const located = elements.filter((el) => el && el.type !== "era" && hasCoords(el) && Number.isFinite(dateKey(el)) && (!isPointVisible || isPointVisible(el)));
  if (mode === "lineage") return buildLineageRoutes(located, byId, legPaths);
  const buckets = new Map();
  const push = (key, meta, el) => {
    if (!buckets.has(key)) buckets.set(key, { ...meta, items: [] });
    buckets.get(key).items.push(el);
  };

  for (const el of located) {
    if (mode === "span") {
      const parentId = el.type === "event" ? el.parents?.[0] : el.parent;
      if (parentId && byId.get(parentId)?.type === "span") {
        const parent = byId.get(parentId);
        push(`span:${parentId}`, { label: parent.title || parentId, color: parent.color }, el);
      }
      // a span with coords kicks off its own route, it was there first after all
      if (el.type === "span") push(`span:${el.id}`, { label: el.title || el.id, color: el.color }, el);
    } else if (mode === "tag") {
      for (const tag of Array.isArray(el.tags) ? el.tags : []) push(`tag:${tag}`, { label: `#${tag}`, color: tagColors[tag] }, el);
    } else if (mode === "group") {
      const group = groups.find((g) => g.id === el.groupId);
      if (el.groupId) push(`group:${el.groupId}`, { label: group?.title || el.groupId, color: group?.color }, el);
    } else {
      push("all", { label: "Everything" }, el);
    }
  }

  const routes = [];
  let paletteIndex = 0;
  for (const [id, bucket] of buckets) {
    let items = [...new Map(bucket.items.map((el) => [el.id, el])).values()]
      // same date? the span goes first, it's the one throwing the party
      .sort((a, b) => dateKey(a) - dateKey(b) || (a.type === "span" ? 0 : 1) - (b.type === "span" ? 0 : 1) || String(a.id).localeCompare(String(b.id)));
    if (limitToYear && Number.isFinite(viewportYear)) items = items.filter((el) => dateKey(el) <= viewportYear + 1e-6);
    if (items.length < 2) continue;
    const color = bucket.color || ROUTE_PALETTE[paletteIndex++ % ROUTE_PALETTE.length] || FALLBACK_COLOR;
    const { points, legs } = layoutLegs(items.map((el) => ({ id: el.id, lat: Number(el.lat), lng: Number(el.lng), date: dateKey(el) })), legPaths);
    routes.push({ id, label: bucket.label, color, points, legs });
  }
  return routes;
}

// one arrow per span link (extends from, branches from its parent, merges into), earlier to later
function buildLineageRoutes(located, byId, legPaths) {
  const shown = new Set(located.map((el) => el.id));
  const routes = [];
  const seen = new Set();
  const add = (from, to) => {
    if (!from || !to || from.id === to.id || !shown.has(from.id) || !shown.has(to.id)) return;
    const id = `lineage:${from.id}>${to.id}`;
    if (seen.has(id)) return;
    seen.add(id);
    const { points, legs } = layoutLegs([from, to].map((el) => ({ id: el.id, lat: Number(el.lat), lng: Number(el.lng), date: dateKey(el) })), legPaths);
    routes.push({ id, label: `${from.title || from.id} → ${to.title || to.id}`, color: to.color || from.color || FALLBACK_COLOR, points, legs });
  };
  for (const el of located) {
    if (el.type !== "span") continue;
    if (el.extendFrom) add(byId.get(el.extendFrom), el);
    if (el.parent && byId.get(el.parent)?.type === "span") add(byId.get(el.parent), el);
    if (el.mergeParent) add(el, byId.get(el.mergeParent));
  }
  return routes;
}
