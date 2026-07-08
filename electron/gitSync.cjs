// Git sync engine; main.cjs injects all library ops. See docs/private/git_sync_plan.md
const path = require('path');
const os = require('os');
const fs = require('fs');
const fsp = fs.promises;
const git = require('isomorphic-git');
const httpNode = require('isomorphic-git/http/node');
const { readPackage } = require('./timelinePackage.cjs');

const safeName = (value) => String(value || '')
  .trim()
  .replace(/[^\w.-]+/g, '-')
  .replace(/-+/g, '-')
  .replace(/^-+|-+$/g, '')
  .toLowerCase();

const bufEq = (a, b) => Boolean(a) && Boolean(b) && a.length === b.length
  && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

// Conflict copies are named {stem}-conflict-{yyyymmdd}-{machine}.timeline
const isConflictCopyPath = (rel) => /-conflict-\d{8}-[\w.-]*\.timeline$/i.test(String(rel || ''));

const stripExt = (rel) => rel.replace(/\.timeline$/i, '');

// GitHub hard-rejects blobs over 100MB, and a package is a single blob
const MAX_PACKAGE_BYTES = 100 * 1024 * 1024;

const formatBytes = (n) => {
  const kb = 1024;
  const mb = kb * 1024;
  const gb = mb * 1024;
  if (n >= gb) return `${(n / gb).toFixed(1)} GB`;
  if (n >= mb) return `${(n / mb).toFixed(1)} MB`;
  if (n >= kb) return `${(n / kb).toFixed(1)} KB`;
  return `${n} B`;
};

function oversizePackageError(rel, buf) {
  if (!buf || buf.length < MAX_PACKAGE_BYTES) return null;
  return {
    path: rel,
    size: buf.length,
    error: `Package is ${formatBytes(buf.length)}, over GitHub's 100MB limit; this timeline was not synced. Reduce its images or exclude it from sync.`,
  };
}

function parseGitHubRemote(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  let pathText = '';
  if (/^git@github\.com:/i.test(raw)) {
    pathText = raw.slice('git@github.com:'.length);
  } else {
    let url;
    try {
      url = new URL(raw);
    } catch {
      return null;
    }
    if (!/^github\.com$/i.test(url.hostname) && !/^www\.github\.com$/i.test(url.hostname)) {
      return null;
    }
    pathText = url.pathname.replace(/^\/+/, '');
  }
  const parts = pathText.replace(/\.git$/i, '').split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const [owner, repo] = parts;
  return {
    owner,
    repo,
    htmlUrl: `https://github.com/${owner}/${repo}`,
    cloneUrl: `https://github.com/${owner}/${repo}.git`,
  };
}

function viewerDeepLink(owner, repo, ref, relPath) {
  const encodedPath = String(relPath || '')
    .split('/')
    .map(encodeURIComponent)
    .join('/');
  return `https://www.timelines.studio/viewer/gh/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(ref)}/${encodedPath}`;
}

function summarizePackageDiff(oldBuf, newBuf) {
  let oldPkg;
  let newPkg;
  let oldData;
  let newData;
  try {
    oldPkg = readPackage(Buffer.from(oldBuf));
    newPkg = readPackage(Buffer.from(newBuf));
    oldData = JSON.parse(oldPkg.timelineJson);
    newData = JSON.parse(newPkg.timelineJson);
  } catch {
    return null;
  }
  const byId = (data) => new Map(
    (Array.isArray(data.elements) ? data.elements : [])
      .filter((el) => el && el.id != null)
      .map((el) => [el.id, el])
  );
  const oldEls = byId(oldData);
  const newEls = byId(newData);
  let added = 0;
  let removed = 0;
  const renamed = [];
  for (const [id, el] of newEls) {
    const prev = oldEls.get(id);
    if (!prev) added += 1;
    else if ((prev.title || '') !== (el.title || '')) renamed.push(el.title || 'untitled');
  }
  for (const id of oldEls.keys()) {
    if (!newEls.has(id)) removed += 1;
  }
  const countChanged = (a, b, eq) => {
    let n = 0;
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (a[key] === undefined || b[key] === undefined || !eq(a[key], b[key])) n += 1;
    }
    return n;
  };
  const notesChanged = countChanged(oldPkg.notes, newPkg.notes, (x, y) => x === y);
  const assetsChanged = countChanged(oldPkg.assets, newPkg.assets, bufEq);

  const parts = [];
  if ((oldData.file?.title || '') !== (newData.file?.title || '')) {
    parts.push(`retitled "${newData.file?.title || ''}"`);
  }
  if (added) parts.push(`+${added} element${added === 1 ? '' : 's'}`);
  if (removed) parts.push(`-${removed} element${removed === 1 ? '' : 's'}`);
  if (renamed.length === 1) parts.push(`renamed "${renamed[0]}"`);
  else if (renamed.length > 1) parts.push(`${renamed.length} renamed`);
  if (notesChanged) parts.push(`${notesChanged} note${notesChanged === 1 ? '' : 's'} edited`);
  if (assetsChanged) parts.push(`${assetsChanged} asset${assetsChanged === 1 ? '' : 's'} changed`);
  return parts.length > 0 ? parts.join(', ') : null;
}

