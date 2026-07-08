const { app, BrowserWindow, ipcMain, dialog, Menu, shell, protocol, net, session, safeStorage } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const fs = require('fs').promises;
const fsSync = require('fs');
const http = require('http');
const { autoUpdater } = require('electron-updater');
const { isZipBuffer, readPackage, buildPackage, strToU8 } = require('./timelinePackage.cjs');
const { createEngine } = require('./gitSync.cjs');
const DEFAULT_THEME_KEY = 'parchment';

// Force sRGB color profile to prevent washed-out appearance in screenshots/screenshare on HDR displays
app.commandLine.appendSwitch('force-color-profile', 'srgb');

// Must run before app.ready
try {
  const settingsPath = path.join(app.getPath('userData'), 'app-settings.json');
  const raw = fsSync.readFileSync(settingsPath, 'utf8');
  const settings = JSON.parse(raw);
  if (settings?.hardwareAcceleration === false) {
    app.disableHardwareAcceleration();
  }
} catch {
  // Leave hardware acceleration at default (enabled)
}

let mainWindow;
let gitSync = null;
let gitSyncQuitStarted = false;
const appSettingsPath = () => path.join(app.getPath('userData'), 'app-settings.json');
const defaultTimelinesDir = () => path.join(app.getPath('userData'), 'timelines');
const userThemesDir = () => path.join(app.getPath('userData'), 'themes');
const defaultFontsDir = () => path.join(app.getPath('userData'), 'fonts');
const gitSyncRepoDir = () => path.join(app.getPath('userData'), 'git-sync-repo');
const gitSyncStatePath = () => path.join(app.getPath('userData'), 'git-sync-state.json');
const gitSyncCredsPath = () => path.join(app.getPath('userData'), 'git-sync-credentials.json');

const safeName = (value) => String(value || '')
  .trim()
  .replace(/[^\w.-]+/g, '-')
  .replace(/-+/g, '-')
  .replace(/^-+|-+$/g, '')
  .toLowerCase();

const sanitizeId = (value, fallback = '') => safeName(value) || fallback;

const sanitizeTimelinePath = (value) => {
  const parts = String(value || '').split(/[/\\]/);
  const sanitized = parts.map(p => safeName(p)).filter(Boolean);
  return sanitized.length > 0 ? sanitized.join('/') : 'timeline';
};

// Notes/assets folders are keyed by immutable file.uid; older timelines fall back to file.id
const deriveStorageId = (file) => file?.uid || file?.id?.replace(/-timeline$/, '') || null;

// Write via temp file + rename so a crash mid-write can't truncate the target
async function writeFileAtomic(filePath, content) {
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, content, 'utf8');
  await fs.rename(tmpPath, filePath);
}

async function listTimelineFilesRecursive(dir, baseDir) {
  const results = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...await listTimelineFilesRecursive(fullPath, baseDir));
      } else if (entry.isFile() && entry.name.endsWith('.timeline')) {
        const rel = path.relative(baseDir, fullPath).replace(/\\/g, '/');
        results.push({ fullPath, relativeId: rel.replace(/\.timeline$/, '') });
      }
    }
  } catch {}
  return results;
}

const sanitizeNoteFilename = (value) => {
  const base = String(value || '').replace(/\.md$/i, '');
  const cleaned = sanitizeId(base, 'note');
  return `${cleaned}.md`;
};

const resolveNotePath = async (timelineId, notePath) => {
  const notesRootDir = await getNotesRootDir();
  const notesDir = await getNotesDir(timelineId);
  const rawPath = String(notePath || '').trim();
  if (!rawPath) {
    throw new Error('Missing note path');
  }

  const usesRelativePath = rawPath.includes('/') || rawPath.includes('\\');
  const base = usesRelativePath ? notesRootDir : notesDir;
  const relativePath = usesRelativePath ? rawPath : sanitizeNoteFilename(rawPath);

  const resolvedBase = path.resolve(base);
  const resolvedPath = path.resolve(base, relativePath);

  if (resolvedPath === resolvedBase) {
    throw new Error('Invalid note path');
  }

  const relative = path.relative(resolvedBase, resolvedPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Note path outside notes folder');
  }

  return resolvedPath;
};
const readAppSettings = async () => {
  try {
    const content = await fs.readFile(appSettingsPath(), 'utf8');
    return JSON.parse(content);
  } catch (error) {
    return {};
  }
};

async function writeAppSettingsPartial(partial) {
  const filePath = appSettingsPath();
  let existing = {};
  try {
    existing = JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {}
  await writeFileAtomic(filePath, JSON.stringify({ ...existing, ...partial }, null, 2));
}

async function loadGitSyncCredentials() {
  try {
    const raw = JSON.parse(await fs.readFile(gitSyncCredsPath(), 'utf8'));
    if (!raw?.data) return null;
    let json = '';
    if (raw.encrypted) {
      if (!safeStorage.isEncryptionAvailable()) return null;
      json = safeStorage.decryptString(Buffer.from(raw.data, 'base64'));
    } else {
      json = Buffer.from(raw.data, 'base64').toString('utf8');
    }
    return JSON.parse(json);
  } catch {
    return null;
  }
}

async function saveGitSyncCredentials(credentials) {
  const json = JSON.stringify(credentials);
  const payload = safeStorage.isEncryptionAvailable()
    ? {
      encrypted: true,
      data: safeStorage.encryptString(json).toString('base64'),
    }
    : {
      encrypted: false,
      data: Buffer.from(json, 'utf8').toString('base64'),
    };
  await writeFileAtomic(gitSyncCredsPath(), JSON.stringify(payload, null, 2));
}

async function clearGitSyncCredentials() {
  await fs.rm(gitSyncCredsPath(), { force: true });
}

const getTimelinesDir = async () => {
  const settings = await readAppSettings();
  const customDir = settings?.timelineStorageDir ?? settings?.storageDir;
  if (customDir && typeof customDir === 'string') {
    const trimmed = customDir.trim();
    if (trimmed) return trimmed;
  }
  return defaultTimelinesDir();
};

const getNotesRootDir = async () => {
  const settings = await readAppSettings();
  const customDir = settings?.notesStorageDir;
  if (customDir && typeof customDir === 'string') {
    const trimmed = customDir.trim();
    if (trimmed) return trimmed;
  }
  return path.join(await getTimelinesDir(), '.notes');
};

const getNotesDir = async (timelineId) => {
  const baseDir = await getNotesRootDir();
  const safePath = sanitizeTimelinePath(String(timelineId || 'timeline'));
  return path.join(baseDir, ...safePath.split('/'));
};

const getAssetsRootDir = async () => {
  const settings = await readAppSettings();
  const customDir = settings?.assetsStorageDir;
  if (customDir && typeof customDir === 'string') {
    const trimmed = customDir.trim();
    if (trimmed) return trimmed;
  }
  const notesRoot = await getNotesRootDir();
  return path.join(path.dirname(notesRoot), '.assets');
};

const getAssetsDir = async (timelineId) => {
  const baseDir = await getAssetsRootDir();
  const safePath = sanitizeTimelinePath(String(timelineId || 'timeline'));
  return path.join(baseDir, ...safePath.split('/'));
};

const getFontsDir = async () => defaultFontsDir();

async function getStartupBackgroundColor() {
  const fallback = '#FFFAF4';
  try {
    const settings = await readAppSettings();
    const themeKey = settings?.theme || DEFAULT_THEME_KEY;
    const themesDir = userThemesDir();

    if (!fsSync.existsSync(themesDir)) {
      return fallback;
    }

    const filePath = path.join(themesDir, `${sanitizeId(themeKey, '')}.json`);
    if (!fsSync.existsSync(filePath)) {
      return fallback;
    }

    const data = JSON.parse(fsSync.readFileSync(filePath, 'utf8'));
    return data?.colors?.['secondary-bg'] || fallback;
  } catch (error) {
    console.error('Failed to resolve startup theme background:', error);
    return fallback;
  }
}

async function createWindow() {
  const backgroundColor = await getStartupBackgroundColor();

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, '../public/favicon/favicon-light.ico'),
  });

  Menu.setApplicationMenu(null);

  try {
    const raw = fsSync.readFileSync(appSettingsPath(), 'utf8');
    if (JSON.parse(raw)?.startMaximized === true) mainWindow.maximize();
  } catch {}

  const isDev = process.env.NODE_ENV === 'development';

  if (isDev) {
    mainWindow.loadURL('http://localhost:5183');
    mainWindow.webContents.openDevTools();
  } else {
    const debugProd = process.env.TIMELINES_DEBUG === 'true';
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    if (debugProd) {
      mainWindow.webContents.openDevTools();
    }
  }

  // Open all external links in the default browser instead of a new Electron window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const appUrl = mainWindow.webContents.getURL();
    if (url !== appUrl) {
      event.preventDefault();
      shell.openExternal(url).catch((err) => console.error('Failed to open external URL:', err));
    }
  });

  mainWindow.webContents.on('context-menu', (event, params) => {
    if (!params.isEditable) return;
    const menu = Menu.buildFromTemplate([
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { type: 'separator' },
      { role: 'selectAll' },
    ]);
    menu.popup({ window: mainWindow });
  });
}

// Initialize user data directory
async function initializeUserData() {
  const userDataDir = await getTimelinesDir();

  try {
    await fs.mkdir(userDataDir, { recursive: true });
  } catch (error) {
    console.error('Error initializing user data:', error);
  }
}

