// gitSync engine tests against a real local bare repo (no GitHub): export
// pass, delete tracking, commit summaries, reconcile with conflict copies,
// and the import pass, using two fake machine libraries A and B.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fsp = require('node:fs/promises');
const { spawnSync } = require('node:child_process');
const { createGitHttpServer } = require('./gitHttpServer.cjs');
const { createEngine, summarizePackageDiff, isConflictCopyPath } = require('../electron/gitSync.cjs');
const { buildPackage, readPackage, strToU8 } = require('../electron/timelinePackage.cjs');

const runGit = (args, cwd) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
};

// In-memory stand-in for the library ops main.cjs will inject
function makeLibrary() {
  const timelines = new Map(); // uid -> { uid, relativeId, title, elements, notes, assets, neverSync }
  const lib = {
    timelines,
    add(t) {
      timelines.set(t.uid, { title: t.uid, elements: [], notes: {}, assets: {}, ...t });
    },
    get(uid) {
      return timelines.get(uid);
    },
    byRelId(relId) {
      return [...timelines.values()].find((t) => t.relativeId === relId);
    },
    ops: {
      listTimelines: async () => [...timelines.values()]
        .map(({ uid, relativeId, neverSync }) => ({ uid, relativeId, neverSync })),
      buildPackageForTimeline: async ({ uid }) => {
        const t = timelines.get(uid);
        const data = { file: { uid: t.uid, title: t.title }, elements: t.elements };
        const files = {};
        for (const [k, v] of Object.entries(t.assets)) files[`assets/${k}`] = v;
        for (const [k, v] of Object.entries(t.notes)) files[`notes/${k}`] = strToU8(v);
        return buildPackage(JSON.stringify(data, null, 2), files, { deterministic: true });
      },
      importPackage: async (buf, opts = {}) => {
        const pkg = readPackage(buf);
        const data = JSON.parse(pkg.timelineJson);
        let uid = data.file.uid;
        const existing = timelines.get(uid);
        const record = {
          uid,
          relativeId: opts.preferredRelId || (existing ? existing.relativeId : uid),
          title: data.file.title,
          elements: data.elements,
          notes: pkg.notes,
          assets: pkg.assets,
        };
        if (existing && opts.resolution === 'copy') {
          let candidate;
          let n = 1;
          do {
            candidate = `${uid}-copy${n > 1 ? `-${n}` : ''}`;
            n += 1;
          } while (timelines.has(candidate));
          uid = candidate;
          record.uid = uid;
          record.title = `${record.title || ''}${opts.titleSuffix ?? ' (Copy)'}`;
        } else if (existing && opts.resolution !== 'overwrite' && opts.resolution !== 'open-existing') {
          return { success: false, conflict: true };
        }
        timelines.set(uid, record);
        return { success: true, id: record.relativeId, uid, imported: true };
      },
      removeLocalTimeline: async (uid) => {
        timelines.delete(uid);
      },
    },
  };
  return lib;
}