const isNetworkError = (err) => {
  const code = err?.code || err?.cause?.code;
  if (['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT'].includes(code)) return true;
  return /network|fetch failed|socket hang up/i.test(err?.message || '');
};

const isAuthError = (err) => err?.code === 'HttpError'
  && (err?.data?.statusCode === 401 || err?.data?.statusCode === 403);

const isEmptyRemoteError = (err) => err?.code === 'NotFoundError'
  || /could not find|no refs|empty/i.test(err?.message || '');

class GitSyncEngine {
  constructor(opts = {}) {
    this.repoDir = opts.repoDir;
    this.statePath = opts.statePath;
    this.listTimelines = opts.listTimelines;
    this.buildPackageForTimeline = opts.buildPackageForTimeline;
    this.importPackage = opts.importPackage;
    this.removeLocalTimeline = opts.removeLocalTimeline;
    this.http = opts.http || httpNode;
    this.onAuth = opts.onAuth || (() => (
      this.credentials?.token
        ? {
          username: this.credentials.username || 'x-access-token',
          password: this.credentials.token,
        }
        : {}
    ));
    this.author = opts.author || { name: 'Timelines', email: 'timelines@localhost' };
    this.machineLabel = safeName(opts.machineLabel || os.hostname()) || 'machine';
    this.onStatus = opts.onStatus || null;
    this.onApplied = opts.onApplied || null;
    this.now = opts.now || (() => new Date());
    this.debounceMs = opts.debounceMs ?? 5 * 60 * 1000;
    this.autoSync = opts.autoSync !== false;

    this.state = null;
    this.loadCredentials = opts.loadCredentials || (async () => null);
    this.saveCredentials = opts.saveCredentials || (async () => {});
    this.clearCredentials = opts.clearCredentials || (async () => {});
    this.credentials = null;
    this.dirtyUids = new Set();
    this.structureDirty = false;
    this.importing = false;
    this.statusState = 'disconnected';
    this.lastError = null;
    this.lastSyncedAt = null;
    this.conflictCopies = [];
    this.importErrors = [];
    this.exportErrors = [];
    this._timer = null;
    this._queue = Promise.resolve();
  }

  async init() {
    try {
      this.state = JSON.parse(await fsp.readFile(this.statePath, 'utf8'));
    } catch {
      this.state = null;
    }
    try {
      this.credentials = await this.loadCredentials();
    } catch {
      this.credentials = null;
    }
    this._applyIdentity(this.credentials);
    if (this.state?.machineLabel) this.machineLabel = this.state.machineLabel;
    this.statusState = this.state
      ? (this.credentials?.token ? 'idle' : 'auth-expired')
      : 'disconnected';
    return this;
  }

  isConnected() {
    return Boolean(this.state?.url);
  }

  getStatus() {
    const github = this.state?.url ? parseGitHubRemote(this.state.url) : null;
    return {
      state: this.statusState,
      lastSyncedAt: this.lastSyncedAt,
      pendingCount: this.dirtyUids.size + (this.structureDirty ? 1 : 0),
      conflictCopies: [...this.conflictCopies],
      importErrors: [...this.importErrors],
      exportErrors: [...this.exportErrors],
      error: this.lastError ? String(this.lastError.message || this.lastError) : null,
      repo: this.state
        ? {
          url: this.state.url,
          branch: this.state.branch,
          owner: github?.owner || null,
          repo: github?.repo || null,
        }
        : null,
      machineLabel: this.machineLabel,
      excludedPaths: [...(this.state?.excludedPaths || [])],
      writeReadme: this.state?.writeReadme !== false,
      autoSync: this.autoSync,
      debounceMs: this.debounceMs,
      hasAuth: Boolean(this.credentials?.token),
      authType: this.credentials?.authType || null,
      username: this.credentials?.username || null,
    };
  }

  _setStatus(statusState, err = null) {
    this.statusState = statusState;
    this.lastError = err;
    if (this.onStatus) {
      try { this.onStatus(this.getStatus()); } catch {}
    }
  }

  async _saveState() {
    const tmp = `${this.statePath}.tmp`;
    await fsp.mkdir(path.dirname(this.statePath), { recursive: true });
    await fsp.writeFile(tmp, JSON.stringify(this.state, null, 2), 'utf8');
    await fsp.rename(tmp, this.statePath);
  }

  // Called by mutating IPC handlers; a no-op while our own import is writing
  markDirty(uid) {
    if (this.importing || !this.isConnected() || !uid) return;
    this.dirtyUids.add(uid);
    this._setStatus(this.statusState === 'syncing' ? 'syncing' : 'dirty');
    this._scheduleAutoSync();
  }

  markStructureDirty() {
    if (this.importing || !this.isConnected()) return;
    this.structureDirty = true;
    this._setStatus(this.statusState === 'syncing' ? 'syncing' : 'dirty');
    this._scheduleAutoSync();
  }