// Register custom protocol for serving local fonts
protocol.registerSchemesAsPrivileged([
  { scheme: 'local-font', privileges: { bypassCSP: true, supportFetchAPI: true, standard: true } },
  { scheme: 'timelines-asset', privileges: { bypassCSP: true, supportFetchAPI: true, standard: true, secure: true } },
]);

// Auto-updater setup
function setupAutoUpdater() {
  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) return;

  autoUpdater.allowPrerelease = true;
  autoUpdater.autoDownload = false;

  autoUpdater.on('checking-for-update', () => {
    mainWindow?.webContents.send('updater-status', { status: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('updater-status', { status: 'available', version: info.version });
  });

  autoUpdater.on('update-not-available', () => {
    mainWindow?.webContents.send('updater-status', { status: 'not-available' });
  });

  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('updater-status', { status: 'downloading', percent: Math.floor(progress.percent) });
  });

  autoUpdater.on('update-downloaded', (info) => {
    mainWindow?.webContents.send('updater-status', { status: 'downloaded', version: info.version });
  });

  autoUpdater.on('error', (err) => {
    mainWindow?.webContents.send('updater-status', { status: 'error', message: err.message });
  });
}

function setupOsmTileRequestHeaders() {
  const tileFilter = {
    urls: [
      'https://tile.openstreetmap.org/*',
      'https://*.tile.openstreetmap.org/*',
    ],
  };

  session.defaultSession.webRequest.onBeforeSendHeaders(tileFilter, (details, callback) => {
    const requestHeaders = { ...(details.requestHeaders || {}) };
    const appVersion = app.getVersion?.() || 'dev';
    requestHeaders['User-Agent'] = `Timelines/${appVersion} (+https://github.com/sreegjl/timelines)`;

    if (!requestHeaders.Referer && !requestHeaders.referer) {
      const currentUrl = mainWindow?.webContents?.getURL?.() || '';
      try {
        const parsed = new URL(currentUrl);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          requestHeaders.Referer = `${parsed.origin}/`;
        } else {
          requestHeaders.Referer = 'https://github.com/sreegjl/timelines';
        }
      } catch {
        requestHeaders.Referer = 'https://github.com/sreegjl/timelines';
      }
    }

    callback({ requestHeaders });
  });
}

