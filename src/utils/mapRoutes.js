// routes connect the dots in date order, so journeys stop looking like confetti dropped on europe

export const ROUTE_MODES = ["off", "span", "tag", "group", "all"];

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

export function buildRoutes(elements, mode, options = {}) {
  if (!mode || mode === "off" || !Array.isArray(elements)) return [];
  const { viewportYear = null, limitToYear = false, tagColors = {}, groups = [] } = options;
  const byId = new Map(elements.map((el) => [el.id, el]));
  const located = elements.filter((el) => el && el.type !== "era" && hasCoords(el) && Number.isFinite(dateKey(el)));
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
    const points = unwrapLongitudes(items.map((el) => ({ id: el.id, lat: Number(el.lat), lng: Number(el.lng), date: dateKey(el) })));
    routes.push({ id, label: bucket.label, color, points });
  }
  return routes;
}

// bearing in web mercator space, which is what the map actually draws. degrees, 0 = east, clockwise
export function screenBearing(from, to) {
  const project = (p) => {
    const x = (p.lng * Math.PI) / 180;
    const lat = Math.max(-85.0511, Math.min(85.0511, p.lat));
    const y = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
    return { x, y };
  };
  const a = project(from);
  const b = project(to);
  return (Math.atan2(a.y - b.y, b.x - a.x) * 180) / Math.PI + 0;
}
