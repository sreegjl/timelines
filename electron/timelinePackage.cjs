// Packaged .timeline format: a zip holding timeline.json (identical to the bare
// format), assets/, notes/, and manifest.json. The same shape is read in the
// browser viewer via src/utils/packageReader.js; keep the two in sync.
const { zipSync, unzipSync, strToU8, strFromU8 } = require('fflate');

const PACKAGE_FORMAT_VERSION = 1;

// Zip local-file-header magic; bare timelines start with '{'
const isZipBuffer = (buf) =>
  Boolean(buf && buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b);

// Rejects traversal and absolute segments so zip entries can't escape the
// extraction folder; returns the normalized relative path or null
const sanitizeEntryPath = (name) => {
  const parts = String(name || '').split(/[/\\]/).filter((p) => p && p !== '.');
  if (parts.length === 0) return null;
  if (parts.some((p) => p === '..' || /^[a-zA-Z]:$/.test(p))) return null;
  return parts.join('/');
};

// Fixed entry mtime so deterministic builds don't embed the build time
const DETERMINISTIC_MTIME = new Date('2000-01-01T00:00:00Z');

// files: { 'assets/img.png': Uint8Array, 'notes/note.md': Uint8Array }
// opts.deterministic: sorted entries, stored (level 0), fixed mtime, so an
// unchanged timeline zips byte-identically; used by git sync mirror exports
function buildPackage(timelineJson, files = {}, opts = {}) {
  const entries = {
    'manifest.json': strToU8(JSON.stringify({ format: 'timeline-package', version: PACKAGE_FORMAT_VERSION }, null, 2)),
    'timeline.json': strToU8(timelineJson),
    ...files,
  };
  if (!opts.deterministic) return zipSync(entries);
  const sorted = {};
  for (const name of Object.keys(entries).sort()) {
    sorted[name] = [entries[name], { level: 0, mtime: DETERMINISTIC_MTIME }];
  }
  return zipSync(sorted);
}

function readPackage(buf) {
  const entries = unzipSync(buf instanceof Uint8Array ? buf : new Uint8Array(buf));
  const timelineRaw = entries['timeline.json'];
  if (!timelineRaw) throw new Error('Package is missing timeline.json');

  let manifest = null;
  if (entries['manifest.json']) {
    try { manifest = JSON.parse(strFromU8(entries['manifest.json'])); } catch {}
  }

  const assets = {};
  const notes = {};
  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith('/')) continue; // directory entry
    if (name.startsWith('assets/')) {
      const rel = sanitizeEntryPath(name.slice('assets/'.length));
      if (rel) assets[rel] = data;
    } else if (name.startsWith('notes/')) {
      const rel = sanitizeEntryPath(name.slice('notes/'.length));
      if (rel) notes[rel] = strFromU8(data);
    }
  }
  return { timelineJson: strFromU8(timelineRaw), manifest, assets, notes };
}

module.exports = {
  PACKAGE_FORMAT_VERSION,
  isZipBuffer,
  sanitizeEntryPath,
  buildPackage,
  readPackage,
  strToU8,
  strFromU8,
};