ipcMain.handle('check-for-updates', async () => {
  const isDev = process.env.NODE_ENV === 'development';
  if (isDev) {
    return { status: 'dev' };
  }
  try {
    await autoUpdater.checkForUpdates();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('download-update', async () => {
  try {
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('install-update', () => {
  // Silent install; non-silent would re-open the assisted installer wizard on every update
  autoUpdater.quitAndInstall(true, true);
});

app.whenReady().then(async () => {
  setupOsmTileRequestHeaders();
  protocol.handle('timelines-asset', async (request) => {
    try {
      const url = new URL(request.url);
      const assetsDir = await getAssetsRootDir();
      // New format: timelines-asset://asset?p=<encodedAbsPath>
      // Legacy format: timelines-asset://asset/<encodedAbsPath>
      // On Mac, Chromium's standard-scheme normalization strips the leading %2F (encoded /)
      // from legacy URLs, making the path relative. Detect and restore it.
      const pParam = url.searchParams.get('p');
      let assetPath;
      if (pParam !== null) {
        assetPath = pParam;
      } else {
        assetPath = decodeURIComponent(url.pathname.slice(1));
        if (process.platform !== 'win32' && assetPath && !path.isAbsolute(assetPath)) {
          assetPath = '/' + assetPath;
        }
      }
      const normalizedAssetPath = path.normalize(assetPath);
      const normalizedAssetsDir = path.normalize(assetsDir);
      if (!normalizedAssetPath.startsWith(normalizedAssetsDir + path.sep)) {
        return new Response('Forbidden', { status: 403 });
      }
      const rangeHeader = request.headers.get('Range');
      if (rangeHeader) {
        const stat = await fs.stat(normalizedAssetPath);
        const fileSize = stat.size;
        const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
        if (!match) return new Response('Range Not Satisfiable', { status: 416 });
        const start = match[1] ? parseInt(match[1], 10) : 0;
        const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
        if (start > end || end >= fileSize) return new Response('Range Not Satisfiable', { status: 416 });
        const chunkSize = end - start + 1;
        const fileHandle = await fs.open(normalizedAssetPath, 'r');
        const buffer = Buffer.alloc(chunkSize);
        await fileHandle.read(buffer, 0, chunkSize, start);
        await fileHandle.close();
        return new Response(buffer, {
          status: 206,
          headers: {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': String(chunkSize),
          },
        });
      }
      return net.fetch(pathToFileURL(normalizedAssetPath).toString());
    } catch (error) {
      console.error('Error serving asset:', error);
      return new Response('Not found', { status: 404 });
    }
  });

  // Register protocol handler for local fonts
  protocol.handle('local-font', async (request) => {
    try {
      // URL format: local-font://font/encoded-path
      const url = new URL(request.url);
      const encodedPath = url.pathname.slice(1); // Remove leading /
      const fontPath = decodeURIComponent(encodedPath);

      // Verify the file exists and is in the fonts directory
      const fontsDir = await getFontsDir();
      const normalizedFontPath = path.normalize(fontPath);
      const normalizedFontsDir = path.normalize(fontsDir);

      if (!normalizedFontPath.startsWith(normalizedFontsDir + path.sep)) {
        return new Response('Forbidden', { status: 403 });
      }

      return net.fetch(pathToFileURL(normalizedFontPath).toString());
    } catch (error) {
      console.error('Error serving font:', error);
      return new Response('Not found', { status: 404 });
    }
  });

  await initializeUserData();
  await initGitSync();
  await createWindow();
  setupAutoUpdater();
  gitSync?.startupSync().catch((err) => {
    console.error('git-sync startup failed:', err);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', (event) => {
  if (gitSyncQuitStarted || !gitSync?.isConnected()) return;
  const status = gitSync.getStatus();
  if (status.pendingCount <= 0 || status.state === 'offline' || status.state === 'auth-expired') return;
  gitSyncQuitStarted = true;
  event.preventDefault();
  Promise.race([
    gitSync.syncNow(),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]).finally(() => {
    app.quit();
  });
});

// Window control handlers
ipcMain.on('minimize-window', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('maximize-window', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('close-window', () => {
  if (mainWindow) mainWindow.close();
});

// IPC Handlers for file operations
ipcMain.handle('save-timeline', async (event, { data, filename, create }) => {
  try {
    const dataDir = await getTimelinesDir();
    const safePath = sanitizeTimelinePath(filename);
    const filePath = path.join(dataDir, `${safePath}.timeline`);
    if (create && fsSync.existsSync(filePath)) {
      return { success: false, error: 'EXISTS' };
    }
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const dataToSave = { ...data, elements: await stripThumbnails(data.elements, deriveStorageId(data.file)) };
    await writeFileAtomic(filePath, JSON.stringify(dataToSave, null, 2));
    markGitSyncDirty(deriveStorageId(dataToSave.file));
    return { success: true, message: 'Timeline saved successfully', path: filePath };
  } catch (error) {
    console.error('Error saving timeline:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('list-timelines', async () => {
  try {
    const userDataDir = await getTimelinesDir();
    const files = await listTimelineFilesRecursive(userDataDir, userDataDir);

    const timelines = (await Promise.all(
      files.map(async ({ fullPath, relativeId }) => {
        try {
          const content = await fs.readFile(fullPath);
          // Packages copied into the library folder are listed too; opening
          // one runs the transparent import (see import-timeline)
          const isPackage = isZipBuffer(content);
          const data = isPackage
            ? JSON.parse(readPackage(content).timelineJson)
            : JSON.parse(content.toString('utf8'));
          const stat = await fs.stat(fullPath);
          const parts = relativeId.split('/');
          const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
          return {
            id: relativeId,
            uid: deriveStorageId(data.file),
            name: data.file?.title || parts[parts.length - 1],
            neverSync: Boolean(data.file?.neverSync),
            modifiedAt: stat.mtimeMs,
            eventCount: Array.isArray(data.elements) ? data.elements.length : 0,
            folder,
            ...(isPackage ? { isPackage: true, packagePath: fullPath } : {}),
          };
        } catch (err) {
          console.warn(`Skipping corrupt timeline ${relativeId}:`, err.message);
          return null;
        }
      })
    )).filter(Boolean);

    return timelines;
  } catch (error) {
    console.error('Error listing timelines:', error);
    return [];
  }
});

ipcMain.handle('load-timeline', async (event, filename) => {
  try {
    const userDataDir = await getTimelinesDir();
    const safePath = sanitizeTimelinePath(filename);
    const filePath = path.join(userDataDir, `${safePath}.timeline`);
    const content = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(content);
    if (data.file && !data.file.uid) {
      // One-time migration: stamp the immutable storage uid
      data.file.uid = data.file.id?.replace(/-timeline$/, '') || safePath.split('/').pop();
      await writeFileAtomic(filePath, JSON.stringify(data, null, 2))
        .catch((e) => console.warn('Could not persist timeline uid:', e.message));
    }
    const storageId = deriveStorageId(data.file);
    await healMissingAssets(data.elements, storageId, filePath)
      .catch((e) => console.warn('Asset folder recovery skipped:', e.message));
    const resolvedData = { ...data, elements: await resolveThumbnails(data.elements, storageId) };
    console.log(`Loaded timeline: ${filename}`);
    return resolvedData;
  } catch (error) {
    console.error('Error loading timeline:', error);
    throw error;
  }
});

ipcMain.handle('export-timeline', async (event, { data, suggestedName }) => {
  try {
    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: suggestedName,
      filters: [
        { name: 'Timeline Files', extensions: ['timeline', 'json'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (canceled || !filePath) {
      return { success: false, canceled: true };
    }

    const dataToExport = { ...data, elements: await stripThumbnails(data.elements, deriveStorageId(data.file)) };
    await fs.writeFile(filePath, JSON.stringify(dataToExport, null, 2), 'utf8');

    return {
      success: true,
      path: filePath,
    };
  } catch (error) {
    console.error('Error exporting timeline:', error);
    return {
      success: false,
      error: error.message,
    };
  }
});

// Image/video refs inside note markdown: ![alt](src) tokens and src="..." attributes
function extractNoteImageSrcs(markdown) {
  const srcs = new Set();
  const md = String(markdown || '');
  for (const m of md.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)/g)) srcs.add(m[1]);
  for (const m of md.matchAll(/\bsrc\s*=\s*["']([^"']+)["']/gi)) srcs.add(m[1]);
  return [...srcs];
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const rewriteNoteSrc = (content, oldSrc, newSrc) => content
  .split(`](${oldSrc})`).join(`](${newSrc})`)
  .replace(new RegExp(`(src\\s*=\\s*["'])${escapeRegExp(oldSrc)}(["'])`, 'gi'), `$1${newSrc}$2`);

// Collects a timeline's thumbnails, notes, and note images as zip entries; elements must be in stored-ref form
async function collectPackageFiles(data, storageId) {
  const elementsArr = Array.isArray(data.elements) ? data.elements : [];

  const assetsRoot = await getAssetsRootDir();
  const timelineAssetsDir = storageId ? await getAssetsDir(storageId) : null;

  const files = {}; // zip entry -> Uint8Array
  const skipped = [];

  const buffersEqual = (a, b) => a.length === b.length && Buffer.compare(a, b) === 0;

  const addAssetBytes = (desiredEntry, bytes) => {
    const ext = path.posix.extname(desiredEntry);
    const stem = desiredEntry.slice(0, desiredEntry.length - ext.length);
    let entry = desiredEntry;
    let counter = 1;
    while (files[entry] !== undefined && !buffersEqual(files[entry], bytes)) {
      entry = `${stem}-${counter}${ext}`;
      counter++;
    }
    if (files[entry] === undefined) files[entry] = bytes;
    return entry;
  };

  // Element thumbnails keep their stored refs, so they claim entry names first
  for (const el of elementsArr) {
    const ref = el.thumbnail;
    if (!ref || typeof ref !== 'string' || ref.includes('://')) continue;
    const abs = await findThumbnailFile(ref, assetsRoot, timelineAssetsDir);
    if (!abs) { skipped.push(ref); continue; }
    try {
      files[`assets/${ref.replace(/\\/g, '/')}`] = new Uint8Array(await fs.readFile(abs));
    } catch {
      skipped.push(ref);
    }
  }

  for (const el of elementsArr) {
    if (!el.noteFile || typeof el.noteFile !== 'string') continue;
    let content = null;
    try {
      const notePath = storageId ? await resolveNotePath(storageId, el.noteFile) : null;
      if (notePath) content = await fs.readFile(notePath, 'utf8');
    } catch {}
    if (content === null) { skipped.push(el.noteFile); continue; }

    for (const src of extractNoteImageSrcs(content)) {
      if (src.startsWith('timelines-asset://')) {
        const decoded = decodeAssetUrl(src);
        const normalizedRoot = path.normalize(assetsRoot);
        if (!decoded || !path.normalize(decoded).startsWith(normalizedRoot + path.sep)) {
          skipped.push(src);
          continue;
        }
        let bytes;
        try { bytes = new Uint8Array(await fs.readFile(decoded)); } catch { skipped.push(src); continue; }
        // Absolute asset URLs don't travel; store flat and point the note copy at the bare name
        const entry = addAssetBytes(`assets/${path.basename(decoded)}`, bytes);
        content = rewriteNoteSrc(content, src, entry.slice('assets/'.length));
        continue;
      }
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(src)) continue; // external URL / other scheme
      if (src.includes('/') || src.includes('\\')) continue; // only bare refs resolve in notes
      const abs = await findThumbnailFile(src, assetsRoot, timelineAssetsDir);
      if (!abs) { skipped.push(src); continue; }
      let bytes;
      try { bytes = new Uint8Array(await fs.readFile(abs)); } catch { skipped.push(src); continue; }
      const entry = addAssetBytes(`assets/${src}`, bytes);
      if (entry !== `assets/${src}`) {
        content = rewriteNoteSrc(content, src, entry.slice('assets/'.length));
      }
    }

    const hasSlash = el.noteFile.includes('/') || el.noteFile.includes('\\');
    const noteRef = hasSlash ? el.noteFile.replace(/\\/g, '/') : sanitizeNoteFilename(el.noteFile);
    files[`notes/${noteRef}`] = strToU8(content);
  }

  return { files, skipped };
}

ipcMain.handle('export-timeline-package', async (event, { data, suggestedName }) => {
  try {
    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: suggestedName,
      filters: [
        { name: 'Timeline Package', extensions: ['timeline'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (canceled || !filePath) return { success: false, canceled: true };

    const storageId = deriveStorageId(data.file);
    const dataToExport = { ...data, elements: await stripThumbnails(data.elements, storageId) };
    const { files, skipped } = await collectPackageFiles(dataToExport, storageId);

    const zip = buildPackage(JSON.stringify(dataToExport, null, 2), files);
    await fs.writeFile(filePath, Buffer.from(zip));
    return { success: true, path: filePath, skipped: [...new Set(skipped)] };
  } catch (error) {
    console.error('Error exporting timeline package:', error);
    return { success: false, error: error.message };
  }
});

async function findTimelineByUid(uid) {
  if (!uid) return null;
  const timelinesDir = await getTimelinesDir();
  const files = await listTimelineFilesRecursive(timelinesDir, timelinesDir);
  for (const file of files) {
    try {
      const data = JSON.parse(await fs.readFile(file.fullPath, 'utf8'));
      if (deriveStorageId(data.file) === uid) return file;
    } catch {}
  }
  return null;
}

// Writes bytes (or text) under baseDir/rel, deduping filename collisions with
// different content; returns the relative path actually used
async function writeExtractedFile(baseDir, rel, contents) {
  const bytes = typeof contents === 'string' ? Buffer.from(contents, 'utf8') : Buffer.from(contents);
  const parts = rel.split('/');
  const filename = parts.pop();
  const dir = path.join(baseDir, ...parts);
  await fs.mkdir(dir, { recursive: true });
  const ext = path.extname(filename);
  const stem = path.basename(filename, ext);
  let candidate = filename;
  let counter = 1;
  for (;;) {
    const target = path.join(dir, candidate);
    let existing = null;
    try { existing = await fs.readFile(target); } catch {}
    if (existing === null) {
      await fs.writeFile(target, bytes);
      break;
    }
    if (Buffer.compare(existing, bytes) === 0) break; // identical, reuse
    candidate = `${stem}-${counter}${ext}`;
    counter++;
  }
  return [...parts, candidate].join('/');
}

// Sync-pull update for an existing uid: rewrite the .timeline in place and write assets/notes where the exporter reads them; never deletes stray files
async function overwriteExistingTimeline(data, pkg, existing, opts) {
  const storageId = deriveStorageId(data.file);
  if (pkg) {
    const assetsRoot = await getAssetsRootDir();
    const assetsDir = await getAssetsDir(storageId);
    for (const [rel, bytes] of Object.entries(pkg.assets)) {
      const target = rel.includes('/') ? path.join(assetsRoot, ...rel.split('/')) : path.join(assetsDir, rel);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, Buffer.from(bytes));
    }
    const notesRoot = await getNotesRootDir();
    const notesDir = await getNotesDir(storageId);
    for (const [rel, content] of Object.entries(pkg.notes)) {
      const target = rel.includes('/') ? path.join(notesRoot, ...rel.split('/')) : path.join(notesDir, rel);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, 'utf8');
    }
  }

  const timelinesDir = await getTimelinesDir();
  let relId = existing.relativeId;
  if (opts.preferredRelId) {
    const preferred = sanitizeTimelinePath(opts.preferredRelId);
    // Adopt the mirror's placement unless another file already sits there
    if (preferred !== relId && !fsSync.existsSync(path.join(timelinesDir, `${preferred}.timeline`))) {
      relId = preferred;
    }
  }
  const targetPath = path.join(timelinesDir, `${relId}.timeline`);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await writeFileAtomic(targetPath, JSON.stringify(data, null, 2));
  if (relId !== existing.relativeId) {
    await fs.unlink(existing.fullPath).catch(() => {});
  }
  return { success: true, id: relId, uid: data.file.uid, overwritten: true };
}

// Installs a timeline (JSON or zip) from bytes; opts: sourcePath, resolution (open-existing|copy|overwrite), preferredRelId, titleSuffix. Throws on bad input.
async function installTimelineFromBuffer(buf, opts = {}) {
  const { sourcePath = null, resolution = null } = opts;
  let pkg = null;
  let data;
  if (isZipBuffer(buf)) {
    pkg = readPackage(buf);
    data = JSON.parse(pkg.timelineJson);
  } else {
    data = JSON.parse(Buffer.from(buf).toString('utf8'));
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.elements)) {
    return { success: false, error: 'Not a valid timeline file' };
  }

  data.file = data.file && typeof data.file === 'object' ? data.file : {};
  if (!data.file.uid) {
    data.file.uid = data.file.id?.replace(/-timeline$/, '')
      || (sourcePath ? safeName(path.basename(sourcePath).replace(/\.(timeline|json)$/i, '')) : '')
      || `timeline-${Date.now()}`;
  }

  const existing = await findTimelineByUid(data.file.uid);
  if (existing) {
    if (resolution === 'open-existing') {
      return { success: true, openedExisting: true, id: existing.relativeId };
    }
    if (resolution === 'overwrite') {
      return overwriteExistingTimeline(data, pkg, existing, opts);
    }
    if (resolution === 'copy') {
      let candidate;
      let counter = 1;
      do {
        candidate = `${data.file.uid}-copy${counter > 1 ? `-${counter}` : ''}`;
        counter++;
      } while (await findTimelineByUid(candidate));
      data.file.uid = candidate;
      if (data.file.title) data.file.title = `${data.file.title}${opts.titleSuffix ?? ' (Copy)'}`;
    } else {
      return {
        success: false,
        conflict: true,
        sourcePath,
        existingId: existing.relativeId,
        title: data.file.title || existing.relativeId,
      };
    }
  }

  const storageId = data.file.uid;
  const skipped = [];

  if (pkg) {
    // Assets first, tracking collision renames so refs can follow
    const assetsDir = await getAssetsDir(storageId);
    const assetRenames = new Map();
    for (const [rel, bytes] of Object.entries(pkg.assets)) {
      try {
        const written = await writeExtractedFile(assetsDir, rel, bytes);
        if (written !== rel) assetRenames.set(rel, written);
      } catch {
        skipped.push(rel);
      }
    }
    if (assetRenames.size > 0) {
      data.elements = data.elements.map((el) => {
        if (!el.thumbnail || typeof el.thumbnail !== 'string') return el;
        const ref = el.thumbnail.replace(/\\/g, '/');
        return assetRenames.has(ref) ? { ...el, thumbnail: assetRenames.get(ref) } : el;
      });
    }

    const notesDir = await getNotesDir(storageId);
    const noteRenames = new Map();
    for (const [rel, rawContent] of Object.entries(pkg.notes)) {
      let content = rawContent;
      for (const [oldRef, newRef] of assetRenames) {
        content = rewriteNoteSrc(content, oldRef, newRef);
      }
      try {
        const written = await writeExtractedFile(notesDir, rel, content);
        if (written !== rel) noteRenames.set(rel, written);
      } catch {
        skipped.push(rel);
      }
    }
    data.elements = data.elements.map((el) => {
      if (!el.noteFile || typeof el.noteFile !== 'string') return el;
      const hasSlash = el.noteFile.includes('/') || el.noteFile.includes('\\');
      let ref = hasSlash ? el.noteFile.replace(/\\/g, '/') : sanitizeNoteFilename(el.noteFile);
      if (noteRenames.has(ref)) ref = noteRenames.get(ref);
      // Slash refs resolve against the notes root, so anchor them to this timeline's folder
      if (ref.includes('/')) ref = `${sanitizeTimelinePath(storageId)}/${ref}`;
      return ref === el.noteFile ? el : { ...el, noteFile: ref };
    });
  }

  const timelinesDir = await getTimelinesDir();
  await fs.mkdir(timelinesDir, { recursive: true });

  // A package sitting inside the library folder is converted in place (the bare timeline replaces the zip)
  const samePath = (a, b) => process.platform === 'win32'
    ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
    : path.resolve(a) === path.resolve(b);
  let sourceInLibrary = false;
  let folderPrefix = '';
  if (sourcePath) {
    const sourceRel = path.relative(path.resolve(timelinesDir), path.resolve(sourcePath));
    sourceInLibrary = Boolean(pkg)
      && /\.timeline$/i.test(sourcePath)
      && !sourceRel.startsWith('..')
      && !path.isAbsolute(sourceRel);
    // Keep a library package's folder placement when converting it
    const sourceFolder = sourceInLibrary ? path.dirname(sourceRel.replace(/\\/g, '/')) : '';
    folderPrefix = sourceFolder && sourceFolder !== '.' ? `${sanitizeTimelinePath(sourceFolder)}/` : '';
  }

  const baseName = safeName(data.file.title) || sanitizeId(storageId, 'timeline');
  const desiredRelId = opts.preferredRelId ? sanitizeTimelinePath(opts.preferredRelId) : `${folderPrefix}${baseName}`;
  let relId = desiredRelId;
  let counter = 1;
  let targetPath = path.join(timelinesDir, `${relId}.timeline`);
  // The source zip's own name is free to reuse; writing there replaces it
  while (fsSync.existsSync(targetPath) && !(sourceInLibrary && samePath(targetPath, sourcePath))) {
    relId = `${desiredRelId}-${counter}`;
    counter++;
    targetPath = path.join(timelinesDir, `${relId}.timeline`);
  }
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, JSON.stringify(data, null, 2), 'utf8');
  if (sourceInLibrary && !samePath(targetPath, sourcePath)) {
    await fs.unlink(sourcePath).catch((e) => console.warn('Could not remove imported package:', e.message));
  }

  return { success: true, id: relId, uid: data.file.uid, imported: true, skipped: [...new Set(skipped)] };
}

async function listGitSyncTimelines() {
  const timelinesDir = await getTimelinesDir();
  const files = await listTimelineFilesRecursive(timelinesDir, timelinesDir);
  const timelines = [];
  for (const { fullPath, relativeId } of files) {
    let raw;
    try {
      raw = await fs.readFile(fullPath);
    } catch {
      continue;
    }
    if (isZipBuffer(raw)) continue;
    try {
      const data = JSON.parse(raw.toString('utf8'));
      const uid = deriveStorageId(data.file) || relativeId.split('/').pop();
      timelines.push({
        uid,
        relativeId,
        neverSync: Boolean(data.file?.neverSync),
      });
    } catch {
      // Corrupt timelines are already skipped elsewhere; sync ignores them too
    }
  }
  return timelines;
}

async function buildGitSyncPackageForTimeline(timeline) {
  if (!timeline?.relativeId) throw new Error('Missing timeline relativeId');
  const timelinesDir = await getTimelinesDir();
  const filePath = path.join(timelinesDir, ...`${timeline.relativeId}.timeline`.split('/'));
  const raw = await fs.readFile(filePath);
  if (isZipBuffer(raw)) {
    throw new Error('Packaged timelines inside the library are not syncable');
  }
  const data = JSON.parse(raw.toString('utf8'));
  if (!data.file?.uid) {
    data.file = { ...(data.file || {}), uid: deriveStorageId(data.file) || timeline.uid };
  }
  const storageId = deriveStorageId(data.file);
  const { files } = await collectPackageFiles(data, storageId);
  return buildPackage(JSON.stringify(data, null, 2), files, { deterministic: true });
}

async function removeGitSyncTimeline(uid) {
  const existing = await findTimelineByUid(uid);
  if (!existing) return { success: true };
  await fs.unlink(existing.fullPath).catch((err) => {
    if (err.code !== 'ENOENT') throw err;
  });
  return { success: true };
}

async function initGitSync() {
  const settings = await readAppSettings();
  gitSync = createEngine({
    repoDir: gitSyncRepoDir(),
    statePath: gitSyncStatePath(),
    listTimelines: listGitSyncTimelines,
    buildPackageForTimeline: buildGitSyncPackageForTimeline,
    importPackage: installTimelineFromBuffer,
    removeLocalTimeline: removeGitSyncTimeline,
    loadCredentials: loadGitSyncCredentials,
    saveCredentials: saveGitSyncCredentials,
    clearCredentials: clearGitSyncCredentials,
    machineLabel: settings?.gitSyncMachineLabel,
    autoSync: settings?.gitSyncAutoSync !== false,
    debounceMs: Math.max(30_000, (Number(settings?.gitSyncIntervalMinutes) || 5) * 60_000),
    onStatus: (status) => {
      mainWindow?.webContents?.send('git-sync-state-changed', status);
    },
    onApplied: (ids) => {
      mainWindow?.webContents?.send('git-sync-applied', ids);
    },
  });
  await gitSync.init();
}

function requireGitSync() {
  if (!gitSync) {
    throw new Error('Git sync is not initialized');
  }
  return gitSync;
}

function markGitSyncDirty(uid) {
  gitSync?.markDirty(uid);
}

function markGitSyncStructureDirty() {
  gitSync?.markStructureDirty();
}

ipcMain.handle('import-timeline', async (event, payload) => {
  try {
    const resolution = payload?.resolution || null; // null | 'open-existing' | 'copy'
    let sourcePath = payload?.sourcePath || null;
    if (!sourcePath) {
      const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [
          { name: 'Timeline Files', extensions: ['timeline', 'json'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
      if (canceled || filePaths.length === 0) {
        return { success: false, canceled: true };
      }
      sourcePath = filePaths[0];
    }

    const buf = await fs.readFile(sourcePath);
    const result = await installTimelineFromBuffer(buf, { sourcePath, resolution });
    if (result?.success && !result?.openedExisting) {
      markGitSyncStructureDirty();
    }
    return result;
  } catch (error) {
    console.error('Error importing timeline:', error);
    return {
      success: false,
      error: error.message,
    };
  }
});

ipcMain.handle('delete-timeline', async (event, payload) => {
  try {
    const request = payload && typeof payload === 'object' ? payload : { id: payload };
    const deleteNotes = Boolean(request.deleteNotes);
    const deleteAssets = Boolean(request.deleteAssets);
    const filename = request.id ?? request.filename ?? request.timelineId;
    const userDataDir = await getTimelinesDir();
    const safePath = sanitizeTimelinePath(filename);
    const filePath = path.join(userDataDir, `${safePath}.timeline`);

    // Storage key can differ from the filename, so read it before deleting the file
    let storageId = safePath.split('/').pop();
    try {
      const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
      const idFromFile = deriveStorageId(data.file);
      if (idFromFile) storageId = idFromFile;
    } catch {}

    await fs.unlink(filePath);
    console.log(`Deleted timeline: ${filename}`);
    markGitSyncStructureDirty();

    // Remove folder if now empty
    const dir = path.dirname(filePath);
    if (dir !== userDataDir) {
      const remaining = await fs.readdir(dir).catch(() => ['x']);
      if (remaining.length === 0) await fs.rmdir(dir).catch(() => {});
    }

    if (deleteNotes || deleteAssets) {
      // Legacy title-derived uids can collide; never wipe storage another timeline still uses
      const otherOwner = await findTimelineByUid(storageId);
      if (otherOwner) {
        console.warn(`Skipped deleting shared storage "${storageId}" still used by ${otherOwner.relativeId}`);
        return { success: true, sharedStorage: true };
      }
    }
    if (deleteNotes) {
      const notesDir = await getNotesDir(storageId);
      await fs.rm(notesDir, { recursive: true, force: true });
    }
    if (deleteAssets) {
      const assetsDir = await getAssetsDir(storageId);
      await fs.rm(assetsDir, { recursive: true, force: true });
    }

    return { success: true };
  } catch (error) {
    console.error('Error deleting timeline:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('rename-folder', async (event, { folderPath, newName }) => {
  try {
    const baseDir = await getTimelinesDir();
    const safeOld = sanitizeTimelinePath(folderPath);
    const parts = safeOld.split('/');
    parts[parts.length - 1] = safeName(newName);
    const safeNew = parts.join('/');
    if (safeOld === safeNew) return { success: true, newPath: safeNew };
    await fs.rename(path.join(baseDir, safeOld), path.join(baseDir, safeNew));
    markGitSyncStructureDirty();
    return { success: true, newPath: safeNew };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('update-timeline-title', async (event, { id, title }) => {
  try {
    const baseDir = await getTimelinesDir();
    const safePath = sanitizeTimelinePath(id);
    const parts = safePath.split('/');
    const folderPrefix = parts.length > 1 ? `${parts.slice(0, -1).join('/')}/` : '';
    const nextBaseName = safeName(title);
    if (!nextBaseName) return { success: false, error: 'INVALID_TITLE' };

    const nextPath = `${folderPrefix}${nextBaseName}`;
    const filePath = path.join(baseDir, `${safePath}.timeline`);
    const nextFilePath = path.join(baseDir, `${nextPath}.timeline`);
    const content = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(content);

    data.file = {
      ...data.file,
      title,
      id: `${nextBaseName}-timeline`,
    };

    if (safePath === nextPath) {
      await writeFileAtomic(filePath, JSON.stringify(data, null, 2));
      markGitSyncDirty(deriveStorageId(data.file));
      return { success: true, oldId: safePath, newId: nextPath, title, fileId: data.file.id };
    }

    if (fsSync.existsSync(nextFilePath)) return { success: false, error: 'EXISTS' };

    await fs.mkdir(path.dirname(nextFilePath), { recursive: true });
    await fs.rename(filePath, nextFilePath);
    await writeFileAtomic(nextFilePath, JSON.stringify(data, null, 2));
    markGitSyncStructureDirty();
    return { success: true, oldId: safePath, newId: nextPath, title, fileId: data.file.id };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Toggle the in-file "never sync" flag; enabling only stops future syncs (already-pushed data stays)
ipcMain.handle('set-timeline-never-sync', async (event, payload) => {
  try {
    const id = payload?.id;
    const neverSync = Boolean(payload?.neverSync);
    if (!id) return { success: false, error: 'Missing timeline id' };
    const baseDir = await getTimelinesDir();
    const safePath = sanitizeTimelinePath(id);
    const filePath = path.join(baseDir, `${safePath}.timeline`);
    const raw = await fs.readFile(filePath);
    if (isZipBuffer(raw)) return { success: false, error: 'Packaged timelines cannot be flagged' };
    const data = JSON.parse(raw.toString('utf8'));
    data.file = { ...(data.file || {}), neverSync };
    await writeFileAtomic(filePath, JSON.stringify(data, null, 2));
    markGitSyncStructureDirty();
    return { success: true, id: safePath, neverSync };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-folder', async (event, { folderPath }) => {
  try {
    const baseDir = await getTimelinesDir();
    const safe = sanitizeTimelinePath(folderPath);
    await fs.rm(path.join(baseDir, safe), { recursive: true, force: true });
    markGitSyncStructureDirty();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('move-folder', async (event, { folderPath, targetFolder }) => {
  try {
    const baseDir = await getTimelinesDir();
    const safeSrc = sanitizeTimelinePath(folderPath);
    const folderName = safeSrc.split('/').pop();
    const safeDest = targetFolder
      ? `${sanitizeTimelinePath(targetFolder)}/${folderName}`
      : folderName;
    if (safeSrc === safeDest) return { success: true };
    // Prevent moving into own subtree
    if (safeDest.startsWith(safeSrc + '/')) return { success: false, error: 'Cannot move folder into itself' };
    await fs.mkdir(path.join(baseDir, path.dirname(safeDest)), { recursive: true });
    await fs.rename(path.join(baseDir, safeSrc), path.join(baseDir, safeDest));
    markGitSyncStructureDirty();
    return { success: true, newPath: safeDest };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('create-folder', async (event, { folderName, parentFolder }) => {
  try {
    const baseDir = await getTimelinesDir();
    const safeFolderName = parentFolder
      ? `${sanitizeTimelinePath(parentFolder)}/${safeName(folderName)}`
      : sanitizeTimelinePath(folderName);
    if (!safeFolderName) return { success: false, error: 'Invalid folder name' };
    await fs.mkdir(path.join(baseDir, safeFolderName), { recursive: true });
    markGitSyncStructureDirty();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('list-folders', async () => {
  try {
    const baseDir = await getTimelinesDir();
    const folders = [];
    const scan = async (dir, prefix) => {
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const name = prefix ? `${prefix}/${entry.name}` : entry.name;
          folders.push(name);
          await scan(path.join(dir, entry.name), name);
        }
      }
    };
    await scan(baseDir, '');
    return folders;
  } catch {
    return [];
  }
});

ipcMain.handle('move-timeline', async (event, { id, targetFolder }) => {
  try {
    const baseDir = await getTimelinesDir();
    const safePath = sanitizeTimelinePath(id);
    const filename = safePath.split('/').pop();
    const safeTarget = targetFolder ? sanitizeTimelinePath(targetFolder) : '';
    const newRelId = safeTarget ? `${safeTarget}/${filename}` : filename;
    const oldFile = path.join(baseDir, `${safePath}.timeline`);
    const newFile = path.join(baseDir, `${newRelId}.timeline`);
    if (oldFile === newFile) return { success: true, newId: newRelId };
    await fs.mkdir(path.dirname(newFile), { recursive: true });
    await fs.rename(oldFile, newFile);
    const oldDir = path.dirname(oldFile);
    if (oldDir !== baseDir) {
      const remaining = await fs.readdir(oldDir).catch(() => ['x']);
      if (remaining.length === 0) await fs.rmdir(oldDir).catch(() => {});
    }
    const notesBase = await getNotesRootDir();
    const oldNotesPath = path.join(notesBase, ...sanitizeTimelinePath(safePath).split('/'));
    const newNotesPath = path.join(notesBase, ...sanitizeTimelinePath(newRelId).split('/'));
    if (oldNotesPath !== newNotesPath) {
      await fs.rename(oldNotesPath, newNotesPath).catch(e => { if (e.code !== 'ENOENT') throw e; });
    }
    markGitSyncStructureDirty();
    return { success: true, newId: newRelId };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('create-note', async (event, { timelineId, title, elementId }) => {
  try {
    if (!timelineId) {
      return { success: false, error: 'Missing timelineId' };
    }

    const notesDir = await getNotesDir(timelineId);
    await fs.mkdir(notesDir, { recursive: true });

    const base = safeName(elementId) || safeName(title) || 'note';
    const filename = sanitizeNoteFilename(base);
    const filePath = path.join(notesDir, filename);

    try {
      await fs.access(filePath);
    } catch (err) {
      const heading = title ? `# ${title}\n\n` : '';
      await fs.writeFile(filePath, heading, 'utf8');
    }
    markGitSyncDirty(timelineId);
    return { success: true, filename };
  } catch (error) {
    console.error('Error creating note:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('add-existing-note', async (event, { timelineId } = {}) => {
  try {
    if (!timelineId) {
      return { success: false, error: 'Missing timelineId' };
    }

    const notesDir = await getNotesDir(timelineId);
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Markdown', extensions: ['md'] }],
      defaultPath: notesDir,
    });

    if (result.canceled || !result.filePaths?.length) {
      return { success: false, cancelled: true };
    }

    const sourcePath = result.filePaths[0];
    const baseDir = await getNotesRootDir();
    const resolvedBase = path.resolve(baseDir);
    const resolvedSource = path.resolve(sourcePath);
    const relative = path.relative(resolvedBase, resolvedSource);

    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return { success: false, error: 'OUTSIDE_NOTES_DIR' };
    }

    const normalizedRelative = relative.split(path.sep).join('/');
    const content = await fs.readFile(sourcePath, 'utf8');
    markGitSyncDirty(timelineId);
    return { success: true, filename: normalizedRelative, content };
  } catch (error) {
    console.error('Error adding existing note:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('fetch-wikipedia', async (event, { url }) => {
  try {
    if (!url || typeof url !== 'string') {
      return { success: false, error: 'Missing URL' };
    }
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      return { success: false, error: 'Only HTTPS URLs are allowed' };
    }
    const hostname = parsed.hostname.toLowerCase();
    if (
      /^\d+\.\d+\.\d+\.\d+$/.test(hostname) ||
      /^\[.*\]$/.test(hostname) ||
      hostname === 'localhost' ||
      /^127\./.test(hostname) ||
      /^10\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^169\.254\./.test(hostname) ||
      hostname === '::1' ||
      hostname === '0.0.0.0'
    ) {
      return { success: false, error: 'Private or local URLs are not allowed' };
    }
    const response = await net.fetch(url, {
      headers: { 'User-Agent': 'Timelines/0.6.0-alpha.2 (https://timelines.studio)' },
    });
    if (!response.ok) {
      return { success: false, error: `Request returned ${response.status}` };
    }
    const html = await response.text();
    return { success: true, html };
  } catch (error) {
    console.error('Error fetching wiki:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('read-note', async (event, { timelineId, filename }) => {
  try {
    if (!timelineId || !filename) {
      return { success: false, error: 'Missing timelineId or filename' };
    }
    const filePath = await resolveNotePath(timelineId, filename);
    const content = await fs.readFile(filePath, 'utf8');
    return { success: true, content };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { success: false, error: 'NOT_FOUND' };
    }
    console.error('Error reading note:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('write-note', async (event, { timelineId, filename, content }) => {
  try {
    if (!timelineId || !filename) {
      return { success: false, error: 'Missing timelineId or filename' };
    }
    const filePath = await resolveNotePath(timelineId, filename);
    // Slash refs resolve against the notes root, so mkdir the actual target folder
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await writeFileAtomic(filePath, content ?? '');
    markGitSyncDirty(timelineId);
    return { success: true };
  } catch (error) {
    console.error('Error writing note:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('rename-note', async (event, { timelineId, oldFilename, newFilename }) => {
  try {
    if (!timelineId || !oldFilename || !newFilename) {
      return { success: false, error: 'Missing timelineId or filenames' };
    }
    const oldPath = await resolveNotePath(timelineId, oldFilename);
    const nextPath = await resolveNotePath(timelineId, newFilename);
    if (oldPath === nextPath) return { success: true };
    // Case-only renames on Windows point at the same file and are safe to pass through
    const samePath = process.platform === 'win32' && oldPath.toLowerCase() === nextPath.toLowerCase();
    // fs.rename silently replaces the destination, so refuse instead of destroying another note
    if (!samePath && fsSync.existsSync(nextPath)) return { success: false, error: 'EXISTS' };
    await fs.mkdir(path.dirname(nextPath), { recursive: true });
    try {
      await fs.rename(oldPath, nextPath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return { success: false, error: 'Note file not found' };
      }
      throw error;
    }
    markGitSyncDirty(timelineId);
    return { success: true };
  } catch (error) {
    console.error('Error renaming note:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('rename-timeline', async (event, { oldId, newId }) => {
  try {
    if (!oldId || !newId) return { success: false, error: 'Missing timeline ids' };
    const timelinesDir = await getTimelinesDir();
    const safeOldPath = sanitizeTimelinePath(oldId);
    const safeNewPath = sanitizeTimelinePath(newId);
    if (safeOldPath === safeNewPath) return { success: true };
    const oldFilePath = path.join(timelinesDir, `${safeOldPath}.timeline`);
    const newFilePath = path.join(timelinesDir, `${safeNewPath}.timeline`);
    // fs.rename silently replaces the destination, so refuse instead of destroying another timeline
    if (fsSync.existsSync(newFilePath)) return { success: false, error: 'EXISTS' };

    await fs.mkdir(path.dirname(newFilePath), { recursive: true });
    await fs.rename(oldFilePath, newFilePath).catch(e => { if (e.code !== 'ENOENT') throw e; });

    // Storage folders are keyed by immutable file.uid, so they don't move on rename
    markGitSyncStructureDirty();
    return { success: true };
  } catch (error) {
    console.error('Error renaming timeline:', error);
    return { success: false, error: error.message };
  }
});
ipcMain.handle('delete-note', async (event, { timelineId, filename }) => {
  try {
    if (!timelineId || !filename) {
      return { success: false, error: 'Missing timelineId or filename' };
    }
    const filePath = await resolveNotePath(timelineId, filename);
    await fs.unlink(filePath);
    markGitSyncDirty(timelineId);
    return { success: true };
  } catch (error) {
    console.error('Error deleting note:', error);
    return { success: false, error: error.message };
  }
});

// App settings (stored in user data)
ipcMain.handle('get-app-settings', async () => {
  try {
    const filePath = appSettingsPath();
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {};
    }
    console.error('Error loading app settings:', error);
    return {};
  }
});

const ALLOWED_SETTINGS_KEYS = new Set([
  'timelineStorageDir', 'storageDir', 'notesStorageDir',
  'themeKey',
  'theme', 'notesSubfolder', 'notesSubfolderEnabled',
  'appFontFamily', 'appFontSize', 'keybinds', 'hardwareAcceleration', 'startMaximized', 'assetsStorageDir', 'homeSortMode', 'homeSidebarWidth',
  'gitSyncAutoSync', 'gitSyncIntervalMinutes', 'gitSyncMachineLabel',
]);

ipcMain.handle('set-app-settings', async (event, settings) => {
  try {
    if (!settings || typeof settings !== 'object') {
      return { success: false, error: 'Invalid settings' };
    }
    const filePath = appSettingsPath();
    let existing = {};
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      existing = JSON.parse(raw);
    } catch { /* first run or corrupt file — start fresh */ }
    const merged = { ...existing };
    for (const key of Object.keys(settings)) {
      if (ALLOWED_SETTINGS_KEYS.has(key)) {
        merged[key] = settings[key];
      }
    }
    await writeFileAtomic(filePath, JSON.stringify(merged, null, 2));
    return { success: true };
  } catch (error) {
    console.error('Error saving app settings:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('git-sync-connect', async (event, payload) => {
  try {
    const remoteUrl = String(payload?.remoteUrl || payload?.url || '').trim();
    const branch = String(payload?.branch || 'main').trim() || 'main';
    const token = String(payload?.token || '').trim();
    const username = String(payload?.username || 'x-access-token').trim() || 'x-access-token';
    if (!remoteUrl) {
      return { success: false, error: 'Missing repository URL' };
    }
    if (/^(ssh:\/\/|git@)/i.test(remoteUrl)) {
      return { success: false, error: 'This build currently supports HTTPS remotes with a personal access token. Use an https:// clone URL.' };
    }
    if (!token) {
      return { success: false, error: 'Missing personal access token' };
    }
    const engine = requireGitSync();
    await engine.updateCredentials({ token, username });
    return { success: true, status: await engine.connect({ url: remoteUrl, branch }) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('git-sync-update-credentials', async (event, payload) => {
  try {
    const token = String(payload?.token || '').trim();
    const username = String(payload?.username || 'x-access-token').trim() || 'x-access-token';
    if (!token) {
      return { success: false, error: 'Missing personal access token' };
    }
    return {
      success: true,
      status: await requireGitSync().updateCredentials({ token, username }),
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('git-sync-now', async () => {
  try {
    return { success: true, status: await requireGitSync().syncNow() };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('git-sync-status', async () => {
  try {
    return { success: true, status: requireGitSync().getStatus() };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('git-sync-update-settings', async (event, payload) => {
  try {
    const intervalMinutes = Math.max(1, Number(payload?.intervalMinutes) || 5);
    const autoSync = payload?.autoSync !== false;
    const machineLabel = String(payload?.machineLabel || '').trim();
    await writeAppSettingsPartial({
      gitSyncAutoSync: autoSync,
      gitSyncIntervalMinutes: intervalMinutes,
      ...(machineLabel ? { gitSyncMachineLabel: machineLabel } : {}),
    });
    const status = await requireGitSync().updateSettings({
      autoSync,
      debounceMs: intervalMinutes * 60_000,
      machineLabel: machineLabel || undefined,
      excludedPaths: payload?.excludedPaths,
      writeReadme: payload?.writeReadme,
    });
    return { success: true, status };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('git-sync-rebuild', async () => {
  try {
    return { success: true, status: await requireGitSync().rebuildMirror() };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('git-sync-mirror-size', async () => {
  try {
    return { success: true, bytes: await requireGitSync().mirrorSize() };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('git-sync-disconnect', async (event, payload) => {
  try {
    await requireGitSync().disconnect({ deleteMirror: Boolean(payload?.deleteMirror) });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('git-sync-share-info', async (event, payload) => {
  try {
    const uid = String(payload?.uid || '').trim();
    if (!uid) return { success: false, error: 'Missing timeline uid' };
    return { success: true, info: await requireGitSync().shareInfo(uid) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('git-sync-file-history', async (event, payload) => {
  try {
    const uid = String(payload?.uid || '').trim();
    if (!uid) return { success: false, error: 'Missing timeline uid' };
    return { success: true, history: await requireGitSync().fileHistory(uid) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('git-sync-restore-version', async (event, payload) => {
  try {
    const uid = String(payload?.uid || '').trim();
    const commitOid = String(payload?.commitOid || payload?.oid || '').trim();
    if (!uid || !commitOid) {
      return { success: false, error: 'Missing timeline uid or commit SHA' };
    }
    return { success: true, result: await requireGitSync().restoreVersion(uid, commitOid) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('choose-timelines-dir', async () => {
  try {
    const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
    });

    if (canceled || filePaths.length === 0) {
      return { success: false, canceled: true };
    }

    return { success: true, path: filePaths[0] };
  } catch (error) {
    console.error('Error choosing timelines directory:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('choose-notes-dir', async () => {
  try {
    const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
    });

    if (canceled || filePaths.length === 0) {
      return { success: false, canceled: true };
    }

    return { success: true, path: filePaths[0] };
  } catch (error) {
    console.error('Error choosing notes directory:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('choose-plugins-dir', async () => {
  try {
    const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
    });

    if (canceled || filePaths.length === 0) {
      return { success: false, canceled: true };
    }

    return { success: true, path: filePaths[0] };
  } catch (error) {
    console.error('Error choosing plugins directory:', error);
    return { success: false, error: error.message };
  }
});

const pluginsRootDir = () => path.join(app.getPath('userData'), 'plugins');

ipcMain.handle('open-plugins-folder', async (event, payload) => {
  try {
    const root = path.resolve(pluginsRootDir());
    const dir = payload?.path ? path.resolve(payload.path) : root;
    const relative = path.relative(root, dir);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return { success: false, error: 'PATH_OUTSIDE_PLUGINS_ROOT' };
    }
    await fs.mkdir(dir, { recursive: true });
    await shell.openPath(dir);
    return { success: true, path: dir };
  } catch (error) {
    console.error('Error opening plugins folder:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('list-plugins', async (event, payload) => {
  try {
    const root = path.resolve(pluginsRootDir());
    const dir = payload?.path ? path.resolve(payload.path) : root;
    const relative = path.relative(root, dir);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return { success: false, error: 'PATH_OUTSIDE_PLUGINS_ROOT', plugins: [] };
    }
    await fs.mkdir(dir, { recursive: true });
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const plugins = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pluginDir = path.join(dir, entry.name);
      const manifestPath = path.join(pluginDir, 'manifest.json');
      try {
        const raw = await fs.readFile(manifestPath, 'utf8');
        const manifest = JSON.parse(raw);
        if (!manifest?.id || !manifest?.name) continue;
        const mainFile = manifest.main || 'main.js';
        const entryPath = path.join(pluginDir, mainFile);
        plugins.push({
          id: manifest.id,
          name: manifest.name,
          version: manifest.version || '0.0.0',
          description: manifest.description || '',
          main: mainFile,
          dir: pluginDir,
          entryPath,
        });
      } catch (error) {
        console.warn('Failed to load plugin manifest:', manifestPath, error.message);
      }
    }

    return { success: true, root: dir, plugins };
  } catch (error) {
    console.error('Error listing plugins:', error);
    return { success: false, error: error.message, plugins: [] };
  }
});

ipcMain.handle('read-plugin-module', async (event, payload) => {
  try {
    const entryPath = String(payload?.entryPath || '');
    if (!entryPath) {
      return { success: false, error: 'MISSING_ENTRY_PATH' };
    }

    const root = path.resolve(pluginsRootDir());
    const resolved = path.resolve(entryPath);
    const relative = path.relative(root, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return { success: false, error: 'PLUGIN_PATH_OUTSIDE_ROOT' };
    }

    const code = await fs.readFile(resolved, 'utf8');
    return { success: true, code, entryPath: resolved };
  } catch (error) {
    console.error('Error reading plugin module:', error);
    return { success: false, error: error.message };
  }
});


ipcMain.handle('relaunch-app', () => {
  app.relaunch();
  app.exit(0);
});

ipcMain.handle('open-timelines-folder', async () => {
  try {
    const dir = await getTimelinesDir();
    await fs.mkdir(dir, { recursive: true });
    await shell.openPath(dir);
    return { success: true, path: dir };
  } catch (error) {
    console.error('Error opening timelines folder:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('choose-assets-dir', async () => {
  try {
    const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'createDirectory'],
    });
    if (canceled || filePaths.length === 0) return { success: false, canceled: true };
    return { success: true, path: filePaths[0] };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('open-assets-folder', async () => {
  try {
    const dir = await getAssetsRootDir();
    await fs.mkdir(dir, { recursive: true });
    await shell.openPath(dir);
    return { success: true, path: dir };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('open-notes-folder', async () => {
  try {
    const dir = await getNotesRootDir();
    await fs.mkdir(dir, { recursive: true });
    await shell.openPath(dir);
    return { success: true, path: dir };
  } catch (error) {
    console.error('Error opening notes folder:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('open-themes-folder', async () => {
  try {
    const dir = userThemesDir();
    await fs.mkdir(dir, { recursive: true });
    await shell.openPath(dir);
    return { success: true, path: dir };
  } catch (error) {
    console.error('Error opening themes folder:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('open-fonts-folder', async () => {
  try {
    const dir = await getFontsDir();
    await fs.mkdir(dir, { recursive: true });
    await shell.openPath(dir);
    return { success: true, path: dir };
  } catch (error) {
    console.error('Error opening fonts folder:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('open-external', async (event, { url }) => {
  try {
    if (!url || typeof url !== 'string') {
      return { success: false, error: 'Missing url' };
    }
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { success: false, error: 'Only HTTP/HTTPS URLs are allowed' };
    }
    await shell.openExternal(url);
    return { success: true };
  } catch (error) {
    console.error('Error opening external url:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-notes-base-dir', async () => {
  try {
    const dir = await getNotesRootDir();
    const fileUrl = pathToFileURL(dir).toString();
    return { success: true, path: dir, fileUrl };
  } catch (error) {
    console.error('Error resolving notes base dir:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-assets-base-dir', async () => {
  try {
    const dir = await getAssetsRootDir();
    const fileUrl = pathToFileURL(dir).toString();
    return { success: true, path: dir, fileUrl };
  } catch (error) {
    console.error('Error resolving assets base dir:', error);
    return { success: false, error: error.message };
  }
});

const toAssetUrl = (absPath) => `timelines-asset://asset?p=${encodeURIComponent(path.normalize(absPath))}`;

const toPosixRelative = (from, to) => {
  const rel = path.relative(from, path.normalize(to));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
};

// Absolute path encoded in a timelines-asset:// URL, or null
const decodeAssetUrl = (value) => {
  try {
    const url = new URL(value);
    const p = url.searchParams.get('p');
    let assetPath = p !== null ? p : decodeURIComponent(url.pathname.slice(1));
    if (process.platform !== 'win32' && assetPath && !path.isAbsolute(assetPath)) {
      assetPath = '/' + assetPath;
    }
    return assetPath;
  } catch { return null; }
};

// Storage ref for a thumbnail: bare filename (in the timeline's assets folder)
// or slash path (relative to the assets root)
function extractThumbnailRef(thumbnail, assetsRoot, timelineAssetsDir) {
  if (!thumbnail || typeof thumbnail !== 'string') return null;
  if (thumbnail.startsWith('timelines-asset://')) {
    const decoded = decodeAssetUrl(thumbnail);
    if (!decoded) return null;
    if (timelineAssetsDir) {
      const rel = toPosixRelative(timelineAssetsDir, decoded);
      if (rel) return rel;
    }
    if (assetsRoot) {
      const rel = toPosixRelative(assetsRoot, decoded);
      if (rel) return rel;
    }
    return path.basename(decoded);
  }
  if (!thumbnail.includes('://')) return thumbnail; // already a stored ref
  return null; // external URL, don't touch
}

// Bare refs prefer the timeline folder, slash refs the assets root;
// whichever exists on disk wins, so legacy refs keep resolving either way
function thumbnailCandidatePaths(ref, assetsRoot, timelineAssetsDir) {
  const hasSlash = ref.includes('/') || ref.includes('\\');
  const dirs = hasSlash
    ? [assetsRoot, timelineAssetsDir]
    : [timelineAssetsDir, assetsRoot];
  const normalizedRoot = path.normalize(assetsRoot);
  return dirs
    .filter(Boolean)
    .map((dir) => path.normalize(path.join(dir, ref)))
    .filter((candidate) => candidate.startsWith(normalizedRoot + path.sep));
}

async function findThumbnailFile(ref, assetsRoot, timelineAssetsDir) {
  if (!ref) return null;
  for (const candidate of thumbnailCandidatePaths(ref, assetsRoot, timelineAssetsDir)) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {}
  }
  return null;
}

async function resolveThumbnailRef(ref, assetsRoot, timelineAssetsDir) {
  if (!ref) return null;
  const existing = await findThumbnailFile(ref, assetsRoot, timelineAssetsDir);
  if (existing) return toAssetUrl(existing);
  const contained = thumbnailCandidatePaths(ref, assetsRoot, timelineAssetsDir);
  return contained.length > 0 ? toAssetUrl(contained[0]) : null;
}

async function stripThumbnails(elements, storageId) {
  if (!Array.isArray(elements)) return elements;
  const assetsRoot = await getAssetsRootDir();
  const timelineAssetsDir = storageId ? await getAssetsDir(storageId) : null;
  return elements.map(el => {
    if (!el.thumbnail) return el;
    const ref = extractThumbnailRef(el.thumbnail, assetsRoot, timelineAssetsDir);
    return ref ? { ...el, thumbnail: ref } : el;
  });
}

async function resolveThumbnails(elements, storageId) {
  if (!Array.isArray(elements) || !storageId) return elements;
  const assetsRoot = await getAssetsRootDir();
  const timelineAssetsDir = await getAssetsDir(storageId);
  return Promise.all(elements.map(async el => {
    if (!el.thumbnail) return el;
    const ref = extractThumbnailRef(el.thumbnail, assetsRoot, timelineAssetsDir);
    if (!ref) return el;
    const url = await resolveThumbnailRef(ref, assetsRoot, timelineAssetsDir);
    return url ? { ...el, thumbnail: url } : el;
  }));
}

// If the expected assets folder is missing but exactly one other folder
// contains every referenced image, recover it: orphaned folders (pre-uid
// rename) are renamed, folders owned by another timeline (pre-fix duplicate)
// are copied
async function healMissingAssets(elements, storageId, currentFilePath) {
  if (!Array.isArray(elements) || !storageId) return;
  const refs = [...new Set(
    elements
      .map(el => el.thumbnail)
      .filter(t => t && typeof t === 'string' && !t.includes('://') && !/[\\/]/.test(t))
  )];
  if (refs.length === 0) return;

  const dir = await getAssetsDir(storageId);
  const root = await getAssetsRootDir();

  try { await fs.access(dir); return; } catch {}

  // In-place custom assets at the root already resolve, nothing to recover
  let allAtRoot = true;
  for (const ref of refs) {
    try { await fs.access(path.join(root, ref)); } catch { allAtRoot = false; break; }
  }
  if (allAtRoot) return;

  const timelinesDir = await getTimelinesDir();
  const files = await listTimelineFilesRecursive(timelinesDir, timelinesDir);
  const otherIds = new Set();
  for (const f of files) {
    if (path.normalize(f.fullPath) === path.normalize(currentFilePath)) continue;
    otherIds.add(f.relativeId.split('/').pop());
    try {
      const d = JSON.parse(await fs.readFile(f.fullPath, 'utf8'));
      const sid = deriveStorageId(d.file);
      if (sid) otherIds.add(sid);
    } catch {}
  }

  let match = null;
  let matchOwned = false;
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(root, entry.name);
    let containsAll = true;
    for (const ref of refs) {
      try { await fs.access(path.join(candidate, ref)); } catch { containsAll = false; break; }
    }
    if (containsAll) {
      if (match) return; // multiple matches, don't guess
      match = candidate;
      matchOwned = otherIds.has(entry.name);
    }
  }
  if (!match) return;

  if (matchOwned) {
    // Another timeline's folder: copy so both keep their images
    await fs.cp(match, dir, { recursive: true });
    console.log(`Copied assets folder: ${path.basename(match)} -> ${storageId}`);
  } else {
    await fs.rename(match, dir);
    console.log(`Recovered orphaned assets folder: ${path.basename(match)} -> ${storageId}`);
  }
}

async function importImageByPath(imagePath, timelineId) {
  const assetsBase = await getAssetsRootDir();
  const timelineAssetsDir = await getAssetsDir(timelineId);
  const normalizedImage = path.normalize(imagePath);
  const normalizedAssetsBase = path.normalize(assetsBase);

  let finalAssetPath;
  if (normalizedImage.startsWith(normalizedAssetsBase + path.sep) || normalizedImage === normalizedAssetsBase) {
    finalAssetPath = imagePath;
  } else {
    await fs.mkdir(timelineAssetsDir, { recursive: true });
    let destPath = path.join(timelineAssetsDir, path.basename(imagePath));
    let counter = 1;
    while (true) {
      try { await fs.access(destPath); } catch { break; }
      const ext = path.extname(imagePath);
      const base = path.basename(imagePath, ext);
      destPath = path.join(timelineAssetsDir, `${base}-${counter}${ext}`);
      counter++;
    }
    await fs.copyFile(imagePath, destPath);
    finalAssetPath = destPath;
  }

  const ref = toPosixRelative(timelineAssetsDir, finalAssetPath)
    ?? toPosixRelative(assetsBase, finalAssetPath)
    ?? path.basename(finalAssetPath);
  return { success: true, relativePath: ref, assetUrl: toAssetUrl(finalAssetPath) };
}

ipcMain.handle('pick-and-import-image', async (event, { timelineId }) => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Image',
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths[0]) return { cancelled: true };
    const imported = await importImageByPath(result.filePaths[0], timelineId);
    if (imported?.success) markGitSyncDirty(timelineId);
    return imported;
  } catch (error) {
    console.error('Error importing image:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('import-image-from-path', async (event, { timelineId, filePath }) => {
  try {
    const imported = await importImageByPath(filePath, timelineId);
    if (imported?.success) markGitSyncDirty(timelineId);
    return imported;
  } catch (error) {
    console.error('Error importing dropped image:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('copy-timeline-storage', async (event, { sourceId, targetId }) => {
  try {
    if (!sourceId || !targetId) return { success: false, error: 'Missing sourceId or targetId' };
    if (sourceId === targetId) return { success: true };
    const pairs = [
      [await getNotesDir(sourceId), await getNotesDir(targetId)],
      [await getAssetsDir(sourceId), await getAssetsDir(targetId)],
    ];
    for (const [src, dest] of pairs) {
      try {
        await fs.cp(src, dest, { recursive: true });
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    }
    markGitSyncDirty(targetId);
    return { success: true };
  } catch (error) {
    console.error('Error copying timeline storage:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-asset', async (event, { timelineId, filename }) => {
  try {
    if (!timelineId || !filename) {
      return { success: false, error: 'Missing timelineId or filename' };
    }
    const dir = await getAssetsDir(timelineId);
    const filePath = path.normalize(path.join(dir, path.basename(filename)));
    if (!filePath.startsWith(path.normalize(dir) + path.sep)) {
      return { success: false, error: 'Invalid asset path' };
    }
    await fs.unlink(filePath);
    markGitSyncDirty(timelineId);
    return { success: true };
  } catch (error) {
    if (error.code === 'ENOENT') return { success: true };
    console.error('Error deleting asset:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('list-themes', async () => {
  try {
    const dir = userThemesDir();
    await fs.mkdir(dir, { recursive: true });
    const files = await fs.readdir(dir);
    const themeFiles = files.filter((file) => file.endsWith('.json'));
    const themes = {};

    for (const file of themeFiles) {
      try {
        const content = await fs.readFile(path.join(dir, file), 'utf8');
        const data = JSON.parse(content);
        const key = file.replace('.json', '');
        themes[key] = data;
      } catch (error) {
        console.error(`Failed to load theme ${file}:`, error);
      }
    }

    return themes;
  } catch (error) {
    console.error('Error listing themes:', error);
    return {};
  }
});

ipcMain.handle('save-user-theme', async (event, { id, content }) => {
  try {
    if (!id || !content) {
      return { success: false, error: 'Missing id or content' };
    }
    let parsed;
    try { parsed = JSON.parse(content); } catch {
      return { success: false, error: 'Invalid JSON' };
    }
    const dir = userThemesDir();
    await fs.mkdir(dir, { recursive: true });
    const safeId = sanitizeId(id, 'theme');
    const filePath = path.join(dir, `${safeId}.json`);
    await fs.writeFile(filePath, JSON.stringify(parsed, null, 2), 'utf8');
    return { success: true, path: filePath };
  } catch (error) {
    console.error('Error saving user theme:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('import-theme-dialog', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'JSON Theme Files', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePaths.length) {
      return { success: true, results: [] };
    }
    const dir = userThemesDir();
    await fs.mkdir(dir, { recursive: true });
    const results = [];
    for (const filePath of result.filePaths) {
      const displayName = path.basename(filePath);
      try {
        const content = await fs.readFile(filePath, 'utf8');
        const parsed = JSON.parse(content);
        const safeId = sanitizeId(path.basename(filePath, '.json'), 'theme');
        await fs.writeFile(path.join(dir, `${safeId}.json`), JSON.stringify(parsed, null, 2), 'utf8');
        results.push({ success: true, id: safeId });
      } catch (error) {
        results.push({ success: false, file: displayName, error: error.message });
      }
    }
    return { success: true, results };
  } catch (error) {
    console.error('Error importing themes via dialog:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('delete-user-theme', async (event, { id }) => {
  try {
    if (!id) {
      return { success: false, error: 'Missing id' };
    }
    const dir = userThemesDir();
    const safeId = sanitizeId(id, 'theme');
    const filePath = path.join(dir, `${safeId}.json`);
    await fs.unlink(filePath);
    return { success: true };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { success: false, error: 'NOT_FOUND' };
    }
    console.error('Error deleting user theme:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('list-fonts', async () => {
  try {
    const dir = await getFontsDir();
    await fs.mkdir(dir, { recursive: true });
    const files = await fs.readdir(dir);
    const allowed = new Set(['.ttf', '.otf', '.woff', '.woff2']);

    const fonts = files
      .filter((file) => allowed.has(path.extname(file).toLowerCase()))
      .map((file) => {
        const ext = path.extname(file).toLowerCase();
        const name = path.basename(file, ext);
        const fullPath = path.join(dir, file);
        // Use custom protocol instead of file:// for security
        const fileUrl = `local-font://font/${encodeURIComponent(fullPath)}`;
        const format = ext === '.otf'
          ? 'opentype'
          : ext === '.ttf'
            ? 'truetype'
            : ext.slice(1);
        return { name, path: fullPath, fileUrl, format };
      });

    return fonts;
  } catch (error) {
    console.error('Error listing fonts:', error);
    return [];
  }
});

ipcMain.handle('capture-screenshot', async () => {
  const image = await mainWindow.webContents.capturePage();
  const filename = `screenshot-${Date.now()}.png`;
  const dest = path.join(app.getPath('downloads'), filename);
  await fs.writeFile(dest, image.toPNG());
  return dest;
});
