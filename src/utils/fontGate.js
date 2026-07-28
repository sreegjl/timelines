// Calls onLoaded once when a webfont becomes available, so event heights can be re-measured.
// Polls because WebKit never fires loadingdone for a runtime-injected stylesheet.

const NOOP = () => {};
const POLL_INTERVAL_MS = 100;
const POLL_LIMIT = 100;

const normalizeFamily = (value) => String(value || "").trim().replace(/^["']|["']$/g, "").toLowerCase();

// Not fonts.check(): it calls an unknown family available. One face is enough because
// unicode-range subsets leave their siblings unloaded forever.
function familyLoaded(fonts, family) {
  try {
    for (const face of fonts) {
      if (normalizeFamily(face.family) === family && face.status === "loaded") return true;
    }
  } catch {
    return true;
  }
  return false;
}

export function watchFontLoad(fonts, fontStack, onLoaded) {
  const family = normalizeFamily(String(fontStack || "").split(",")[0]);
  if (!fonts || !family || familyLoaded(fonts, family)) return NOOP;

  let polls = 0;
  const timer = setInterval(() => {
    polls += 1;
    if (familyLoaded(fonts, family)) {
      clearInterval(timer);
      onLoaded();
    } else if (polls >= POLL_LIMIT) {
      clearInterval(timer);
    }
  }, POLL_INTERVAL_MS);

  return () => clearInterval(timer);
}