  _scheduleAutoSync() {
    if (!this.autoSync) return;
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this._timer = null;
      this.syncNow().catch(() => {});
    }, this.debounceMs);
    if (this._timer.unref) this._timer.unref();
  }

  setAutoSync(enabled, debounceMs) {
    this.autoSync = Boolean(enabled);
    if (debounceMs) this.debounceMs = debounceMs;
    if (!this.autoSync && this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  setExcludedPaths(paths) {
    if (!this.state) return;
    this.state.excludedPaths = Array.isArray(paths) ? [...paths] : [];
    this.structureDirty = true;
  }

  _isExcluded(relId) {
    const rel = stripExt(String(relId || ''));
    return (this.state?.excludedPaths || []).some((entry) => (
      entry.endsWith('/') ? rel.startsWith(entry) : rel === entry
    ));
  }

  syncNow(opts = {}) {
    const run = this._queue.then(() => this._syncPass(opts));
    this._queue = run.catch(() => {});
    return run;
  }

  startupSync() {
    return this.syncNow({ full: true });
  }

  async connect({ url, branch = 'main' }) {
    if (!url) throw new Error('Missing repository URL');
    const run = this._queue.then(() => this._connect({ url, branch }));
    this._queue = run.catch(() => {});
    return run;
  }

  async disconnect({ deleteMirror = false } = {}) {
    this.state = null;
    this.credentials = null;
    this.dirtyUids.clear();
    this.structureDirty = false;
    await fsp.rm(this.statePath, { force: true });
    await this.clearCredentials().catch(() => {});
    if (deleteMirror) await fsp.rm(this.repoDir, { recursive: true, force: true });
    this._applyIdentity(null);
    this._setStatus('disconnected');
  }

  _applyIdentity(credentials) {
    const username = String(credentials?.username || '').trim();
    if (!username || username === 'x-access-token') {
      this.author = { name: 'Timelines', email: 'timelines@localhost' };
      return;
    }
    const localPart = safeName(username) || 'timelines-user';
    this.author = {
      name: username,
      email: `${localPart}@users.noreply.localhost`,
    };
  }

  async updateSettings({ machineLabel, excludedPaths, autoSync, debounceMs, writeReadme } = {}) {
    if (machineLabel !== undefined) {
      const nextLabel = safeName(machineLabel) || this.machineLabel;
      this.machineLabel = nextLabel;
      if (this.state) this.state.machineLabel = nextLabel;
    }
    if (excludedPaths !== undefined && this.state) {
      this.state.excludedPaths = Array.isArray(excludedPaths) ? [...excludedPaths] : [];
      this.structureDirty = true;
    }
    if (writeReadme !== undefined && this.state) {
      const next = writeReadme !== false;
      if (next !== (this.state.writeReadme !== false)) this.structureDirty = true;
      this.state.writeReadme = next;
    }
    if (autoSync !== undefined || debounceMs !== undefined) {
      this.setAutoSync(autoSync ?? this.autoSync, debounceMs ?? this.debounceMs);
    }
    if (this.state) await this._saveState();
    return this.getStatus();
  }

  rebuildMirror() {
    if (!this.isConnected()) throw new Error('Git sync is not connected');
    const { url, branch } = this.state;
    const run = this._queue.then(() => this._connect({ url, branch }));
    this._queue = run.catch(() => {});
    return run;
  }

  async mirrorSize() {
    const walk = async (dir) => {
      let total = 0;
      let entries;
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return 0;
      }
      for (const entry of entries) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) total += await walk(abs);
        else {
          try { total += (await fsp.stat(abs)).size; } catch {}
        }
      }
      return total;
    };
    return walk(this.repoDir);
  }

  async updateCredentials({ token, username = 'x-access-token', authType = 'pat' } = {}) {
    const trimmedToken = String(token || '').trim();
    if (!trimmedToken) throw new Error('Missing personal access token');
    const trimmedUsername = String(username || '').trim() || 'x-access-token';
    this.credentials = {
      authType,
      username: trimmedUsername,
      token: trimmedToken,
    };
    await this.saveCredentials(this.credentials);
    this._applyIdentity(this.credentials);
    if (this.statusState === 'auth-expired') {
      this._setStatus(this.state ? 'idle' : 'disconnected');
    }
    return this.getStatus();
  }

  async shareInfo(uid) {
    if (!this.isConnected()) throw new Error('Git sync is not connected');
    const rel = this.state?.uidToPath?.[uid];
    if (!rel) throw new Error('Timeline is not synced to the remote');
    const github = parseGitHubRemote(this.state.url);
    const branch = this.state.branch;
    const localOid = await this._resolve(`refs/heads/${branch}`);
    const remoteOid = await this._resolve(`refs/remotes/origin/${branch}`);
    const pending = await this._hasPendingTimelineChange(uid, rel, localOid, remoteOid);
    return {
      uid,
      path: rel,
      remoteUrl: this.state.url,
      branch,
      github,
      canShareViewer: Boolean(github),
      requiresPublicRepo: Boolean(github),
      pending,
      viewerUrl: github ? viewerDeepLink(github.owner, github.repo, branch, rel) : null,
      exactViewerUrl: github && remoteOid ? viewerDeepLink(github.owner, github.repo, remoteOid, rel) : null,
      githubBlobUrl: github ? `${github.htmlUrl}/blob/${encodeURIComponent(branch)}/${rel.split('/').map(encodeURIComponent).join('/')}` : null,
    };
  }

  async fileHistory(uid, { depth = 100 } = {}) {
    if (!this.isConnected()) throw new Error('Git sync is not connected');
    const rel = this.state?.uidToPath?.[uid];
    if (!rel) throw new Error('Timeline is not synced to the remote');
    const github = parseGitHubRemote(this.state.url);
    const entries = await git.log({
      ...this._g,
      ref: this.state.branch,
      filepath: rel,
      force: true,
      depth,
    });
    return {
      uid,
      path: rel,
      entries: entries.map((entry) => {
        const fullMessage = entry.commit.message || '';
        const [subject, ...bodyLines] = fullMessage.split('\n');
        const body = bodyLines.join('\n').trim();
        const timelinePrefix = `${stripExt(rel)}:`;
        const summaryLine = body
          .split('\n')
          .map((line) => line.trim())
          .find((line) => line.startsWith(timelinePrefix));
        return {
          oid: entry.oid,
          subject: subject || '',
          body,
          summary: summaryLine ? summaryLine.slice(timelinePrefix.length).trim() : null,
          authorName: entry.commit.author?.name || '',
          authorEmail: entry.commit.author?.email || '',
          committedAt: new Date(entry.commit.committer.timestamp * 1000).toISOString(),
          viewerUrl: github ? viewerDeepLink(github.owner, github.repo, entry.oid, rel) : null,
        };
      }),
    };
  }

  async restoreVersion(uid, commitOid) {
    if (!this.isConnected()) throw new Error('Git sync is not connected');
    const rel = this.state?.uidToPath?.[uid];
    if (!rel) throw new Error('Timeline is not synced to the remote');
    if (!commitOid) throw new Error('Missing commit SHA');
    const { blob } = await git.readBlob({ ...this._g, oid: commitOid, filepath: rel });
    const result = await this.importPackage(Buffer.from(blob), {
      resolution: 'copy',
      silent: true,
      titleSuffix: ' (Restored)',
    });
    if (result?.success) this.markStructureDirty();
    return {
      ...result,
      restoredFrom: commitOid,
      path: rel,
    };
  }

  get _g() {
    return { fs, dir: this.repoDir };
  }

  get _net() {
    return { fs, dir: this.repoDir, http: this.http, onAuth: this.onAuth };
  }

  async _resolve(ref) {
    try {
      return await git.resolveRef({ ...this._g, ref });
    } catch {
      return null;
    }
  }

  async _hasPendingTimelineChange(uid, rel, localOid, remoteOid) {
    if (this.structureDirty || this.dirtyUids.has(uid)) return true;
    try {
      const matrix = await git.statusMatrix(this._g);
      if (matrix.some(([filepath, head, workdir]) => filepath === rel && !(head === 1 && workdir === 1))) {
        return true;
      }
    } catch {}
    return Boolean(localOid && remoteOid && localOid !== remoteOid);
  }

  async _connect({ url, branch }) {
    this._setStatus('syncing');
    try {
      const prevExcluded = this.state?.excludedPaths || [];
      const prevWriteReadme = this.state?.writeReadme;
      const github = parseGitHubRemote(url);
      await fsp.rm(this.repoDir, { recursive: true, force: true });
      await fsp.mkdir(this.repoDir, { recursive: true });
      // init + fetch instead of clone so an empty remote isn't an error
      await git.init({ ...this._g, defaultBranch: branch });
      await git.addRemote({ ...this._g, remote: 'origin', url, force: true });
      try {
        await git.fetch({ ...this._net, remote: 'origin', ref: branch, singleBranch: true, tags: false });
      } catch (err) {
        if (!isEmptyRemoteError(err)) throw err;
      }
      const remoteOid = await this._resolve(`refs/remotes/origin/${branch}`);
      if (remoteOid) {
        await git.writeRef({ ...this._g, ref: `refs/heads/${branch}`, value: remoteOid, force: true });
        await git.checkout({ ...this._g, ref: branch, force: true });
      }

      this.state = {
        url,
        branch,
        owner: github?.owner || null,
        repo: github?.repo || null,
        uidToPath: {},
        lastSyncedCommit: null,
        machineLabel: this.machineLabel,
        excludedPaths: prevExcluded,
        writeReadme: prevWriteReadme,
      };

      // Pre-existing packages: adopt their uids so the export pass sees them
      const mirror = await this._scanMirrorPackages();
      for (const entry of mirror) {
        if (entry.uid && !this.state.uidToPath[entry.uid]) this.state.uidToPath[entry.uid] = entry.rel;
      }

      // First export: remote wins shared uids; a differing local version becomes a conflict copy beside it
      const summaries = [];
      const exportedPaths = new Set();
      this.exportErrors = [];
      const pathsBefore = (await this._listMirrorFiles()).sort().join('\n');
      const timelines = await this.listTimelines();
      for (const t of timelines) {
        if (!t?.uid || this._isExcluded(t.relativeId) || t.neverSync) continue;
        const existingRel = this.state.uidToPath[t.uid];
        let buf;
        try {
          buf = Buffer.from(await this.buildPackageForTimeline(t));
        } catch (err) {
          console.error('git-sync: export failed for', t.relativeId, err);
          continue;
        }
        const oversize = oversizePackageError(`${t.relativeId}.timeline`, buf);
        if (oversize) {
          console.error('git-sync: skipping oversized package', oversize.path, oversize.error);
          this.exportErrors.push(oversize);
          continue;
        }
        if (existingRel) {
          const remoteBuf = await this._readMirrorFile(existingRel);
          if (remoteBuf && !bufEq(remoteBuf, buf)) {
            const copyRel = await this._writeConflictCopy(existingRel, buf);
            summaries.push({ path: copyRel, summary: 'conflicted copy (kept both versions)' });
          }
        } else {
          const rel = `${t.relativeId}.timeline`;
          await this._writeMirrorFile(rel, buf);
          this.state.uidToPath[t.uid] = rel;
          exportedPaths.add(rel);
          summaries.push({ path: rel, summary: 'added' });
        }
      }

      await this._ensureRepoMetaFiles();
      const pathsAfter = (await this._listMirrorFiles()).sort().join('\n');
      if (this.state.writeReadme !== false
        && (pathsBefore !== pathsAfter || !fs.existsSync(path.join(this.repoDir, 'README.md')))) {
        await this._regenerateReadme();
      }
      await this._stageAndCommit(this._commitMessage(summaries));
      await this._pushWithRetry(branch);
      await this._importPass(exportedPaths);
      await this._saveState();
      this.lastSyncedAt = this.now().toISOString();
      this._setStatus('idle');
      return this.getStatus();
    } catch (err) {
      console.error('git-sync: connect failed:', err);
      this.state = null;
      this._setStatus('error', err);
      throw err;
    }
  }

  async _syncPass({ full = false } = {}) {
    if (!this.isConnected()) return this.getStatus();
    const branch = this.state.branch;
    // Take ownership of the dirty set; edits during the pass land in a new one
    const dirtySnapshot = this.dirtyUids;
    this.dirtyUids = new Set();
    const structureSnapshot = this.structureDirty;
    this.structureDirty = false;
    this._setStatus('syncing');
    this.conflictCopies = [];
    this.exportErrors = [];

    try {
      const sweepAll = full || structureSnapshot;
      const pathsBefore = (await this._listMirrorFiles()).sort().join('\n');
      const { summaries, exportedPaths, deletedPaths } = await this._exportPass(dirtySnapshot, sweepAll);
      const pathsAfter = (await this._listMirrorFiles()).sort().join('\n');
      await this._ensureRepoMetaFiles();
      const readmeMissing = !fs.existsSync(path.join(this.repoDir, 'README.md'));
      if (this.state.writeReadme !== false && (pathsBefore !== pathsAfter || readmeMissing)) {
        await this._regenerateReadme();
      }
      await this._stageAndCommit(this._commitMessage(summaries));

      let offline = false;
      try {
        await this._fetchAndReconcile(branch, exportedPaths);
        await this._pushWithRetry(branch, exportedPaths);
      } catch (err) {
        if (isNetworkError(err)) {
          offline = true;
        } else if (isAuthError(err)) {
          this._setStatus('auth-expired', err);
          await this._importPass(exportedPaths, deletedPaths);
          await this._saveState();
          return this.getStatus();
        } else {
          throw err;
        }
      }

      await this._importPass(exportedPaths, deletedPaths);
      await this._saveState();
      this.lastSyncedAt = this.now().toISOString();
      if (offline) {
        this._setStatus('offline');
      } else {
        this._setStatus(this.dirtyUids.size > 0 ? 'dirty' : 'idle');
      }
      return this.getStatus();
    } catch (err) {
      // Put the work back so the next pass retries it
      for (const uid of dirtySnapshot) this.dirtyUids.add(uid);
      this.structureDirty = this.structureDirty || structureSnapshot;
      console.error('git-sync: sync failed:', err);
      this._setStatus('error', err);
      return this.getStatus();
    }
  }

  async _exportPass(dirtyUids, sweepAll) {
    const summaries = [];
    const exportedPaths = new Set();
    const deletedPaths = new Set();
    const timelines = await this.listTimelines();
    const libraryUids = new Set(timelines.map((t) => t?.uid).filter(Boolean));

    for (const t of timelines) {
      if (!t?.uid) continue;
      if (this._isExcluded(t.relativeId) || t.neverSync) continue;
      if (!sweepAll && !dirtyUids.has(t.uid)) continue;
      const rel = `${t.relativeId}.timeline`;
      const oldRel = this.state.uidToPath[t.uid];
      let buf;
      try {
        buf = Buffer.from(await this.buildPackageForTimeline(t));
      } catch (err) {
        console.error('git-sync: export failed for', t.relativeId, err);
        this.dirtyUids.add(t.uid);
        continue;
      }
      const oversize = oversizePackageError(rel, buf);
      if (oversize) {
        // Skip this one and keep any prior version; don't re-mark dirty (retry won't help)
        console.error('git-sync: skipping oversized package', rel, oversize.error);
        this.exportErrors.push(oversize);
        continue;
      }
      const oldBuf = await this._readMirrorFile(oldRel || rel);
      if (oldRel && oldRel !== rel) {
        await this._deleteMirrorFile(oldRel);
        deletedPaths.add(oldRel);
        summaries.push({ path: rel, summary: `moved from ${oldRel}` });
      }
      if (!oldBuf || !bufEq(oldBuf, buf)) {
        await this._writeMirrorFile(rel, buf);
        exportedPaths.add(rel);
        if (oldBuf) {
          const summary = summarizePackageDiff(oldBuf, buf);
          if (summary) summaries.push({ path: rel, summary });
        } else {
          summaries.push({ path: rel, summary: 'added' });
        }
      } else if (oldRel && oldRel !== rel) {
        await this._writeMirrorFile(rel, buf);
        exportedPaths.add(rel);
      }
      this.state.uidToPath[t.uid] = rel;
    }

    // Tracked uid gone from the library = deleted locally; untracked mirror files are remote additions, left alone
    for (const [uid, rel] of Object.entries(this.state.uidToPath)) {
      if (libraryUids.has(uid)) continue;
      if (this._isExcluded(rel)) continue;
      await this._deleteMirrorFile(rel);
      deletedPaths.add(rel);
      delete this.state.uidToPath[uid];
      summaries.push({ path: rel, summary: 'deleted' });
    }
    return { summaries, exportedPaths, deletedPaths };
  }

  _commitMessage(summaries) {
    const timelineChanges = summaries.filter((s) => s.path.endsWith('.timeline'));
    if (timelineChanges.length === 0 && summaries.length === 0) return null;
    const n = timelineChanges.length;
    const subject = n > 0
      ? `Update ${n} timeline${n === 1 ? '' : 's'} (${this.machineLabel})`
      : `Update sync metadata (${this.machineLabel})`;
    const body = summaries
      .map((s) => `${stripExt(s.path)}: ${s.summary || 'updated'}`)
      .sort()
      .join('\n');
    return body ? `${subject}\n\n${body}` : subject;
  }

  async _stageAndCommit(message) {
    let matrix = null;
    try {
      matrix = await git.statusMatrix(this._g);
    } catch (err) {
      // Unborn HEAD (fresh repo with no commits yet): stage everything
      if (err?.code !== 'NotFoundError') throw err;
    }
    let staged = 0;
    if (matrix) {
      for (const [filepath, head, workdir] of matrix) {
        if (head === 1 && workdir === 1) continue;
        if (workdir === 0) await git.remove({ ...this._g, filepath });
        else await git.add({ ...this._g, filepath });
        staged += 1;
      }
    } else {
      for (const rel of await this._listRepoFiles()) {
        await git.add({ ...this._g, filepath: rel });
        staged += 1;
      }
    }
    if (staged === 0) return null;
    return git.commit({
      ...this._g,
      message: message || `Update (${this.machineLabel})`,
      author: { ...this.author },
    });
  }

  // On divergence, reset to remote and re-apply local wins + conflict copies as one commit (linear history)
  async _fetchAndReconcile(branch, exportedPaths) {
    try {
      await git.fetch({ ...this._net, remote: 'origin', ref: branch, singleBranch: true, tags: false });
    } catch (err) {
      if (isEmptyRemoteError(err)) return;
      throw err;
    }
    const remoteOid = await this._resolve(`refs/remotes/origin/${branch}`);
    const localOid = await this._resolve(`refs/heads/${branch}`);
    if (!remoteOid || remoteOid === localOid) return;

    if (!localOid) {
      await git.writeRef({ ...this._g, ref: `refs/heads/${branch}`, value: remoteOid, force: true });
      await git.checkout({ ...this._g, ref: branch, force: true });
      return;
    }

    let base = null;
    try {
      const bases = await git.findMergeBase({ ...this._g, oids: [localOid, remoteOid] });
      base = bases?.[0] || null;
    } catch {}
    if (base === remoteOid) return; // we're ahead; nothing to reconcile
    if (base === localOid) {
      // Fast-forward
      await git.writeRef({ ...this._g, ref: `refs/heads/${branch}`, value: remoteOid, force: true });
      await git.checkout({ ...this._g, ref: branch, force: true });
      return;
    }

    const localChanges = await this._diffCommits(base, localOid);
    const remoteChanges = await this._diffCommits(base, remoteOid);
    const remoteByPath = new Map(remoteChanges.map((c) => [c.path, c]));

    const localWins = [];
    const conflicts = [];
    for (const change of localChanges) {
      const remote = remoteByPath.get(change.path);
      if (!remote) {
        localWins.push(change);
      } else if (remote.to !== change.to) {
        // Remote wins the path, so the import pass must apply its version
        exportedPaths?.delete(change.path);
        if (change.to && change.path.endsWith('.timeline')) {
          // Keep our version as a conflict copy beside the winner
          conflicts.push(change);
        }
      }
    }

    // Capture blobs before moving the branch
    const winBlobs = new Map();
    for (const change of localWins) {
      if (!change.to) continue;
      const { blob } = await git.readBlob({ ...this._g, oid: localOid, filepath: change.path });
      winBlobs.set(change.path, Buffer.from(blob));
    }
    const conflictBlobs = new Map();
    for (const change of conflicts) {
      const { blob } = await git.readBlob({ ...this._g, oid: localOid, filepath: change.path });
      conflictBlobs.set(change.path, Buffer.from(blob));
    }

    await git.writeRef({ ...this._g, ref: `refs/heads/${branch}`, value: remoteOid, force: true });
    await git.checkout({ ...this._g, ref: branch, force: true });

    const lines = [];
    for (const change of localWins) {
      if (change.to) {
        await this._writeMirrorFile(change.path, winBlobs.get(change.path));
        exportedPaths?.add(change.path);
      } else {
        await this._deleteMirrorFile(change.path);
      }
      lines.push(`${stripExt(change.path)}: kept local version`);
    }
    for (const change of conflicts) {
      const copyRel = await this._writeConflictCopy(change.path, conflictBlobs.get(change.path));
      this.conflictCopies.push(copyRel);
      lines.push(`${stripExt(change.path)}: edited on two machines, local version kept as ${stripExt(copyRel)}`);
    }
    if (localWins.length > 0 || conflicts.length > 0) {
      await this._stageAndCommit(`Keep local changes (${this.machineLabel})\n\n${lines.sort().join('\n')}`);
    }
  }

  async _pushWithRetry(branch, exportedPaths) {
    const localOid = await this._resolve(`refs/heads/${branch}`);
    if (!localOid) return;
    const remoteOid = await this._resolve(`refs/remotes/origin/${branch}`);
    if (remoteOid === localOid) return;
    try {
      await git.push({ ...this._net, remote: 'origin', ref: branch, remoteRef: branch });
    } catch (err) {
      // A racing push from another machine landed between fetch and push
      if (err?.code === 'PushRejectedError') {
        await this._fetchAndReconcile(branch, exportedPaths);
        await git.push({ ...this._net, remote: 'origin', ref: branch, remoteRef: branch });
        return;
      }
      throw err;
    }
  }

  async _importPass(exportedPaths = new Set(), locallyDeletedPaths = new Set()) {
    const branch = this.state.branch;
    const head = await this._resolve(`refs/heads/${branch}`);
    if (!head) return;
    if (this.state.lastSyncedCommit === head) return;

    const changes = await this._diffCommits(this.state.lastSyncedCommit, head);
    const changedIds = [];
    const errors = [];
    const incoming = changes.filter((c) => c.to
      && c.path.endsWith('.timeline')
      && !this._isExcluded(c.path)
      && !exportedPaths.has(c.path));
    // Originals before conflict copies so copy imports see their uid taken
    incoming.sort((a, b) => Number(isConflictCopyPath(a.path)) - Number(isConflictCopyPath(b.path)));

    this.importing = true;
    try {
      for (const change of incoming) {
        let buf;
        try {
          buf = await this._readMirrorFile(change.path);
        } catch {
          buf = null;
        }
        if (!buf) continue;
        const stem = stripExt(change.path);
        try {
          const conflictCopy = isConflictCopyPath(change.path);
          const res = await this.importPackage(buf, {
            resolution: conflictCopy ? 'copy' : 'overwrite',
            silent: true,
            preferredRelId: stem,
            titleSuffix: conflictCopy ? ' (conflicted copy)' : undefined,
          });
          if (!res?.success) {
            errors.push({ path: change.path, error: res?.error || 'import failed' });
            continue;
          }
          if (res.uid) this.state.uidToPath[res.uid] = change.path;
          if (res.id) changedIds.push(res.id);
          if (conflictCopy && !this.conflictCopies.includes(change.path)) {
            this.conflictCopies.push(change.path);
          }
        } catch (err) {
          console.error('git-sync: import failed for', change.path, err);
          errors.push({ path: change.path, error: err.message });
        }
      }

      // Remote deletion only when the uid still maps to that path (moves were re-mapped by the overwrite import)
      for (const change of changes) {
        if (change.to || !change.path.endsWith('.timeline')) continue;
        if (this._isExcluded(change.path) || locallyDeletedPaths.has(change.path)) continue;
        const uid = Object.keys(this.state.uidToPath).find((u) => this.state.uidToPath[u] === change.path);
        if (!uid) continue;
        try {
          await this.removeLocalTimeline(uid);
          delete this.state.uidToPath[uid];
          changedIds.push(stripExt(change.path));
        } catch (err) {
          console.error('git-sync: could not remove', change.path, err);
        }
      }
    } finally {
      this.importing = false;
    }

    this.state.lastSyncedCommit = head;
    this.importErrors = errors;
    if (changedIds.length > 0 && this.onApplied) {
      try { this.onApplied(changedIds); } catch {}
    }
  }

  // All file-level changes between two commits (null from = everything in to)
  async _diffCommits(fromOid, toOid) {
    const trees = fromOid
      ? [git.TREE({ ref: fromOid }), git.TREE({ ref: toOid })]
      : [git.TREE({ ref: toOid })];
    const entries = await git.walk({
      ...this._g,
      trees,
      map: async (filepath, nodes) => {
        if (filepath === '.') return undefined;
        const [a, b] = fromOid ? nodes : [null, nodes[0]];
        const aType = a ? await a.type() : null;
        const bType = b ? await b.type() : null;
        if (aType === 'tree' || bType === 'tree') return undefined;
        const aOid = a ? await a.oid() : null;
        const bOid = b ? await b.oid() : null;
        if (aOid === bOid) return undefined;
        return { path: filepath, from: aOid, to: bOid };
      },
    });
    return entries;
  }

  async _writeConflictCopy(rel, buf) {
    const d = this.now();
    const ymd = d.toISOString().slice(0, 10).replace(/-/g, '');
    const stem = stripExt(rel);
    let copyRel = `${stem}-conflict-${ymd}-${this.machineLabel}.timeline`;
    let counter = 2;
    while (fs.existsSync(path.join(this.repoDir, ...copyRel.split('/')))) {
      copyRel = `${stem}-conflict-${ymd}-${this.machineLabel}-${counter}.timeline`;
      counter += 1;
    }
    await this._writeMirrorFile(copyRel, buf);
    return copyRel;
  }

  _mirrorAbs(rel) {
    return path.join(this.repoDir, ...rel.split('/'));
  }

  async _readMirrorFile(rel) {
    if (!rel) return null;
    try {
      return await fsp.readFile(this._mirrorAbs(rel));
    } catch {
      return null;
    }
  }

  async _writeMirrorFile(rel, buf) {
    const abs = this._mirrorAbs(rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, Buffer.from(buf));
  }

  async _deleteMirrorFile(rel) {
    await fsp.rm(this._mirrorAbs(rel), { force: true });
  }

  async _listRepoFiles(subdir = '', timelineOnly = false) {
    const results = [];
    const dir = path.join(this.repoDir, subdir);
    let entries = [];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return results;
    }
    for (const entry of entries) {
      if (entry.name === '.git') continue;
      const rel = subdir ? `${subdir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) results.push(...await this._listRepoFiles(rel, timelineOnly));
      else if (entry.isFile() && (!timelineOnly || entry.name.endsWith('.timeline'))) results.push(rel);
    }
    return results;
  }

  _listMirrorFiles() {
    return this._listRepoFiles('', true);
  }

  async _scanMirrorPackages() {
    const out = [];
    for (const rel of await this._listMirrorFiles()) {
      const buf = await this._readMirrorFile(rel);
      if (!buf) continue;
      try {
        const pkg = readPackage(buf);
        const data = JSON.parse(pkg.timelineJson);
        const uid = data?.file?.uid || data?.file?.id?.replace(/-timeline$/, '') || null;
        out.push({ rel, uid, title: data?.file?.title || stripExt(rel) });
      } catch {}
    }
    return out;
  }

  async _ensureRepoMetaFiles() {
    const attrsPath = path.join(this.repoDir, '.gitattributes');
    if (!fs.existsSync(attrsPath)) {
      await fsp.writeFile(attrsPath, '*.timeline binary\n', 'utf8');
    }
    // Mirror the exclusion list into git so other devices stop staging these paths after they pull
    const excluded = this.state?.excludedPaths || [];
    const ignorePath = path.join(this.repoDir, '.gitignore');
    const ignoreLine = (p) => (p.endsWith('/') ? `/${p}` : `/${p}.timeline`);
    const content = excluded.length > 0
      ? `# Excluded from sync for this repo (managed by Timelines)\n${excluded.map((p) => `${ignoreLine(p)}\n`).join('')}`
      : '';
    const current = fs.existsSync(ignorePath) ? await fsp.readFile(ignorePath, 'utf8') : null;
    if (content && content !== current) await fsp.writeFile(ignorePath, content, 'utf8');
    else if (!content && current !== null) await fsp.rm(ignorePath, { force: true });

    if (this.state?.writeReadme === false) {
      await fsp.rm(path.join(this.repoDir, 'README.md'), { force: true });
    }
  }

  async _regenerateReadme() {
    const pkgs = await this._scanMirrorPackages();
    pkgs.sort((a, b) => a.rel.localeCompare(b.rel));
    const { owner, repo, branch } = this.state;
    const rows = [];
    for (const pkg of pkgs) {
      let date = '';
      try {
        const log = await git.log({ ...this._g, ref: branch, filepath: pkg.rel, depth: 1, force: true });
        if (log?.[0]) date = new Date(log[0].commit.committer.timestamp * 1000).toISOString().slice(0, 10);
      } catch {}
      const encoded = pkg.rel.split('/').map(encodeURIComponent).join('/');
      const link = owner && repo
        ? `[Open](https://www.timelines.studio/viewer/gh/${owner}/${repo}/${branch}/${encoded})`
        : '';
      rows.push(`| ${pkg.title.replace(/\|/g, '\\|')} | ${link} | ${date} |`);
    }
    const lines = [
      '# Timelines library',
      '',
      'This repository is a synced mirror of a [Timelines](https://www.timelines.studio) library, managed by the app.',
      'Each `.timeline` file is a packaged timeline (data, notes, and images).',
      '',
      'Viewer links only work while this repository is public.',
      '',
      '| Timeline | View | Last changed |',
      '| --- | --- | --- |',
      ...rows,
      '',
    ];
    await fsp.writeFile(path.join(this.repoDir, 'README.md'), lines.join('\n'), 'utf8');
  }
}

function createEngine(opts) {
  return new GitSyncEngine(opts);
}

module.exports = {
  createEngine,
  GitSyncEngine,
  summarizePackageDiff,
  isConflictCopyPath,
};
