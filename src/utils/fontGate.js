const NOOP = () => {};
const POLL_INTERVAL_MS = 100;

const normalizeFamily = (value) => String(value || "").trim().replace(/^["']|["']$/g, "").toLowerCase();

const firstFamily = (stack) => normalizeFamily(String(stack || "").split(",")[0]);

// fonts.check() reports unknown families as available. Unicode-range siblings may stay unloaded.
export function isFontReady(fonts, fontStack) {
  const family = firstFamily(fontStack);
  if (!fonts || !family) return true;
  try {
    for (const face of fonts) {
      if (normalizeFamily(face.family) === family && face.status === "loaded") return true;
    }
  } catch {
    return true;
  }
  return false;
}

// WebKit may not fire loadingdone for runtime-injected stylesheets.
export function watchFontLoad(fonts, fontStack, onReady, timeoutMs) {
  if (isFontReady(fonts, fontStack)) return NOOP;

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearInterval(timer);
    clearTimeout(deadline);
    onReady();
  };

  const timer = setInterval(() => {
    if (isFontReady(fonts, fontStack)) finish();
  }, POLL_INTERVAL_MS);
  const deadline = setTimeout(finish, timeoutMs);

  return () => {
    done = true;
    clearInterval(timer);
    clearTimeout(deadline);
  };
}