async function makeCtx(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'tl-gitsync-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }).catch(() => {}));
  const remoteDir = path.join(root, 'remote.git');
  runGit(['init', '--bare', '--initial-branch=main', remoteDir], root);
  const server = createGitHttpServer(root);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/remote.git`;
  const remoteFiles = () => runGit(['--git-dir', remoteDir, 'ls-tree', '-r', '--name-only', 'main'], root)
    .trim().split('\n').filter(Boolean);
  const lastMessage = () => runGit(['--git-dir', remoteDir, 'log', '-1', '--format=%B', 'main'], root);
  const mergeCount = () => runGit(['--git-dir', remoteDir, 'rev-list', '--merges', '--count', 'main'], root).trim();
  return { root, remoteDir, url, server, remoteFiles, lastMessage, mergeCount };
}

function makeEngine(ctx, name, lib, extra = {}) {
  return createEngine({
    repoDir: path.join(ctx.root, `${name}-mirror`),
    statePath: path.join(ctx.root, `${name}-state.json`),
    ...lib.ops,
    machineLabel: name,
    author: { name, email: `${name}@test.local` },
    autoSync: false,
    ...extra,
  });
}

test('summarizePackageDiff reports element, note, and asset changes', () => {
  const mk = (elements, notes) => buildPackage(
    JSON.stringify({ file: { uid: 'x', title: 'World' }, elements }, null, 2),
    Object.fromEntries(Object.entries(notes).map(([k, v]) => [`notes/${k}`, strToU8(v)])),
    { deterministic: true }
  );
  const oldBuf = mk([{ id: 1, title: 'Battle' }, { id: 2, title: 'Gone' }], { 'a.md': 'old' });
  const newBuf = mk([{ id: 1, title: 'Battle of X' }, { id: 3, title: 'New' }], { 'a.md': 'new' });
  const summary = summarizePackageDiff(oldBuf, newBuf);
  assert.match(summary, /\+1 element/);
  assert.match(summary, /-1 element/);
  assert.match(summary, /renamed "Battle of X"/);
  assert.match(summary, /1 note edited/);
  assert.equal(summarizePackageDiff(oldBuf, oldBuf), null);
});

test('connect exports the library to an empty remote', async (t) => {
  const ctx = await makeCtx(t);
  const libA = makeLibrary();
  libA.add({ uid: 'alpha', relativeId: 'alpha', title: 'Alpha', elements: [{ id: 1, title: 'One' }], notes: { 'alpha.md': '# Alpha' } });
  libA.add({ uid: 'beta', relativeId: 'folder/beta', title: 'Beta' });
  const A = makeEngine(ctx, 'machine-a', libA);
  await A.init();
  await A.connect({ url: ctx.url, owner: 'someone', repo: 'timelines-sync', branch: 'main' });

  const files = ctx.remoteFiles();
  assert.ok(files.includes('alpha.timeline'));
  assert.ok(files.includes('folder/beta.timeline'));
  assert.ok(files.includes('README.md'));
  assert.ok(files.includes('.gitattributes'));
  assert.match(ctx.lastMessage(), /Update 2 timelines \(machine-a\)/);
  assert.equal(A.getStatus().state, 'idle');

  // Unchanged library, second pass: byte-identical exports, no new commit
  const before = runGit(['--git-dir', ctx.remoteDir, 'rev-parse', 'main'], ctx.root);
  await A.syncNow({ full: true });
  assert.equal(runGit(['--git-dir', ctx.remoteDir, 'rev-parse', 'main'], ctx.root), before);
});

test('second machine connect imports the remote library', async (t) => {
  const ctx = await makeCtx(t);
  const libA = makeLibrary();
  libA.add({ uid: 'alpha', relativeId: 'alpha', title: 'Alpha', elements: [{ id: 1, title: 'One' }], notes: { 'alpha.md': '# Alpha' } });
  const A = makeEngine(ctx, 'machine-a', libA);
  await A.init();
  await A.connect({ url: ctx.url, branch: 'main' });

  const libB = makeLibrary();
  const B = makeEngine(ctx, 'machine-b', libB);
  await B.init();
  await B.connect({ url: ctx.url, branch: 'main' });

  const got = libB.get('alpha');
  assert.ok(got);
  assert.equal(got.title, 'Alpha');
  assert.equal(got.relativeId, 'alpha');
  assert.equal(got.notes['alpha.md'], '# Alpha');
});

test('edits propagate with commit body summaries', async (t) => {
  const ctx = await makeCtx(t);
  const libA = makeLibrary();
  const libB = makeLibrary();
  libA.add({ uid: 'alpha', relativeId: 'alpha', title: 'Alpha', elements: [{ id: 1, title: 'One' }] });
  const A = makeEngine(ctx, 'machine-a', libA);
  const B = makeEngine(ctx, 'machine-b', libB);
  await A.init();
  await B.init();
  await A.connect({ url: ctx.url, branch: 'main' });
  await B.connect({ url: ctx.url, branch: 'main' });

  libA.get('alpha').elements.push({ id: 2, title: 'Battle of X' });
  A.markDirty('alpha');
  await A.syncNow();
  assert.match(ctx.lastMessage(), /Update 1 timeline \(machine-a\)/);
  assert.match(ctx.lastMessage(), /alpha: \+1 element/);

  await B.syncNow();
  assert.equal(libB.get('alpha').elements.length, 2);
});

test('renames move the mirror file and follow on other machines', async (t) => {
  const ctx = await makeCtx(t);
  const libA = makeLibrary();
  const libB = makeLibrary();
  libA.add({ uid: 'alpha', relativeId: 'alpha', title: 'Alpha' });
  const A = makeEngine(ctx, 'machine-a', libA);
  const B = makeEngine(ctx, 'machine-b', libB);
  await A.init();
  await B.init();
  await A.connect({ url: ctx.url, branch: 'main' });
  await B.connect({ url: ctx.url, branch: 'main' });

  libA.get('alpha').relativeId = 'worlds/alpha';
  A.markStructureDirty();
  await A.syncNow();
  const files = ctx.remoteFiles();
  assert.ok(files.includes('worlds/alpha.timeline'));
  assert.ok(!files.includes('alpha.timeline'));

  await B.syncNow();
  assert.equal(libB.get('alpha').relativeId, 'worlds/alpha');
  assert.equal(libB.timelines.size, 1);
});

test('local deletions propagate to other machines', async (t) => {
  const ctx = await makeCtx(t);
  const libA = makeLibrary();
  const libB = makeLibrary();
  libA.add({ uid: 'alpha', relativeId: 'alpha', title: 'Alpha' });
  libA.add({ uid: 'beta', relativeId: 'beta', title: 'Beta' });
  const A = makeEngine(ctx, 'machine-a', libA);
  const B = makeEngine(ctx, 'machine-b', libB);
  await A.init();
  await B.init();
  await A.connect({ url: ctx.url, branch: 'main' });
  await B.connect({ url: ctx.url, branch: 'main' });
  assert.ok(libB.get('beta'));

  libA.timelines.delete('beta');
  await A.syncNow();
  assert.ok(!ctx.remoteFiles().includes('beta.timeline'));
  assert.match(ctx.lastMessage(), /beta: deleted/);

  await B.syncNow();
  assert.ok(!libB.get('beta'));
  assert.ok(libB.get('alpha'));
});

test('divergent edits keep both versions via a conflict copy, history stays linear', async (t) => {
  const ctx = await makeCtx(t);
  const libA = makeLibrary();
  const libB = makeLibrary();
  libA.add({ uid: 'alpha', relativeId: 'alpha', title: 'Alpha', elements: [{ id: 1, title: 'Base' }] });
  const A = makeEngine(ctx, 'machine-a', libA, { now: () => new Date('2026-07-05T12:00:00Z') });
  const B = makeEngine(ctx, 'machine-b', libB, { now: () => new Date('2026-07-05T12:00:00Z') });
  await A.init();
  await B.init();
  await A.connect({ url: ctx.url, branch: 'main' });
  await B.connect({ url: ctx.url, branch: 'main' });

  libA.get('alpha').elements[0].title = 'A version';
  A.markDirty('alpha');
  await A.syncNow();

  libB.get('alpha').elements[0].title = 'B version';
  B.markDirty('alpha');
  await B.syncNow();

  // Remote won the path; B kept its own version as a badged conflict copy
  const files = ctx.remoteFiles();
  const copyPath = files.find((f) => isConflictCopyPath(f));
  assert.ok(copyPath, `expected a conflict copy in ${files}`);
  assert.match(copyPath, /alpha-conflict-20260705-machine-b\.timeline/);
  assert.equal(libB.get('alpha').elements[0].title, 'A version');
  const copyB = [...libB.timelines.values()].find((x) => x.uid !== 'alpha');
  assert.ok(copyB);
  assert.equal(copyB.elements[0].title, 'B version');
  assert.match(copyB.title, /conflicted copy/);
  assert.ok(B.getStatus().conflictCopies.length > 0);

  // A pulls the copy as a brand-new timeline; its own version stays put
  await A.syncNow();
  assert.equal(libA.get('alpha').elements[0].title, 'A version');
  const copyA = [...libA.timelines.values()].find((x) => x.uid !== 'alpha');
  assert.ok(copyA);
  assert.equal(copyA.elements[0].title, 'B version');

  assert.equal(ctx.mergeCount(), '0');
});

test('excluded paths are not exported, imported, or deleted', async (t) => {
  const ctx = await makeCtx(t);
  const libA = makeLibrary();
  const libB = makeLibrary();
  libA.add({ uid: 'alpha', relativeId: 'alpha', title: 'Alpha' });
  libA.add({ uid: 'secret', relativeId: 'private/secret', title: 'Secret' });
  const A = makeEngine(ctx, 'machine-a', libA);
  const B = makeEngine(ctx, 'machine-b', libB);
  await A.init();
  await B.init();
  await A.connect({ url: ctx.url, branch: 'main' });

  // B excludes the timeline: the package stays remote-only on B
  await B.connect({ url: ctx.url, branch: 'main' });
  B.setExcludedPaths(['private/secret']);
  await B.syncNow({ full: true });
  assert.ok(libB.get('alpha'));

  // A excluding after the fact stops exports but leaves the pushed package
  A.setExcludedPaths(['private/secret']);
  libA.get('secret').title = 'Changed while excluded';
  A.markDirty('secret');
  await A.syncNow();
  assert.ok(ctx.remoteFiles().includes('private/secret.timeline'));

  // Deleting the excluded timeline locally must not delete it from the repo
  libA.timelines.delete('secret');
  await A.syncNow();
  assert.ok(ctx.remoteFiles().includes('private/secret.timeline'));
});

test('a folder and a same-named timeline are excluded independently', async (t) => {
  const ctx = await makeCtx(t);
  const libA = makeLibrary();
  // "test" is both a timeline (test.timeline) and a folder (test/) holding "test/child"
  libA.add({ uid: 'test-file', relativeId: 'test', title: 'Test' });
  libA.add({ uid: 'test-child', relativeId: 'test/child', title: 'Child' });
  const A = makeEngine(ctx, 'machine-a', libA);
  await A.init();
  await A.connect({ url: ctx.url, branch: 'main' });
  await A.syncNow({ full: true });
  assert.ok(ctx.remoteFiles().includes('test.timeline'));
  assert.ok(ctx.remoteFiles().includes('test/child.timeline'));

  // Exclude only the timeline "test", then delete both locally. The excluded
  // timeline stays in the repo, but "test/child" is not aliased by the folder
  // path "test", so its deletion still propagates.
  A.setExcludedPaths(['test']);
  libA.timelines.delete('test-file');
  libA.timelines.delete('test-child');
  await A.syncNow();
  assert.ok(ctx.remoteFiles().includes('test.timeline'));
  assert.ok(!ctx.remoteFiles().includes('test/child.timeline'));
});

test('neverSync timelines never reach the repo', async (t) => {
  const ctx = await makeCtx(t);
  const libA = makeLibrary();
  libA.add({ uid: 'alpha', relativeId: 'alpha', title: 'Alpha' });
  libA.add({ uid: 'diary', relativeId: 'diary', title: 'Diary', neverSync: true });
  const A = makeEngine(ctx, 'machine-a', libA);
  await A.init();
  await A.connect({ url: ctx.url, branch: 'main' });
  assert.ok(!ctx.remoteFiles().includes('diary.timeline'));
  await A.syncNow({ full: true });
  assert.ok(!ctx.remoteFiles().includes('diary.timeline'));
});

test('connecting over a remote that already has the same uid keeps both versions', async (t) => {
  const ctx = await makeCtx(t);
  const libA = makeLibrary();
  const libB = makeLibrary();
  libA.add({ uid: 'alpha', relativeId: 'alpha', title: 'Alpha', elements: [{ id: 1, title: 'Remote version' }] });
  libB.add({ uid: 'alpha', relativeId: 'alpha', title: 'Alpha', elements: [{ id: 1, title: 'Local version' }] });
  const A = makeEngine(ctx, 'machine-a', libA);
  const B = makeEngine(ctx, 'machine-b', libB, { now: () => new Date('2026-07-05T12:00:00Z') });
  await A.init();
  await B.init();
  await A.connect({ url: ctx.url, branch: 'main' });
  await B.connect({ url: ctx.url, branch: 'main' });

  assert.equal(libB.get('alpha').elements[0].title, 'Remote version');
  const copy = [...libB.timelines.values()].find((x) => x.uid !== 'alpha');
  assert.ok(copy);
  assert.equal(copy.elements[0].title, 'Local version');
  assert.ok(ctx.remoteFiles().some((f) => isConflictCopyPath(f)));
});

test('offline edits are kept locally and pushed when the remote returns', async (t) => {
  const ctx = await makeCtx(t);
  const libA = makeLibrary();
  libA.add({ uid: 'alpha', relativeId: 'alpha', title: 'Alpha', elements: [{ id: 1, title: 'One' }] });
  const A = makeEngine(ctx, 'machine-a', libA);
  await A.init();
  await A.connect({ url: ctx.url, branch: 'main' });

  const port = ctx.server.address().port;
  await new Promise((resolve) => ctx.server.close(resolve));
  libA.get('alpha').elements.push({ id: 2, title: 'Offline edit' });
  A.markDirty('alpha');
  const status = await A.syncNow();
  assert.equal(status.state, 'offline');

  await new Promise((resolve) => ctx.server.listen(port, '127.0.0.1', resolve));
  const after = await A.syncNow();
  assert.equal(after.state, 'idle');
  assert.match(ctx.lastMessage(), /alpha: \+1 element/);
});

test('shareInfo builds viewer links and reports pending local changes', async (t) => {
  const ctx = await makeCtx(t);
  const libA = makeLibrary();
  libA.add({ uid: 'alpha', relativeId: 'alpha', title: 'Alpha' });
  let visibilityStatus = 200;
  const A = makeEngine(ctx, 'machine-a', libA, {
    fetch: async () => ({ status: visibilityStatus, json: async () => ({}) }),
  });
  await A.init();
  await A.connect({ url: ctx.url, branch: 'main' });

  A.state.url = 'https://github.com/sreegjl/timelines-sync.git';
  const clean = await A.shareInfo('alpha');
  assert.equal(clean.canShareViewer, true);
  assert.equal(clean.isPublic, true);
  assert.equal(clean.pending, false);
  assert.match(clean.viewerUrl, /viewer\/gh\/sreegjl\/timelines-sync\/main\/alpha\.timeline$/);
  assert.ok(clean.exactViewerUrl);

  visibilityStatus = 404;
  libA.get('alpha').title = 'Alpha changed';
  A.markDirty('alpha');
  const pending = await A.shareInfo('alpha');
  assert.equal(pending.pending, true);
  assert.equal(pending.isPublic, false);
});

test('fileHistory lists commits and restoreVersion imports a copy', async (t) => {
  const ctx = await makeCtx(t);
  const libA = makeLibrary();
  libA.add({ uid: 'alpha', relativeId: 'alpha', title: 'Alpha', elements: [{ id: 1, title: 'Base' }] });
  const A = makeEngine(ctx, 'machine-a', libA);
  await A.init();
  await A.connect({ url: ctx.url, branch: 'main' });

  libA.get('alpha').elements.push({ id: 2, title: 'Second' });
  A.markDirty('alpha');
  await A.syncNow();

  const history = await A.fileHistory('alpha');
  assert.ok(history.entries.length >= 2);
  assert.match(history.entries[0].subject, /Update 1 timeline|Update 1 timelines/);
  assert.match(history.entries[0].summary || '', /\+1 element/);

  const oldest = history.entries[history.entries.length - 1];
  const restored = await A.restoreVersion('alpha', oldest.oid);
  assert.equal(restored.success, true);
  assert.equal(libA.timelines.size, 2);
  const copy = [...libA.timelines.values()].find((entry) => entry.uid !== 'alpha');
  assert.ok(copy);
  assert.match(copy.title, /\(Restored\)$/);
  assert.equal(A.getStatus().state, 'dirty');
});

test('a hand-written README is never rewritten or removed', async (t) => {
  const ctx = await makeCtx(t);
  const libA = makeLibrary();
  libA.add({ uid: 'alpha', relativeId: 'alpha', title: 'Alpha' });
  const A = makeEngine(ctx, 'machine-a', libA);
  await A.init();
  await A.connect({ url: ctx.url, branch: 'main' });

  const readmePath = path.join(ctx.root, 'machine-a-mirror', 'README.md');
  assert.match(await fsp.readFile(readmePath, 'utf8'), /<!-- generated by Timelines -->/);

  // Own README survives a pass that changes the timeline set
  await fsp.writeFile(readmePath, '# My own notes\n', 'utf8');
  libA.add({ uid: 'beta', relativeId: 'beta', title: 'Beta' });
  A.markStructureDirty();
  await A.syncNow({ full: true });
  assert.equal(await fsp.readFile(readmePath, 'utf8'), '# My own notes\n');
  assert.ok(ctx.remoteFiles().includes('beta.timeline'));

  // ...and turning generation off must not delete it either
  await A.updateSettings({ writeReadme: false });
  await A.syncNow({ full: true });
  assert.equal(await fsp.readFile(readmePath, 'utf8'), '# My own notes\n');
  assert.ok(ctx.remoteFiles().includes('README.md'));
});

test('turning off README generation removes the generated one', async (t) => {
  const ctx = await makeCtx(t);
  const libA = makeLibrary();
  libA.add({ uid: 'alpha', relativeId: 'alpha', title: 'Alpha' });
  const A = makeEngine(ctx, 'machine-a', libA);
  await A.init();
  await A.connect({ url: ctx.url, branch: 'main' });
  assert.ok(ctx.remoteFiles().includes('README.md'));

  await A.updateSettings({ writeReadme: false });
  await A.syncNow({ full: true });
  assert.ok(!ctx.remoteFiles().includes('README.md'));

  // Off stays off even when the timeline set changes
  libA.add({ uid: 'beta', relativeId: 'beta', title: 'Beta' });
  A.markStructureDirty();
  await A.syncNow({ full: true });
  assert.ok(!ctx.remoteFiles().includes('README.md'));
});

test('a README generated before the marker is still adopted', async (t) => {
  const ctx = await makeCtx(t);
  const libA = makeLibrary();
  libA.add({ uid: 'alpha', relativeId: 'alpha', title: 'Alpha' });
  const A = makeEngine(ctx, 'machine-a', libA);
  await A.init();
  await A.connect({ url: ctx.url, branch: 'main' });

  const readmePath = path.join(ctx.root, 'machine-a-mirror', 'README.md');
  await fsp.writeFile(readmePath, '# Timelines library\n\nold table\n', 'utf8');
  libA.add({ uid: 'beta', relativeId: 'beta', title: 'Beta' });
  A.markStructureDirty();
  await A.syncNow({ full: true });

  const readme = await fsp.readFile(readmePath, 'utf8');
  assert.match(readme, /<!-- generated by Timelines -->/);
  assert.doesNotMatch(readme, /old table/);
});
