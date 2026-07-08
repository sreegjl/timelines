import { useState, useEffect, useRef, useMemo } from "react";
import { File, FilePlus, Copy, Trash2, Settings, ArrowLeft, Folder, FolderPlus, FolderOpen, Store, X, LayoutGrid, List, MoreVertical, Pencil, RotateCcw, ArrowUpAZ, ArrowDownAZ, Clock, ChevronRight, Search, Import, Cloud, CloudOff, RefreshCw, AlertTriangle, CheckCircle2, Share2, History, Link2, ExternalLink } from "lucide-react";
import { createFolder, listFolders, moveTimeline, renameFolder, updateTimelineTitle, deleteFolder, moveFolder } from "../utils/electronApi.js";
import { generateIdFromTitle, generateStorageUid } from "../utils/idUtils.js";
import { getAppSettings, saveAppSettings } from "../utils/appSettings.js";

function MovePicker({ folders, currentFolder, onConfirm, onCancel }) {
  const [dest, setDest] = useState(null);
  return (
    <div className="folder-modal folder-modal-pick" onClick={(e) => e.stopPropagation()}>
      <FolderTree folders={folders} currentFolder={currentFolder} selected={dest} onSelect={setDest} />
      <div className="folder-modal-actions">
        <button className="folder-modal-btn" onClick={onCancel}>Cancel</button>
        <button className="folder-modal-btn folder-modal-btn-primary" disabled={dest === null} onClick={() => onConfirm(dest)}>OK</button>
      </div>
    </div>
  );
}

function FolderTree({ folders, currentFolder, selected, onSelect }) {
  const [collapsed, setCollapsed] = useState({});

  const toggle = (path) => setCollapsed(prev => ({ ...prev, [path]: !prev[path] }));

  const hasChildren = (path) => folders.some(f => f.startsWith(path + '/') && f.split('/').length === path.split('/').length + 1);

  const renderLevel = (parentPath, depth) => {
    const prefix = parentPath ? parentPath + '/' : '';
    const items = folders.filter(f => {
      const parts = f.split('/');
      const parentParts = parentPath ? parentPath.split('/') : [];
      return parts.length === parentParts.length + 1 && f.startsWith(prefix);
    });

    return items.map((f) => {
      const label = f.split('/').pop();
      const isOpen = !collapsed[f];
      const children = hasChildren(f);
      return (
        <div key={f}>
          <div className={`timeline-folder-option${selected === f ? ' is-selected' : ''}${currentFolder === f ? ' is-current' : ''}`} style={{ paddingLeft: 8 + depth * 16 }}>
            <button
              type="button"
              className="folder-tree-toggle"
              onClick={() => children && toggle(f)}
              style={{ visibility: children ? 'visible' : 'hidden' }}
              aria-label={isOpen ? 'Collapse' : 'Expand'}
            >
              <ChevronRight size={11} style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} />
            </button>
            <button type="button" className="folder-tree-label" onClick={() => onSelect(f)}>
              <Folder size={13} />
              <span>{label}</span>
            </button>
          </div>
          {children && isOpen && renderLevel(f, depth + 1)}
        </div>
      );
    });
  };

  return (
    <div className="timeline-folder-list">
      <div className={`timeline-folder-option${selected === '' ? ' is-selected' : ''}${currentFolder === '' ? ' is-current' : ''}`} style={{ paddingLeft: 8 }}>
        <span className="folder-tree-toggle" style={{ visibility: 'hidden' }} />
        <button type="button" className="folder-tree-label" onClick={() => onSelect('')}>
          <Folder size={13} />
          <span>Home</span>
        </button>
      </div>
      {renderLevel('', 0)}
    </div>
  );
}

function relativeTime(ms) {
  if (!ms) return null;
  const days = Math.floor((Date.now() - ms) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "1 week ago";
  return `${Math.floor(days / 7)} weeks ago`;
}

const isConflictCopyId = (value) => /-conflict-\d{8}-[\w.-]+(?:-\d+)?$/i.test(String(value || ""));

function formatSyncTime(value) {
  if (!value) return "Not synced yet";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return "Not synced yet";
  return `Synced ${relativeTime(ms)}`;
}

function formatDateTime(value) {
  if (!value) return "";
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleString();
}

function formatMirrorBytes(n) {
  if (n == null) return "";
  const kb = 1024;
  const mb = kb * 1024;
  const gb = mb * 1024;
  if (n >= gb) return `${(n / gb).toFixed(1)} GB`;
  if (n >= mb) return `${(n / mb).toFixed(1)} MB`;
  if (n >= kb) return `${(n / kb).toFixed(1)} KB`;
  return `${n} B`;
}

function buildSyncTree(files) {
  const root = { type: "folder", id: "", label: "Library", children: [], sortKey: "" };
  const folderMap = new Map([["", root]]);
  const sorted = [...files]
    .filter((file) => !file.isPackage)
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const file of sorted) {
    const parts = String(file.id || "").split("/");
    let parentId = "";
    for (let i = 0; i < parts.length - 1; i += 1) {
      const folderId = parts.slice(0, i + 1).join("/");
      if (!folderMap.has(folderId)) {
        const folderNode = {
          type: "folder",
          id: folderId,
          label: parts[i],
          children: [],
          sortKey: folderId,
        };
        folderMap.set(folderId, folderNode);
        folderMap.get(parentId).children.push(folderNode);
      }
      parentId = folderId;
    }
    folderMap.get(parentId).children.push({
      type: "timeline",
      id: file.id,
      label: file.name,
      sortKey: file.id,
      conflict: isConflictCopyId(file.id),
      neverSync: Boolean(file.neverSync),
    });
  }

  const sortNode = (node) => {
    node.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
      return a.sortKey.localeCompare(b.sortKey);
    });
    node.children.forEach((child) => {
      if (child.type === "folder") sortNode(child);
    });
  };
  sortNode(root);
  return root;
}
import NewTimelineModal from "./NewTimelineModal";
import "../styles/02-homepage.css";
import "../styles/07-modals-menus.css";
import themeConfig from "../config/theme.json";
import { loadThemeConfig } from "../utils/themeLoader";
import { DEFAULT_KEYBINDS, cloneDefaultKeybinds, saveKeybinds } from "../utils/keybinds";
import MarketplaceModal from "./MarketplaceModal";

export default function HomePage({
  settingsOnly = false,
  reuseExistingBackdrop = false,
  onSelectTimeline,
  onRenameTimeline,
  onTimelineRenamed,
  onCreateTimeline,
  onImportTimeline,
  appThemeKey,
  appFontFamily,
  appFontSize,
  fonts,
  themes,
  onAppThemeChange,
  oldFormatThemeCount = 0,
  onMigrateOldThemes,
  onAppFontChange,
  onAppFontSizeChange,
  timelineStorageDir,
  notesStorageDir,
  assetsStorageDir,
  onAssetsStorageDirChange,
  onTimelineStorageDirChange,
  onNotesStorageDirChange,
  onPickTimelinesDir,
  onPickNotesDir,
  onPickAssetsDir,
  onOpenFontsFolder,
  onOpenTimelinesFolder,
  onOpenNotesFolder,
  onOpenAssetsFolder,
  hardwareAcceleration = true,
  onHardwareAccelerationChange,
  startMaximized = false,
  onStartMaximizedChange,
  onRefreshThemes,
  openSettingsSignal = 0,
  onAppSettingsClosed,
  keybinds = cloneDefaultKeybinds(),
  onKeybindsChange,
}) {
  const [timelineFiles, setTimelineFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isNewTimelineModalOpen, setIsNewTimelineModalOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [view, setView] = useState(settingsOnly ? "settings" : "home");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState("list");
  const [sortMode, setSortMode] = useState("date");
  useEffect(() => { getAppSettings().then(s => { if (s.homeSortMode) setSortMode(s.homeSortMode); }); }, []);
  const [currentFolder, setCurrentFolder] = useState("");
  const [allFolders, setAllFolders] = useState([]);
  const [newFolderDialogOpen, setNewFolderDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [moveDialogFile, setMoveDialogFile] = useState(null);
  const [availableFolders, setAvailableFolders] = useState([]);
  const [renameTarget, setRenameTarget] = useState(null);
  const [renameName, setRenameName] = useState("");
  const [renameError, setRenameError] = useState("");
  const [folderContextMenu, setFolderContextMenu] = useState(null);
  const [deleteFolderTarget, setDeleteFolderTarget] = useState(null);
  const [moveFolderTarget, setMoveFolderTarget] = useState(null);
  const [showAllFolders, setShowAllFolders] = useState(false);
  const [isMarketplaceOpen, setIsMarketplaceOpen] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [deleteDialogFile, setDeleteDialogFile] = useState(null);
  const [deleteDialogWithNotes, setDeleteDialogWithNotes] = useState(false);
  const [deleteDialogWithAssets, setDeleteDialogWithAssets] = useState(false);
  const [settingsSection, setSettingsSection] = useState("general");
  const [updateStatus, setUpdateStatus] = useState(null); // null | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error' | 'dev'
  const [themeMigrationStatus, setThemeMigrationStatus] = useState(null); // null | 'migrating' | { count }
  const [gitSyncStatus, setGitSyncStatus] = useState(null);
  const [gitSyncRemoteUrl, setGitSyncRemoteUrl] = useState("");
  const [gitSyncPat, setGitSyncPat] = useState("");
  const [gitSyncBranch, setGitSyncBranch] = useState("main");
  const [gitSyncAuto, setGitSyncAuto] = useState(true);
  const [gitSyncIntervalMinutes, setGitSyncIntervalMinutes] = useState(5);
  const [gitSyncMachineLabel, setGitSyncMachineLabel] = useState("");
  const [gitSyncBusy, setGitSyncBusy] = useState("");
  const [gitSyncError, setGitSyncError] = useState("");
  const [gitSyncShareDialog, setGitSyncShareDialog] = useState(null);
  const [gitSyncHistoryDialog, setGitSyncHistoryDialog] = useState(null);
  const [gitSyncMirrorBytes, setGitSyncMirrorBytes] = useState(null);
  const [recordingKey, setRecordingKey] = useState(null);
  const recordingKeyRef = useRef(null);
  const renameInputRef = useRef(null);
  const previousViewRef = useRef("home");
  const menuRef = useRef(null);
  const defaultThemeKey = (themeConfig?.activeTheme || "").toLowerCase();
  const bundledThemes = useMemo(() => loadThemeConfig().themes, []);
  const bundledKeys = useMemo(
    () => new Set(Object.keys(bundledThemes || {}).map((key) => key.toLowerCase())),
    [bundledThemes]
  );

  const appThemes = useMemo(() => {
    const entries = Object.entries(themes || {}).filter(([key]) =>
      bundledKeys.has(key.toLowerCase())
    );
    return entries.sort(([aKey], [bKey]) => {
      const aLower = aKey.toLowerCase();
      const bLower = bKey.toLowerCase();
      if (aLower === "parchment_v2" && bLower !== "parchment_v2") return -1;
      if (aLower !== "parchment_v2" && bLower === "parchment_v2") return 1;
      const aIsDefault = aLower === defaultThemeKey;
      const bIsDefault = bLower === defaultThemeKey;
      if (aIsDefault && !bIsDefault) return -1;
      if (!aIsDefault && bIsDefault) return 1;
      return aKey.localeCompare(bKey);
    });
  }, [themes, bundledKeys, defaultThemeKey]);

  const userThemes = useMemo(() => {
    const entries = Object.entries(themes || {}).filter(
      ([key]) => !bundledKeys.has(key.toLowerCase())
    );
    return entries.sort(([aKey], [bKey]) => aKey.localeCompare(bKey));
  }, [themes, bundledKeys]);

  const userThemeIds = useMemo(
    () => new Set(userThemes.map(([key]) => key.toLowerCase())),
    [userThemes]
  );

  const availableFonts = useMemo(() => {
    const seen = new Set();
    const list = [];
    (fonts || []).forEach((font) => {
      const name = font?.name?.trim();
      if (!name || seen.has(name)) return;
      seen.add(name);
      list.push(name);
    });
    return list.sort((a, b) => a.localeCompare(b));
  }, [fonts]);

  const fontOptions = useMemo(() => {
    const options = [
      { value: "default", label: "Default (Theme)" },
      { value: "Inter", label: "Inter" },
    ];
    availableFonts.forEach((name) => {
      options.push({ value: name, label: name });
    });
    const values = new Set(options.map((option) => option.value));
    if (appFontFamily && !values.has(appFontFamily)) {
      options.unshift({
        value: appFontFamily,
        label: `${appFontFamily} (Missing)`,
      });
    }
    return options;
  }, [availableFonts, appFontFamily]);

  const getPathIssue = (value) => {
    if (!value) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const isAbsolute =
      /^[a-zA-Z]:[\\/]/.test(trimmed) ||
      trimmed.startsWith("\\\\") ||
      trimmed.startsWith("/");
    if (!isAbsolute) return "Path should be absolute.";
    const isDrivePath = /^[a-zA-Z]:[\\/]/.test(trimmed);
    const pathToCheck = isDrivePath ? trimmed.slice(2) : trimmed;
    const hasInvalidChar = [...pathToCheck].some((char) => {
      const code = char.charCodeAt(0);
      return '<>:"|?*'.includes(char) || code <= 31;
    });
    if (hasInvalidChar) {
      return "Path contains invalid characters.";
    }
    if (/[. ]$/.test(trimmed)) {
      return "Path cannot end with a dot or space.";
    }
    return null;
  };

  const timelinePathIssue = getPathIssue(timelineStorageDir);
  const notesPathIssue = getPathIssue(notesStorageDir);

  const applyGitSyncStatus = (status) => {
    setGitSyncStatus(status);
    if (status?.machineLabel) setGitSyncMachineLabel(status.machineLabel);
    if (typeof status?.autoSync === "boolean") setGitSyncAuto(status.autoSync);
    if (Number.isFinite(status?.debounceMs)) {
      setGitSyncIntervalMinutes(Math.max(1, Math.round(status.debounceMs / 60000)));
    }
    if (status?.repo) {
      setGitSyncRemoteUrl(status.repo.url || "");
      setGitSyncBranch(status.repo.branch || "main");
    }
  };

  const loadGitSyncStatus = async () => {
    if (!window.electron?.gitSyncStatus) return;
    const result = await window.electron.gitSyncStatus();
    if (result?.success) {
      applyGitSyncStatus(result.status);
      setGitSyncError("");
    } else if (result?.error) {
      setGitSyncError(result.error);
    }
  };

  const saveGitSyncSettings = async (partial = {}) => {
    if (!window.electron?.gitSyncUpdateSettings) return;
    const payload = {
      autoSync: partial.autoSync ?? gitSyncAuto,
      intervalMinutes: partial.intervalMinutes ?? gitSyncIntervalMinutes,
      machineLabel: partial.machineLabel ?? gitSyncMachineLabel,
      excludedPaths: partial.excludedPaths,
      writeReadme: partial.writeReadme,
    };
    const result = await window.electron.gitSyncUpdateSettings(payload);
    if (result?.success) {
      applyGitSyncStatus(result.status);
      setGitSyncError("");
    } else if (result?.error) {
      setGitSyncError(result.error);
    }
  };

  useEffect(() => {
    if (openSettingsSignal > 0) {
      setView("settings");
      setSettingsSection("general");
    }
  }, [openSettingsSignal]);

  useEffect(() => {
    if (settingsSection === "sync" && gitSyncStatus?.repo) loadGitSyncMirrorSize();
  }, [settingsSection, gitSyncStatus?.repo]);

  useEffect(() => {
    if (!window.electron?.onUpdaterStatus) return;
    window.electron.onUpdaterStatus((data) => {
      setUpdateStatus(data.status);
    });
    return () => window.electron.offUpdaterStatus?.();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadSyncPrefs = async () => {
      const settings = await getAppSettings();
      if (cancelled) return;
      setGitSyncAuto(settings?.gitSyncAutoSync !== false);
      setGitSyncIntervalMinutes(Math.max(1, Number(settings?.gitSyncIntervalMinutes) || 5));
      setGitSyncMachineLabel(settings?.gitSyncMachineLabel || "");
      if (window.electron?.gitSyncStatus) {
        const result = await window.electron.gitSyncStatus();
        if (!cancelled && result?.success) {
          applyGitSyncStatus(result.status);
          setGitSyncError("");
        } else if (!cancelled && result?.error) {
          setGitSyncError(result.error);
        }
      }
    };
    loadSyncPrefs();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!window.electron?.onGitSyncState) return;
    const offState = window.electron.onGitSyncState((status) => {
      applyGitSyncStatus(status);
    });
    const offApplied = window.electron.onGitSyncApplied(() => {
      refreshLocal().catch(() => {});
    });
    return () => {
      offState?.();
      offApplied?.();
    };
  }, []);

  useEffect(() => {
    if (settingsOnly) {
      setView("settings");
      setSettingsSection("general");
    }
  }, [settingsOnly]);

  const restoreRenameFocus = () => {
    window.setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }, 0);
  };

  const closeRenameDialog = () => {
    setRenameTarget(null);
    setRenameName("");
    setRenameError("");
  };

  useEffect(() => { recordingKeyRef.current = recordingKey; }, [recordingKey]);

  useEffect(() => {
    if (!renameTarget) return;
    setRenameError("");
    restoreRenameFocus();
  }, [renameTarget]);

  useEffect(() => {
    const handler = (e) => {
      const id = recordingKeyRef.current;
      if (!id) return;
      if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      const parts = [];
      if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
      if (e.altKey) parts.push("Alt");
      if (e.shiftKey) parts.push("Shift");
      parts.push(e.key === " " ? "Space" : e.key.length === 1 ? e.key.toUpperCase() : e.key);
      const updated = { ...keybinds, [id]: { ...keybinds[id], keys: parts } };
      setRecordingKey(null);
      recordingKeyRef.current = null;
      onKeybindsChange?.(updated);
      saveKeybinds(updated);
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [keybinds, onKeybindsChange]);

  useEffect(() => {
    if (previousViewRef.current === "settings" && view !== "settings") {
      onAppSettingsClosed?.();
    }
    previousViewRef.current = view;
  }, [view, onAppSettingsClosed]);

  useEffect(() => {
    const loadTimelineList = async () => {
      if (window.electron?.listTimelines) {
        try {
          const files = await window.electron.listTimelines();
          setTimelineFiles(files.map(f => ({ ...f, storageType: 'local' })));
        } catch (error) {
          console.error('Failed to list timelines:', error);
          setTimelineFiles([]);
        }
      } else {
        console.warn("Timeline listing is only available in the desktop app.");
        setTimelineFiles([]);
      }
      if (window.electron?.listFolders) {
        try {
          const folders = await window.electron.listFolders();
          setAllFolders(folders);
        } catch { setAllFolders([]); }
      }
      setLoading(false);
    };

    loadTimelineList();
    setCurrentFolder("");
    setShowAllFolders(false);
  }, [timelineStorageDir]);

  // Close context menus when clicking outside
  useEffect(() => {
    if (!contextMenu && !folderContextMenu) return;
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setContextMenu(null);
        setFolderContextMenu(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [contextMenu, folderContextMenu]);

  const handleNewTimeline = () => {
    setIsNewTimelineModalOpen(true);
  };

  const handleCreateTimeline = async (timelineConfig) => {
    const result = await onCreateTimeline({ ...timelineConfig, folder: currentFolder || '' });
    if (result?.success) setIsNewTimelineModalOpen(false);
    return result;
  };

  const openTimelineFile = (file) => {
    if (file.isPackage) onImportTimeline?.(file.packagePath);
    else onSelectTimeline(file.id);
  };

  // preventDefault on window keeps Electron from navigating to dropped files
  useEffect(() => {
    if (settingsOnly) return undefined;
    const isFileDrag = (e) => Array.from(e.dataTransfer?.types || []).includes("Files");
    const onDragOver = (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      setIsDragOver(true);
    };
    const onDragLeave = (e) => {
      if (!e.relatedTarget) setIsDragOver(false);
    };
    const onDrop = (e) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer?.files?.[0];
      if (!file || !/\.(timeline|json)$/i.test(file.name)) return;
      const sourcePath = window.electron?.getPathForFile?.(file);
      if (sourcePath) onImportTimeline?.(sourcePath);
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [settingsOnly, onImportTimeline]);

  const handleContextMenu = (e, file) => {
    e.preventDefault();
    const nearRight = e.clientX > window.innerWidth / 2;
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      nearRight,
      file: file,
    });
  };

  const handleMenuAction = (action) => {
    setContextMenu(null);
    if (action) action();
  };

  const handleOpenMarketplace = () => {
    setIsMarketplaceOpen(true);
  };

  const handleMigrateOldThemes = async () => {
    if (!onMigrateOldThemes) return;
    setThemeMigrationStatus("migrating");
    const count = await onMigrateOldThemes();
    setThemeMigrationStatus({ count });
    setTimeout(() => setThemeMigrationStatus(null), 3000);
  };

  const handleDuplicate = async (file) => {
    try {
      if (!window.electron?.loadTimeline || !window.electron?.saveTimeline) {
        throw new Error("Duplicate is only available in the desktop app.");
      }
      // Load the original timeline
      const originalData = await window.electron.loadTimeline(file.id);

      const folderPrefix = file.id.includes('/') ? file.id.slice(0, file.id.lastIndexOf('/') + 1) : '';
      let duplicateData = null;
      for (let counter = 1; counter <= 50 && !duplicateData; counter++) {
        const duplicateName = `${file.name} Copy${counter > 1 ? ` ${counter}` : ''}`;
        const duplicateId = generateIdFromTitle(duplicateName, "timeline").replace(/^timeline-/, "");
        const candidateData = {
          ...originalData,
          file: {
            ...originalData.file,
            id: `${duplicateId}-timeline`,
            uid: generateStorageUid(duplicateId),
            title: duplicateName,
          },
        };
        const result = await window.electron.saveTimeline(candidateData, `${folderPrefix}${duplicateId}`, { create: true });
        if (result?.success) {
          duplicateData = candidateData;
        } else if (result?.error !== 'EXISTS') {
          throw new Error(result?.error || 'Save failed');
        }
      }
      if (!duplicateData) throw new Error('Could not find a free name for the copy');

      const sourceId = originalData.file?.uid || originalData.file?.id?.replace(/-timeline$/, '') || file.id.split('/').pop();
      if (window.electron?.copyTimelineStorage) {
        await window.electron.copyTimelineStorage({ sourceId, targetId: duplicateData.file.uid });
      }

      // Reload timeline list
      if (window.electron?.listTimelines) {
        const files = await window.electron.listTimelines();
        setTimelineFiles(files);
      }
    } catch (error) {
      console.error('Failed to duplicate timeline:', error);
      alert(`Failed to duplicate timeline: ${error.message}`);
    }
  };

  const refreshLocal = async () => {
    if (window.electron?.listTimelines) {
      const files = await window.electron.listTimelines();
      setTimelineFiles(files.map(f => ({ ...f, storageType: 'local' })));
    }
    if (window.electron?.listFolders) {
      const folders = await window.electron.listFolders();
      setAllFolders(folders);
    }
  };

  const handleConnectGitSyncRepo = async () => {
    if (!window.electron?.gitSyncConnect || !gitSyncRemoteUrl.trim() || !gitSyncPat.trim()) return;
    setGitSyncBusy("connect");
    setGitSyncError("");
    await saveGitSyncSettings({
      autoSync: gitSyncAuto,
      intervalMinutes: gitSyncIntervalMinutes,
      machineLabel: gitSyncMachineLabel,
    });
    const result = await window.electron.gitSyncConnect({
      remoteUrl: gitSyncRemoteUrl.trim(),
      branch: gitSyncBranch.trim() || "main",
      token: gitSyncPat.trim(),
    });
    setGitSyncBusy("");
    if (!result?.success) {
      setGitSyncError(result?.error || "Could not connect the repository.");
      return;
    }
    applyGitSyncStatus(result.status);
    setGitSyncPat("");
    await refreshLocal();
  };

  const handleGitSyncUpdateCredentials = async () => {
    if (!window.electron?.gitSyncUpdateCredentials || !gitSyncPat.trim()) return;
    setGitSyncBusy("update-token");
    setGitSyncError("");
    const result = await window.electron.gitSyncUpdateCredentials({
      token: gitSyncPat.trim(),
    });
    setGitSyncBusy("");
    if (!result?.success) {
      setGitSyncError(result?.error || "Could not update the personal access token.");
      return;
    }
    applyGitSyncStatus(result.status);
    setGitSyncPat("");
  };

  const handleGitSyncNow = async () => {
    if (!window.electron?.gitSyncNow) return;
    setGitSyncBusy("sync-now");
    const result = await window.electron.gitSyncNow();
    setGitSyncBusy("");
    if (result?.success) {
      applyGitSyncStatus(result.status);
      setGitSyncError("");
      await refreshLocal();
    } else {
      setGitSyncError(result?.error || "Sync failed.");
    }
  };

  const loadGitSyncMirrorSize = async () => {
    if (!window.electron?.gitSyncMirrorSize) return;
    const result = await window.electron.gitSyncMirrorSize();
    if (result?.success) setGitSyncMirrorBytes(result.bytes);
  };

  const handleGitSyncRebuild = async () => {
    if (!window.electron?.gitSyncRebuild) return;
    if (!window.confirm("Rebuild the local mirror? This deletes the mirror clone and re-exports your library. Your timelines are not affected.")) return;
    setGitSyncBusy("rebuild");
    setGitSyncError("");
    const result = await window.electron.gitSyncRebuild();
    setGitSyncBusy("");
    if (result?.success) {
      applyGitSyncStatus(result.status);
      await loadGitSyncMirrorSize();
      await refreshLocal();
    } else if (result?.error) {
      setGitSyncError(result.error);
    }
  };

  const handleGitSyncDisconnect = async () => {
    if (!window.confirm("Disconnect git sync from this device?")) return;
    const deleteMirror = window.confirm("Delete the local mirror clone too? Press OK to delete it, or Cancel to keep it.");
    setGitSyncBusy("disconnect");
    const result = await window.electron?.gitSyncDisconnect?.({ deleteMirror });
    setGitSyncBusy("");
    if (result?.success) {
      setGitSyncPat("");
      await loadGitSyncStatus();
    } else if (result?.error) {
      setGitSyncError(result.error);
    }
  };

  const loadGitSyncShareInfo = async (file) => {
    if (!window.electron?.gitSyncShareInfo || !file?.uid) {
      throw new Error("Share links are only available for synced local timelines.");
    }
    const result = await window.electron.gitSyncShareInfo({ uid: file.uid });
    if (!result?.success) {
      throw new Error(result?.error || "Could not load share info.");
    }
    return result.info;
  };

  const loadGitSyncHistory = async (file) => {
    if (!window.electron?.gitSyncFileHistory || !file?.uid) {
      throw new Error("Timeline history is only available for synced local timelines.");
    }
    const result = await window.electron.gitSyncFileHistory({ uid: file.uid });
    if (!result?.success) {
      throw new Error(result?.error || "Could not load timeline history.");
    }
    return result.history;
  };

  const copyText = async (text) => {
    if (!text) throw new Error("Nothing to copy.");
    if (!navigator.clipboard?.writeText) {
      throw new Error("Clipboard access is unavailable in this build.");
    }
    await navigator.clipboard.writeText(text);
  };

  const handleOpenGitSyncShare = async (file) => {
    setGitSyncShareDialog({ file, info: null, loading: true, error: "", copied: "" });
    try {
      const info = await loadGitSyncShareInfo(file);
      setGitSyncShareDialog({ file, info, loading: false, error: "", copied: "" });
    } catch (error) {
      setGitSyncShareDialog({ file, info: null, loading: false, error: error.message, copied: "" });
    }
  };

  const handleCopyGitSyncLink = async (kind) => {
    const url = gitSyncShareDialog?.info?.[kind];
    try {
      await copyText(url);
      setGitSyncShareDialog((current) => current ? { ...current, copied: kind } : current);
    } catch (error) {
      setGitSyncShareDialog((current) => current ? { ...current, error: error.message } : current);
    }
  };

  const handleSyncAndCopyGitSyncLink = async (kind) => {
    const file = gitSyncShareDialog?.file;
    if (!file) return;
    setGitSyncShareDialog((current) => current ? { ...current, loading: true, error: "", copied: "" } : current);
    const syncResult = await window.electron?.gitSyncNow?.();
    if (!syncResult?.success) {
      setGitSyncShareDialog((current) => current ? {
        ...current,
        loading: false,
        error: syncResult?.error || "Sync failed before copying the link.",
      } : current);
      return;
    }
    applyGitSyncStatus(syncResult.status);
    await refreshLocal();
    try {
      const info = await loadGitSyncShareInfo(file);
      await copyText(info?.[kind]);
      setGitSyncShareDialog({ file, info, loading: false, error: "", copied: kind });
    } catch (error) {
      setGitSyncShareDialog((current) => current ? {
        ...current,
        loading: false,
        error: error.message,
      } : current);
    }
  };

  const handleToggleNeverSync = async (file) => {
    if (!file || file.isPackage) return;
    const next = !file.neverSync;
    if (next && !window.confirm(
      "Stop syncing this timeline to GitHub?\n\nFuture changes won't be pushed. Anything already pushed stays in the repo and its history; use \"Remove from repo\" to take it down."
    )) return;
    const result = await window.electron?.setTimelineNeverSync?.({ id: file.id, neverSync: next });
    if (result?.success) {
      await refreshLocal();
      await loadGitSyncStatus();
    } else if (result?.error) {
      setGitSyncError(result.error);
    }
  };

  const handleOpenGitSyncHistory = async (file) => {
    setGitSyncHistoryDialog({ file, history: null, loading: true, error: "", restoringOid: "" });
    try {
      const history = await loadGitSyncHistory(file);
      setGitSyncHistoryDialog({ file, history, loading: false, error: "", restoringOid: "" });
    } catch (error) {
      setGitSyncHistoryDialog({ file, history: null, loading: false, error: error.message, restoringOid: "" });
    }
  };

  const handleRestoreGitSyncVersion = async (oid) => {
    const file = gitSyncHistoryDialog?.file;
    if (!file || !oid) return;
    if (!window.confirm("Restore this version as a copy in your library?")) return;
    setGitSyncHistoryDialog((current) => current ? { ...current, restoringOid: oid, error: "" } : current);
    const result = await window.electron?.gitSyncRestoreVersion?.({ uid: file.uid, commitOid: oid });
    if (!result?.success) {
      setGitSyncHistoryDialog((current) => current ? {
        ...current,
        restoringOid: "",
        error: result?.error || "Could not restore this version.",
      } : current);
      return;
    }
    await refreshLocal();
    setGitSyncHistoryDialog(null);
  };

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    await createFolder(name, currentFolder || undefined);
    setNewFolderName("");
    setNewFolderDialogOpen(false);
    await refreshLocal();
  };

  const handleOpenMoveDialog = async (file) => {
    setMoveDialogFile(file);
    const folders = await listFolders();
    setAvailableFolders(folders.filter(f => !f.split('/').some(part => part.startsWith('.') || part.endsWith('.assets'))));
  };

  const handleRename = async () => {
    if (!renameTarget || !renameName.trim()) return;
    const name = renameName.trim();
    if (renameTarget.type === 'folder') {
      await renameFolder(renameTarget.id, name);
      if (currentFolder === renameTarget.id) {
        const parts = renameTarget.id.split('/');
        parts[parts.length - 1] = name;
        setCurrentFolder(parts.join('/'));
      }
    } else {
      const result = onRenameTimeline
        ? await onRenameTimeline(renameTarget.id, name)
        : await updateTimelineTitle(renameTarget.id, name);
      if (!result?.success) {
        if (result?.error === 'EXISTS') {
          setRenameError(`A timeline named "${name}" already exists in that folder.`);
          restoreRenameFocus();
          return;
        }
        if (result?.error === 'INVALID_TITLE') {
          setRenameError("Timeline name must include at least one letter or number.");
          restoreRenameFocus();
          return;
        }
        setRenameError(result?.error || 'Rename failed');
        restoreRenameFocus();
        return;
      }
      onTimelineRenamed?.(result);
    }
    closeRenameDialog();
    await refreshLocal();
  };

  const handleDeleteFolder = async () => {
    if (!deleteFolderTarget) return;
    await deleteFolder(deleteFolderTarget.folderPath);
    if (currentFolder.startsWith(deleteFolderTarget.folderPath)) setCurrentFolder("");
    setDeleteFolderTarget(null);
    await refreshLocal();
  };

  const handleMoveFolder = async (targetFolder) => {
    if (!moveFolderTarget) return;
    await moveFolder(moveFolderTarget.folderPath, targetFolder || '');
    setMoveFolderTarget(null);
    await refreshLocal();
  };

  const handleMoveTimeline = async (targetFolder) => {
    if (!moveDialogFile) return;
    const result = await moveTimeline(moveDialogFile.id, targetFolder);
    setMoveDialogFile(null);
    if (result.success) await refreshLocal();
  };

  const handleDelete = async (file) => {
    setDeleteDialogFile(file);
    setDeleteDialogWithNotes(false);
    setDeleteDialogWithAssets(false);
  };

  const handleConfirmDelete = async () => {
    const file = deleteDialogFile;
    if (!file) return;

    try {
      if (window.electron?.deleteTimeline) {
        await window.electron.deleteTimeline({
          id: file.id,
          deleteNotes: deleteDialogWithNotes,
          deleteAssets: deleteDialogWithAssets,
        });

        // Reload timeline list
        const files = await window.electron.listTimelines();
        setTimelineFiles(files.map(f => ({ ...f, storageType: 'local' })));
      } else {
        alert('Delete is only available in the desktop app');
      }
    } catch (error) {
      console.error('Failed to delete timeline:', error);
      alert(`Failed to delete timeline: ${error.message}`);
    } finally {
      setDeleteDialogFile(null);
    }
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const allTimelines = timelineFiles;

  const visibleSubfolders = useMemo(() => {
    if (normalizedQuery) return [];
    const depth = currentFolder ? currentFolder.split('/').length : 0;
    return allFolders
      .filter(f => {
        if (!f) return false;
        const parts = f.split('/');
        if (parts.length !== depth + 1) return false;
        if (currentFolder && !f.startsWith(currentFolder + '/')) return false;
        if (!currentFolder && parts.length !== 1) return false;
        return true;
      })
      .map(f => f.split('/').pop())
      .filter(name => !name.startsWith('.') && !name.endsWith('.assets'))
      .sort((a, b) => a.localeCompare(b));
  }, [allFolders, currentFolder, normalizedQuery]);

  const filteredTimelines = allTimelines
    .filter((file) => {
      const matchesSearch = !normalizedQuery || file.name.toLowerCase().includes(normalizedQuery);
      const fileFolder = file.folder ?? '';
      const matchesFolder = currentFolder
        ? fileFolder === currentFolder || fileFolder.startsWith(currentFolder + '/')
        : normalizedQuery
          ? true
          : fileFolder === '';
      return matchesSearch && matchesFolder;
    })
    .sort((a, b) =>
      sortMode === "name" ? a.name.localeCompare(b.name)
      : sortMode === "name-desc" ? b.name.localeCompare(a.name)
      : (b.modifiedAt ?? 0) - (a.modifiedAt ?? 0)
    );

  const gitSyncExcluded = gitSyncStatus?.excludedPaths || [];
  const gitSyncExcludedSet = new Set(gitSyncExcluded);
  const isGitSyncExcluded = (id) => {
    const rel = String(id || "");
    return gitSyncExcluded.some((e) => (e.endsWith("/") ? rel.startsWith(e) : rel === e));
  };
  const isExcludedByAncestorFolder = (id) => {
    const rel = String(id || "");
    return gitSyncExcluded.some((e) => e.endsWith("/") && rel.startsWith(e));
  };
  const gitSyncTree = useMemo(() => buildSyncTree(timelineFiles), [timelineFiles]);
  const gitSyncChip = useMemo(() => {
    const state = gitSyncStatus?.state || "disconnected";
    if (state === "syncing" || gitSyncBusy === "sync-now") {
      return { label: "Syncing", icon: RefreshCw, className: "is-syncing" };
    }
    if (state === "idle") {
      return { label: "Synced", icon: CheckCircle2, className: "is-ok" };
    }
    if (state === "dirty") {
      return { label: "Pending", icon: Cloud, className: "is-dirty" };
    }
    if (state === "offline") {
      return { label: "Offline", icon: CloudOff, className: "is-warn" };
    }
    if (state === "auth-expired") {
      return { label: "Token Needed", icon: AlertTriangle, className: "is-error" };
    }
    if (state === "error") {
      return { label: "Sync Error", icon: AlertTriangle, className: "is-error" };
    }
    return { label: "Git Sync", icon: Cloud, className: "" };
  }, [gitSyncStatus?.state, gitSyncBusy]);

  const gitSyncRemoteOpenUrl = useMemo(() => {
    const remoteUrl = String(gitSyncStatus?.repo?.url || gitSyncRemoteUrl || "").trim();
    if (!remoteUrl) return "";
    if (/^https?:\/\//i.test(remoteUrl)) return remoteUrl.replace(/\.git$/i, "");
    if (/^git@github\.com:/i.test(remoteUrl)) {
      return `https://github.com/${remoteUrl.slice("git@github.com:".length).replace(/\.git$/i, "")}`;
    }
    return remoteUrl;
  }, [gitSyncStatus?.repo?.url, gitSyncRemoteUrl]);
  const gitSyncConnected = Boolean(gitSyncStatus?.repo);
  const gitSyncStatusDetail = useMemo(() => {
    if (gitSyncStatus?.error) return gitSyncStatus.error;
    const state = gitSyncStatus?.state || "disconnected";
    if (state === "syncing" || gitSyncBusy === "sync-now") {
      return "A sync is currently running. Local and remote changes will reconcile automatically.";
    }
    if (state === "idle") return formatSyncTime(gitSyncStatus?.lastSyncedAt);
    if (state === "dirty") {
      return "Local changes are queued for the next sync pass.";
    }
    if (state === "offline") {
      return "The remote is unreachable right now. Changes stay local until the connection returns.";
    }
    if (state === "auth-expired") {
      return "The saved token no longer works. Paste a replacement token below to resume syncing.";
    }
    if (state === "error") {
      return "The last sync attempt failed. Review the error below and try again.";
    }
    if (!gitSyncConnected) {
      return "Connect a Git repository to keep this library synced across devices.";
    }
    return formatSyncTime(gitSyncStatus?.lastSyncedAt);
  }, [gitSyncBusy, gitSyncConnected, gitSyncStatus?.error, gitSyncStatus?.lastSyncedAt, gitSyncStatus?.state]);

  const handleGitSyncExcludeChange = async (targetKey, nextChecked) => {
    const targetId = targetKey.endsWith("/") ? targetKey.slice(0, -1) : targetKey;
    const next = new Set(gitSyncExcludedSet);
    if (nextChecked) {
      next.delete(targetKey);
      next.delete(targetId);
    } else {
      for (const e of [...next]) {
        const eId = e.endsWith("/") ? e.slice(0, -1) : e;
        if (eId === targetId || eId.startsWith(`${targetId}/`)) next.delete(e);
      }
      next.add(targetKey);
    }
    await saveGitSyncSettings({ excludedPaths: [...next].sort() });
  };

  if (loading && !settingsOnly) {
    return (
      <div className="homepage">
        <div className="homepage-container">
          <p>Loading timelines...</p>
        </div>
      </div>
    );
  }

  const closeSettings = () => {
    if (settingsOnly) {
      onAppSettingsClosed?.();
      return;
    }
    setView("home");
  };

  const renderGitSyncTreeNode = (node, depth = 0) => {
    if (!node) return null;
    if (node.type === "timeline") {
      const coveredByFolder = isExcludedByAncestorFolder(node.id);
      const checked = !isGitSyncExcluded(node.id) && !node.neverSync;
      return (
        <label
          key={`t:${node.id}`}
          className="git-sync-tree-item"
          style={{ paddingLeft: `${depth * 18}px` }}
          title={coveredByFolder ? "Excluded by its folder; re-check the folder to edit this timeline." : undefined}
        >
          <input
            type="checkbox"
            checked={checked}
            disabled={node.neverSync || coveredByFolder}
            onChange={(e) => handleGitSyncExcludeChange(node.id, e.target.checked)}
          />
          <span className="git-sync-tree-label">
            {node.label}
            {node.conflict && <span className="git-sync-tree-badge">Conflict</span>}
            {node.neverSync && <span className="git-sync-tree-badge">Never sync</span>}
          </span>
        </label>
      );
    }

    const flattenLeaves = (current) => current.children.flatMap((child) => (
      child.type === "folder" ? flattenLeaves(child) : [child]
    ));
    const leaves = flattenLeaves(node);
    const selectableLeaves = leaves.filter((leaf) => !leaf.neverSync);
    const checkedCount = selectableLeaves.filter((leaf) => !isGitSyncExcluded(leaf.id)).length;
    const allChecked = selectableLeaves.length > 0 && checkedCount === selectableLeaves.length;
    const partiallyChecked = checkedCount > 0 && checkedCount < selectableLeaves.length;

    return (
      <div key={`f:${node.id || "root"}`} className="git-sync-tree-group">
        {node.id ? (
          <label
            className="git-sync-tree-item"
            style={{ paddingLeft: `${depth * 18}px` }}
            title={isExcludedByAncestorFolder(node.id) ? "Excluded by a parent folder; re-check the parent to edit this folder." : undefined}
          >
            <input
              type="checkbox"
              checked={allChecked}
              disabled={isExcludedByAncestorFolder(node.id)}
              ref={(input) => {
                if (input) input.indeterminate = partiallyChecked;
              }}
              onChange={(e) => handleGitSyncExcludeChange(`${node.id}/`, e.target.checked)}
            />
            <span className="git-sync-tree-label">{node.label}</span>
          </label>
        ) : null}
        {node.children.map((child) => renderGitSyncTreeNode(child, node.id ? depth + 1 : depth))}
      </div>
    );
  };

  return (
    <div className={`homepage${settingsOnly ? " homepage-settings-only" : ""}`}>
      {!settingsOnly && isDragOver && (
        <div className="homepage-drop-overlay">
          <div className="homepage-drop-card">Drop a .timeline file to import it</div>
        </div>
      )}
      {!settingsOnly && (
        <>
          <div className="homepage-container">
        <div className="homepage-header">
          <div className="homepage-header-left">
            <h1 className="homepage-title">timelines</h1>
            <svg
              className="homepage-logo"
              width="67"
              height="25"
              viewBox="0 0 67 25"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <rect y="8.89844" width="29.2656" height="6.80469" fill="currentColor" />
              <rect x="34.0703" width="32.9297" height="7.32812" fill="currentColor" />
              <rect x="34.0703" y="16.75" width="32.9297" height="7.32812" fill="currentColor" />
              <path d="M28.2656 5C28.2656 2.23858 30.5042 0 33.2656 0H35.0703V24.0781H33.2656C30.5042 24.0781 28.2656 21.8395 28.2656 19.0781V5Z" fill="currentColor" />
            </svg>
          </div>
          <div className="homepage-header-right">
            <div className="homepage-search-wrap">
              <Search size={14} className="homepage-search-icon" />
              <input
                className="homepage-search"
                type="text"
                placeholder="Search timelines..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Search timelines"
              />
            </div>
            {gitSyncStatus?.repo && (
              <button
                className={`git-sync-chip ${gitSyncChip.className}`}
                onClick={handleGitSyncNow}
                title={gitSyncStatus?.error || formatSyncTime(gitSyncStatus?.lastSyncedAt)}
                aria-label="Git sync status"
              >
                <gitSyncChip.icon size={15} className={gitSyncChip.className === "is-syncing" ? "git-sync-chip-spin" : ""} />
                <span>{gitSyncChip.label}</span>
              </button>
            )}
            <button
              className="homepage-settings-icon"
              onClick={handleOpenMarketplace}
              aria-label="Marketplace"
            >
              <Store size={19} />
            </button>
            <button
              className="homepage-settings-icon"
              onClick={() => setView("settings")}
              aria-label="App Settings"
            >
              <Settings size={19} />
            </button>
          </div>
        </div>

        <div className="timeline-view-toolbar">
          <div style={{ display: "flex", gap: "6px" }}>
            <button className="timeline-new-btn toolbar-btn-equal" onClick={handleNewTimeline}>
              <FilePlus size={14} strokeWidth={2.5} />
              New Timeline
            </button>
            <button className="timeline-new-btn timeline-new-btn-secondary toolbar-btn-equal" onClick={() => { setNewFolderName(""); setNewFolderDialogOpen(true); }}>
              <FolderPlus size={14} strokeWidth={2.5} />
              New Folder
            </button>
            <button
              className="timeline-new-btn timeline-new-btn-secondary toolbar-btn-equal"
              onClick={() => onImportTimeline?.()}
              title="Import a .timeline or .json file into your library"
            >
              <Import size={14} strokeWidth={2.5} />
              Import
            </button>
          </div>
          <div className="timeline-toolbar-right">
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <button
                className="timeline-view-toggle timeline-sort-btn"
                onClick={() => setSortMode(s => { const next = s === "date" ? "name" : s === "name" ? "name-desc" : "date"; saveAppSettings({ homeSortMode: next }); return next; })}
                aria-label="Toggle sort"
                title={sortMode === "date" ? "Sort: Date modified" : sortMode === "name" ? "Sort: A–Z" : "Sort: Z–A"}
              >
                {sortMode === "date" ? <Clock size={15} /> : sortMode === "name" ? <ArrowDownAZ size={15} /> : <ArrowUpAZ size={15} />}
                <span>{sortMode === "date" ? "Date" : sortMode === "name" ? "A–Z" : "Z–A"}</span>
              </button>
              <div className="view-mode-pill">
                <button
                  className={`view-mode-pill-btn${viewMode === "list" ? " is-active" : ""}`}
                  onClick={() => setViewMode("list")}
                  aria-label="List view"
                  title="List"
                >
                  <List size={15} />
                </button>
                <button
                  className={`view-mode-pill-btn${viewMode === "grid" ? " is-active" : ""}`}
                  onClick={() => setViewMode("grid")}
                  aria-label="Grid view"
                  title="Grid"
                >
                  <LayoutGrid size={15} />
                </button>
              </div>
            </div>
          </div>
        </div>

        {currentFolder && (
          <div className="timeline-breadcrumb">
            <button className="timeline-breadcrumb-item" onClick={() => setCurrentFolder("")}>Home</button>
            {currentFolder.split('/').map((part, i, arr) => {
              const path = arr.slice(0, i + 1).join('/');
              return (
                <span key={path} className="timeline-breadcrumb-sep-wrap">
                  <ChevronRight size={12} className="timeline-breadcrumb-sep" />
                  <button className="timeline-breadcrumb-item" onClick={() => setCurrentFolder(path)}>{part}</button>
                </span>
              );
            })}
          </div>
        )}

        {currentFolder && (() => {
          const folderName = currentFolder.split('/').pop();
          const timelineCount = timelineFiles.filter(f => f.folder === currentFolder).length;
          const subfolderCount = visibleSubfolders.length;
          const lastModified = timelineFiles
            .filter(f => f.folder === currentFolder && f.modifiedAt)
            .reduce((max, f) => Math.max(max, f.modifiedAt), 0);
          return (
            <div className="folder-hero">
              <h2 className="folder-hero-title"><FolderOpen size={30} className="folder-hero-icon" />{folderName}</h2>
              <p className="folder-hero-meta">
                {timelineCount} {timelineCount === 1 ? 'timeline' : 'timelines'}
                {subfolderCount > 0 && <> · {subfolderCount} {subfolderCount === 1 ? 'folder' : 'folders'}</>}
                {lastModified > 0 && <> · Updated {relativeTime(lastModified)}</>}
              </p>
            </div>
          );
        })()}

        {visibleSubfolders.length > 0 && (
          <div className="homepage-section">
            <span className="homepage-section-label">Folders</span>
            <div className="timeline-folders-row">
              {(showAllFolders ? visibleSubfolders : visibleSubfolders.slice(0, 9)).map((folderName) => {
                const fullPath = currentFolder ? `${currentFolder}/${folderName}` : folderName;
                const count = timelineFiles.filter(f => (f.folder ?? '').startsWith(fullPath) && (f.folder === fullPath || f.folder.startsWith(fullPath + '/'))).length;
                return (
                  <div key={fullPath} className="timeline-folder-chip-wrap">
                    <div className="timeline-folder-chip" onClick={() => setCurrentFolder(fullPath)}>
                      <div className="timeline-folder-chip-icon"><FolderOpen size={16} /></div>
                      <div className="timeline-folder-chip-body">
                        <span className="timeline-folder-chip-name">{folderName}</span>
                        <span className={`timeline-folder-chip-meta${count === 0 ? ' is-empty' : ''}`}>{count === 0 ? 'Empty' : `${count} ${count === 1 ? 'timeline' : 'timelines'}`}</span>
                      </div>
                      <button
                        className="timeline-folder-chip-dots"
                        onClick={(e) => { e.stopPropagation(); setFolderContextMenu({ x: e.clientX, y: e.clientY, nearRight: e.clientX > window.innerWidth / 2, folderPath: fullPath, folderName }); }}
                        aria-label="More options"
                      >
                        <MoreVertical size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            {visibleSubfolders.length > 9 && (
              <button className="folders-show-more" onClick={() => setShowAllFolders(v => !v)}>
                {showAllFolders ? 'Show less' : `Show ${visibleSubfolders.length - 9} more`}
              </button>
            )}
          </div>
        )}

        <div className="homepage-section">
          <span className="homepage-section-label">
            {normalizedQuery ? 'Results' : 'Timelines'}
            <span className="homepage-section-count">{filteredTimelines.length}</span>
          </span>
        {viewMode === "list" ? (
          <div className="timeline-list">
            {filteredTimelines.map((file) => (
              <div
                key={file.id}
                className="timeline-item"
                onClick={() => openTimelineFile(file)}
                onContextMenu={(e) => handleContextMenu(e, file)}
              >
                <div className="timeline-item-body">
                  <span className="timeline-item-title">{file.name}</span>
                  {file.isPackage && (
                    <span className="timeline-item-folder" title="Packaged timeline; opening it imports it into your library">Package</span>
                  )}
                  {isConflictCopyId(file.id) && (
                    <span className="timeline-item-folder timeline-item-conflict">Conflict</span>
                  )}
                  {normalizedQuery && file.folder && (
                    <span className="timeline-item-folder">{file.folder}</span>
                  )}
                </div>
                <div className="timeline-item-right">
                  {file.modifiedAt && (
                    <span className="timeline-item-meta">{relativeTime(file.modifiedAt)}</span>
                  )}
                  <button
                    className="timeline-item-dots"
                    onClick={(e) => { e.stopPropagation(); handleContextMenu(e, file); }}
                    aria-label="More options"
                  >
                    <MoreVertical size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="timeline-grid">
            {filteredTimelines.map((file) => (
              <div
                key={file.id}
                className="timeline-card"
                onClick={() => openTimelineFile(file)}
                onContextMenu={(e) => handleContextMenu(e, file)}
              >
                <div className="timeline-item-icon">
                  <svg width="20" height="8" viewBox="0 0 67 25" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <rect y="8.89844" width="29.2656" height="6.80469" fill="currentColor" />
                    <rect x="34.0703" width="32.9297" height="7.32812" fill="currentColor" />
                    <rect x="34.0703" y="16.75" width="32.9297" height="7.32812" fill="currentColor" />
                    <path d="M28.2656 5C28.2656 2.23858 30.5042 0 33.2656 0H35.0703V24.0781H33.2656C30.5042 24.0781 28.2656 21.8395 28.2656 19.0781V5Z" fill="currentColor" />
                  </svg>
                </div>
                <div className="timeline-card-body">
                  <span className="timeline-item-title">{file.name}</span>
                  {file.isPackage && (
                    <span className="timeline-item-folder" title="Packaged timeline; opening it imports it into your library">Package</span>
                  )}
                  {isConflictCopyId(file.id) && (
                    <span className="timeline-item-folder timeline-item-conflict">Conflict</span>
                  )}
                  {normalizedQuery && file.folder && (
                    <span className="timeline-item-folder">{file.folder}</span>
                  )}
                  <span className="timeline-item-meta">{file.modifiedAt ? `Edited ${relativeTime(file.modifiedAt)}` : ""}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {filteredTimelines.length === 0 && (
          <div className="no-timelines">
            <p>No timelines found. Create a new one to get started.</p>
          </div>
        )}
        </div>
          </div>

          <NewTimelineModal
            isOpen={isNewTimelineModalOpen}
            onClose={() => setIsNewTimelineModalOpen(false)}
            onCreate={handleCreateTimeline}
          />
        </>
      )}

      {view === "settings" && (
        <div
          className={`settings-backdrop${reuseExistingBackdrop ? " settings-backdrop-pass-through" : ""}`}
          onClick={closeSettings}
        >
          <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
            <div className="settings-header">
              <button
                className="settings-back-button"
                onClick={closeSettings}
                aria-label="Close settings"
              >
                <ArrowLeft size={18} strokeWidth={2} />
              </button>
              <h2 className="settings-title settings-title-right">APP SETTINGS</h2>
            </div>

            <div className="settings-layout">
              <div className="settings-sidebar">
                <button
                  type="button"
                  className={`settings-sidebar-item${settingsSection === "general" ? " is-active" : ""}`}
                  onClick={() => setSettingsSection("general")}
                >
                  General
                </button>
                <button
                  type="button"
                  className={`settings-sidebar-item${settingsSection === "files" ? " is-active" : ""}`}
                  onClick={() => setSettingsSection("files")}
                >
                  Files
                </button>
                <button
                  type="button"
                  className={`settings-sidebar-item${settingsSection === "hotkeys" ? " is-active" : ""}`}
                  onClick={() => setSettingsSection("hotkeys")}
                >
                  Hotkeys
                </button>
                <button
                  type="button"
                  className={`settings-sidebar-item${settingsSection === "sync" ? " is-active" : ""}`}
                  onClick={() => setSettingsSection("sync")}
                >
                  Sync
                </button>
              </div>
              <div className="settings-content">
                {settingsSection === "general" && (
                  <>
                    <div className="settings-row">
                      <div className="settings-row-left">
                        <div className="settings-row-label">Version 0.6.0-alpha.2</div>
                        <div className="settings-row-description">
                          {updateStatus === 'available'
                            ? 'A new update is available. Would you like to download it?'
                            : updateStatus === 'downloaded'
                            ? 'Ready to install'
                            : updateStatus === 'error'
                            ? 'Update check failed'
                            : updateStatus === 'not-available'
                            ? 'You have the latest version installed.'
                            : <>See what's new in <a href="https://github.com/sreegjl/timelines/releases/tag/v0.6.0-alpha.2" target="_blank" rel="noopener noreferrer">v0.6.0-alpha.2</a>.</>}
                        </div>
                      </div>
                      <div className="settings-row-right">
                        <div className="settings-folder settings-folder-column">
                          <div className="settings-folder-actions">
                            {window.electron?.platform === 'darwin' ? (
                              updateStatus === 'available' ? (
                                <>
                                  <button
                                    className="settings-folder-button"
                                    type="button"
                                    onClick={() => window.electron?.openExternal?.({ url: 'https://github.com/sreegjl/timelines/releases/latest' })}
                                  >
                                    Download Latest Release
                                  </button>
                                  <button
                                    className="settings-folder-button"
                                    type="button"
                                    onClick={() => setUpdateStatus(null)}
                                  >
                                    Not Now
                                  </button>
                                </>
                              ) : (
                                <button
                                  className="settings-folder-button"
                                  type="button"
                                  disabled={updateStatus === 'checking'}
                                  onClick={() => window.electron?.checkForUpdates?.()}
                                >
                                  {updateStatus === 'checking' ? 'Checking…' : 'Check for Updates'}
                                </button>
                              )
                            ) : updateStatus === 'downloaded' ? (
                              <button
                                className="settings-folder-button"
                                type="button"
                                onClick={() => window.electron?.installUpdate?.()}
                              >
                                Restart & Install
                              </button>
                            ) : updateStatus === 'available' ? (
                              <>
                                <button
                                  className="settings-folder-button"
                                  type="button"
                                  onClick={() => window.electron?.downloadUpdate?.()}
                                >
                                  Download Update
                                </button>
                                <button
                                  className="settings-folder-button"
                                  type="button"
                                  onClick={() => setUpdateStatus(null)}
                                >
                                  Not Now
                                </button>
                              </>
                            ) : (
                              <button
                                className="settings-folder-button"
                                type="button"
                                disabled={updateStatus === 'checking' || updateStatus === 'downloading'}
                                onClick={() => window.electron?.checkForUpdates?.()}
                              >
                                {updateStatus === 'checking' ? 'Checking…' : updateStatus === 'downloading' ? `Downloading…` : 'Check for Updates'}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="settings-row settings-row-docs">
                      <div className="settings-row-left">
                        <div className="settings-row-label">Documentation</div>
                        <div className="settings-row-description">
                          Guides, tips, and feature references.
                        </div>
                      </div>
                      <div className="settings-row-right">
                        <div className="settings-folder settings-folder-column">
                          <div className="settings-folder-actions">
                            <button
                              className="settings-folder-button"
                              type="button"
                              onClick={() =>
                                window.electron?.openExternal?.({
                                  url: "https://www.timelines.studio/wiki",
                                })
                              }
                            >
                              Open Docs
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="settings-row">
                      <div className="settings-row-left">
                        <div className="settings-row-label">App Theme</div>
                        <div className="settings-row-description">
                          Used as the default theme for timelines.
                        </div>
                      </div>
                      <div className="settings-row-right">
                        <div className="settings-folder settings-folder-column">
                          <div className="settings-select-row">
                            <button
                              className="settings-select-icon-button"
                              type="button"
                              onClick={() => window.electron?.openThemesFolder?.()}
                              aria-label="Open theme folder"
                            >
                              <Folder className="settings-select-icon" size={18} />
                            </button>
                            <select
                              className="settings-select"
                              value={appThemeKey || ""}
                              onChange={(e) => onAppThemeChange?.(e.target.value)}
                            >
                              {appThemes.map(([key, theme]) => {
                                const isDefault = key.toLowerCase() === "parchment_v2";
                                const label = `${theme?.name || key}${isDefault ? " (Default)" : ""}`;
                                return (
                                  <option key={key} value={key}>
                                    {label}
                                  </option>
                                );
                              })}
                              {userThemes.map(([key, theme]) => (
                                <option key={key} value={key}>
                                  {theme?.name || key}
                                </option>
                              ))}
                            </select>
                          </div>
                          {themeMigrationStatus?.count != null ? (
                            <div className="theme-migration-notice">
                              {themeMigrationStatus.count} theme{themeMigrationStatus.count === 1 ? "" : "s"} updated.
                            </div>
                          ) : oldFormatThemeCount > 0 ? (
                            <div className="theme-migration-notice">
                              <span>
                                {oldFormatThemeCount} theme{oldFormatThemeCount === 1 ? "" : "s"} are using an older format. Update all?
                              </span>
                              <button
                                type="button"
                                className="theme-migration-button"
                                onClick={handleMigrateOldThemes}
                                disabled={themeMigrationStatus === "migrating"}
                              >
                                {themeMigrationStatus === "migrating" ? "Updating..." : "Update All"}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <div className="settings-row">
                      <div className="settings-row-left">
                        <div className="settings-row-label">App Font</div>
                        <div className="settings-row-description">
                          Sets the UI font. Add custom fonts in the font folder.
                        </div>
                      </div>
                      <div className="settings-row-right">
                        <div className="settings-folder settings-folder-column">
                          <div className="settings-select-row">
                            <button
                              className="settings-select-icon-button"
                              type="button"
                              onClick={() => onOpenFontsFolder?.()}
                              aria-label="Open font folder"
                            >
                              <Folder className="settings-select-icon" size={18} />
                            </button>
                            <select
                              className="settings-select"
                              value={appFontFamily || "Inter"}
                              onChange={(e) => onAppFontChange?.(e.target.value)}
                            >
                              {fontOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="settings-row">
                      <div className="settings-row-left">
                        <div className="settings-row-label">App Font Size</div>
                        <div className="settings-row-description">
                          Controls the base UI font size.
                        </div>
                      </div>
                      <div className="settings-row-right">
                        <div className="settings-font-size">
                          <input
                            className="settings-slider"
                            type="range"
                            min={12}
                            max={18}
                            step={1}
                            value={appFontSize || 14}
                            onChange={(e) => onAppFontSizeChange?.(e.target.value)}
                            aria-label="App font size"
                          />
                          <div
                            className="settings-slider-tooltip"
                            style={{
                              left: `${(((appFontSize || 14) - 12) / 6) * 100}%`,
                            }}
                          >
                            {appFontSize || 14}px
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="settings-row">
                      <div className="settings-row-left">
                        <div className="settings-row-label">Start App Maximized</div>
                        <div className="settings-row-description">
                          Launch the app in a maximized window.
                        </div>
                      </div>
                      <div className="settings-row-right">
                        <label className="settings-toggle">
                          <input
                            type="checkbox"
                            checked={startMaximized}
                            onChange={(e) => onStartMaximizedChange?.(e.target.checked)}
                          />
                          <span className="settings-toggle-slider"></span>
                        </label>
                      </div>
                    </div>

                    <div className="settings-row">
                      <div className="settings-row-left">
                        <div className="settings-row-label">Hardware Acceleration</div>
                        <div className="settings-row-description">
                          Disable if you experience visual glitches. Requires restart.
                        </div>
                      </div>
                      <div className="settings-row-right">
                        <label className="settings-toggle">
                          <input
                            type="checkbox"
                            checked={hardwareAcceleration}
                            onChange={(e) => onHardwareAccelerationChange?.(e.target.checked)}
                          />
                          <span className="settings-toggle-slider"></span>
                        </label>
                      </div>
                    </div>
                  </>
                )}

                {settingsSection === "hotkeys" && (
                  <>
                    {Object.entries(keybinds).map(([id, { label, keys }]) => (
                      <div className="settings-row" key={id}>
                        <div className="settings-row-left">
                          <div className="settings-row-label">{label}</div>
                        </div>
                        <div className="settings-row-right">
                          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                            {recordingKey === id ? (
                              <span
                                className="hotkey-badge hotkey-badge-recording"
                              >
                                Press a key…
                              </span>
                            ) : (
                              <span className="hotkey-badge">
                                {keys.join(" + ")}
                              </span>
                            )}
                            <button
                              className="hotkey-icon-button"
                              type="button"
                              title={recordingKey === id ? "Cancel" : "Edit"}
                              onClick={() => setRecordingKey(recordingKey === id ? null : id)}
                            >
                              {recordingKey === id ? <X size={13} /> : <Pencil size={13} />}
                            </button>
                            <button
                              className="hotkey-icon-button"
                              type="button"
                              title="Reset to default"
                              onClick={() => {
                                const updated = {
                                  ...keybinds,
                                  [id]: { ...keybinds[id], keys: [...DEFAULT_KEYBINDS[id].keys] },
                                };
                                onKeybindsChange?.(updated);
                                saveKeybinds(updated);
                              }}
                            >
                              <RotateCcw size={13} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </>
                )}

                {settingsSection === "sync" && (
                  <>
                    {!window.electron?.gitSyncStatus ? (
                      <div className="settings-row">
                        <div className="settings-row-left">
                          <div className="settings-row-label">Git Sync</div>
                          <div className="settings-row-description">
                            Git sync is only available in the desktop app.
                          </div>
                        </div>
                      </div>
                    ) : (
                      <>
                        {!gitSyncConnected ? (
                          <>
                            <div className="git-sync-intro">
                              <div className="git-sync-intro-icon">
                                <Cloud size={20} />
                              </div>
                              <div className="git-sync-intro-text">
                                <div className="git-sync-intro-title">Git Sync</div>
                                <div className="git-sync-intro-desc">
                                  Sync this library across devices using your own Git repository. Follow the steps below to connect one.
                                </div>
                              </div>
                            </div>

                            <div className="git-sync-step-row">
                              <div className="git-sync-step-badge">1</div>
                              <div className="git-sync-step-main">
                                <div className="git-sync-step-title">Create a repository</div>
                                <div className="git-sync-step-text">
                                  Create an empty repository on GitHub or another Git host. This is where your synced library will live.
                                </div>
                              </div>
                            </div>

                            <div className="git-sync-step-row">
                              <div className="git-sync-step-badge">2</div>
                              <div className="git-sync-step-main">
                                <div className="git-sync-step-title">Generate an access token</div>
                                <div className="git-sync-step-text">
                                  Create a personal access token that can read and write that repo. Fine-grained tokens scoped to the single repo are recommended; it is stored locally with OS encryption when available.
                                </div>
                              </div>
                            </div>

                            <div className="git-sync-step-row">
                              <div className="git-sync-step-badge">3</div>
                              <div className="git-sync-step-main">
                                <div className="git-sync-step-title">Connect the remote</div>
                                <div className="git-sync-step-text">
                                  Enter the repository's HTTPS clone URL, branch, and token. Connect every device to the same remote to keep libraries aligned.
                                </div>
                                <div className="git-sync-step-form">
                                  <label className="git-sync-step-field">
                                    <span className="git-sync-step-field-label">Repository URL</span>
                                    <input
                                      className="homepage-search git-sync-input git-sync-input-wide"
                                      value={gitSyncRemoteUrl}
                                      onChange={(e) => setGitSyncRemoteUrl(e.target.value)}
                                      placeholder="https://github.com/you/timelines-sync.git"
                                    />
                                  </label>
                                  <label className="git-sync-step-field">
                                    <span className="git-sync-step-field-label">Branch</span>
                                    <input
                                      className="homepage-search git-sync-input"
                                      value={gitSyncBranch}
                                      onChange={(e) => setGitSyncBranch(e.target.value)}
                                      placeholder="main"
                                    />
                                  </label>
                                  <label className="git-sync-step-field">
                                    <span className="git-sync-step-field-label">Personal Access Token</span>
                                    <input
                                      className="homepage-search git-sync-input git-sync-input-wide"
                                      type="password"
                                      value={gitSyncPat}
                                      onChange={(e) => setGitSyncPat(e.target.value)}
                                      placeholder="github_pat_..."
                                    />
                                  </label>
                                  <div className="git-sync-step-actions">
                                    <div className="settings-folder-actions">
                                      <button
                                        className="settings-folder-button"
                                        type="button"
                                        disabled={!gitSyncRemoteUrl.trim() || !gitSyncPat.trim() || gitSyncBusy === "connect"}
                                        onClick={handleConnectGitSyncRepo}
                                      >
                                        {gitSyncBusy === "connect" ? "Connecting..." : "Connect Repo"}
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="git-sync-intro">
                              <div className="git-sync-intro-icon">
                                <Cloud size={20} />
                              </div>
                              <div className="git-sync-intro-text">
                                <div className="git-sync-intro-title">Git Sync</div>
                                <div className="git-sync-intro-desc">
                                  {gitSyncStatus.repo.owner && gitSyncStatus.repo.repo
                                    ? `Connected to ${gitSyncStatus.repo.owner}/${gitSyncStatus.repo.repo}.`
                                    : "Connected to your remote repository."}
                                </div>
                              </div>
                            </div>

                            <div className="settings-row">
                              <div className="settings-row-left">
                                <div className="settings-row-label">Status</div>
                                <div className="settings-row-description">{gitSyncStatusDetail}</div>
                              </div>
                              <div className="settings-row-right">
                                <div className="settings-folder settings-folder-column">
                                  <div className="settings-folder-actions">
                                    <button
                                      className="settings-folder-button"
                                      type="button"
                                      disabled={!gitSyncStatus?.repo || gitSyncStatus?.state === "auth-expired" || gitSyncBusy === "sync-now"}
                                      onClick={handleGitSyncNow}
                                    >
                                      {gitSyncBusy === "sync-now" ? "Syncing..." : "Sync Now"}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>

                            <div className="settings-row">
                              <div className="settings-row-left">
                                <div className="settings-row-label">Repository</div>
                                <div className="settings-row-description">{gitSyncStatus.repo.url} · {gitSyncStatus.repo.branch}</div>
                              </div>
                              <div className="settings-row-right">
                                <div className="settings-folder settings-folder-column">
                                  <div className="settings-folder-actions">
                                    <button
                                      className="settings-folder-button"
                                      type="button"
                                      disabled={!gitSyncRemoteOpenUrl}
                                      onClick={() => window.electron?.openExternal?.({ url: gitSyncRemoteOpenUrl })}
                                    >
                                      Open Remote
                                    </button>
                                    <button
                                      className="settings-folder-button"
                                      type="button"
                                      onClick={handleGitSyncDisconnect}
                                    >
                                      Disconnect
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>

                            <div className="settings-row">
                              <div className="settings-row-left">
                                <div className="settings-row-label">Personal Access Token</div>
                                <div className="settings-row-description">
                                  {gitSyncStatus?.state === "auth-expired"
                                    ? "The saved token no longer works. Paste a replacement to resume sync."
                                    : "Rotate the saved token without reconnecting the repo."}
                                </div>
                              </div>
                              <div className="settings-row-right">
                                <div className="settings-folder settings-folder-column">
                                  <input
                                    className="homepage-search git-sync-input git-sync-input-wide"
                                    type="password"
                                    value={gitSyncPat}
                                    onChange={(e) => setGitSyncPat(e.target.value)}
                                    placeholder="github_pat_..."
                                  />
                                  <div className="settings-folder-actions">
                                    <button
                                      className="settings-folder-button"
                                      type="button"
                                      disabled={!gitSyncPat.trim() || gitSyncBusy === "update-token"}
                                      onClick={handleGitSyncUpdateCredentials}
                                    >
                                      {gitSyncBusy === "update-token" ? "Updating..." : "Update Token"}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>

                            <div className="settings-row settings-row-section">
                              <div className="settings-row-left">
                                <div className="settings-row-label">Sync Behavior</div>
                              </div>
                            </div>

                            <div className="settings-row">
                              <div className="settings-row-left">
                                <div className="settings-row-label">Machine Label</div>
                                <div className="settings-row-description">Identifies this device in commit messages and conflict copies.</div>
                              </div>
                              <div className="settings-row-right">
                                <input
                                  className="homepage-search git-sync-input"
                                  value={gitSyncMachineLabel}
                                  onChange={(e) => setGitSyncMachineLabel(e.target.value)}
                                  onBlur={() => saveGitSyncSettings({ machineLabel: gitSyncMachineLabel })}
                                  placeholder="machine label"
                                />
                              </div>
                            </div>

                            <div className="settings-row">
                              <div className="settings-row-left">
                                <div className="settings-row-label">Auto Sync</div>
                                <div className="settings-row-description">Sync changes automatically after the selected idle interval.</div>
                              </div>
                              <div className="settings-row-right">
                                <div className="git-sync-row-controls">
                                  <label className="settings-toggle">
                                    <input
                                      type="checkbox"
                                      checked={gitSyncAuto}
                                      onChange={async (e) => {
                                        const next = e.target.checked;
                                        setGitSyncAuto(next);
                                        await saveGitSyncSettings({ autoSync: next });
                                      }}
                                    />
                                    <span className="settings-toggle-slider"></span>
                                  </label>
                                  <input
                                    className="homepage-search git-sync-input git-sync-input-branch"
                                    type="number"
                                    min={1}
                                    value={gitSyncIntervalMinutes}
                                    onChange={(e) => setGitSyncIntervalMinutes(Math.max(1, Number(e.target.value) || 1))}
                                    onBlur={() => saveGitSyncSettings({ intervalMinutes: gitSyncIntervalMinutes })}
                                  />
                                  <span className="git-sync-inline-label">min</span>
                                </div>
                              </div>
                            </div>

                            <div className="settings-row git-sync-row-stacked">
                              <div className="settings-row-left">
                                <div className="settings-row-label">Synced Timelines</div>
                                <div className="settings-row-description">
                                  Unchecking a timeline or folder adds it to the shared exclusion list stored in this repo. Other devices stop syncing it after they pull the change.
                                </div>
                              </div>
                              <div className="settings-row-right">
                                <div className="settings-folder settings-folder-column git-sync-tree-wrap git-sync-tree-panel">
                                  {gitSyncTree.children.length > 0 ? gitSyncTree.children.map((node) => renderGitSyncTreeNode(node)) : (
                                    <div className="settings-row-description">No local timelines found.</div>
                                  )}
                                </div>
                              </div>
                            </div>

                            <div className="settings-row settings-row-section">
                              <div className="settings-row-left">
                                <div className="settings-row-label">Repository Options</div>
                              </div>
                            </div>

                            <div className="settings-row">
                              <div className="settings-row-left">
                                <div className="settings-row-label">Generate README</div>
                                <div className="settings-row-description">Write a README listing your timelines and viewer links into the repo. Turn off to keep the repo file-only.</div>
                              </div>
                              <div className="settings-row-right">
                                <label className="settings-toggle">
                                  <input
                                    type="checkbox"
                                    checked={gitSyncStatus?.writeReadme !== false}
                                    onChange={(e) => saveGitSyncSettings({ writeReadme: e.target.checked })}
                                  />
                                  <span className="settings-toggle-slider"></span>
                                </label>
                              </div>
                            </div>

                            <div className="settings-row">
                              <div className="settings-row-left">
                                <div className="settings-row-label">Mirror</div>
                                <div className="settings-row-description">
                                  Timelines keeps a local clone of the repo{gitSyncMirrorBytes == null ? "" : ` (${formatMirrorBytes(gitSyncMirrorBytes)})`}. Rebuild it if history grows large or the mirror looks out of sync; your library is never touched.
                                </div>
                              </div>
                              <div className="settings-row-right">
                                <div className="settings-folder settings-folder-column">
                                  <div className="settings-folder-actions">
                                    <button
                                      className="settings-folder-button"
                                      type="button"
                                      disabled={gitSyncBusy === "rebuild" || gitSyncStatus?.state === "syncing"}
                                      onClick={handleGitSyncRebuild}
                                    >
                                      {gitSyncBusy === "rebuild" ? "Rebuilding..." : "Rebuild Mirror"}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </>
                        )}

                        {(gitSyncStatus?.exportErrors?.length > 0 || gitSyncStatus?.importErrors?.length > 0 || gitSyncError) && (
                          <div className="settings-row">
                            <div className="settings-row-left">
                              {gitSyncStatus?.exportErrors?.map((e, i) => (
                                <div key={`ex:${i}`} className="settings-path-error">{e.error || `${e.path} could not be synced.`}</div>
                              ))}
                              {gitSyncStatus?.importErrors?.map((e, i) => (
                                <div key={`im:${i}`} className="settings-path-error">{`${e.path}: ${e.error || "could not be imported."}`}</div>
                              ))}
                              {gitSyncError && <div className="settings-path-error">{gitSyncError}</div>}
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}

                {settingsSection === "files" && (
                  <>
                    <div className="settings-row">
                      <div className="settings-row-left">
                        <div className="settings-row-label">Timeline Folder</div>
                        <div
                          className="settings-path-pill settings-path-pill-clickable"
                          title={timelineStorageDir || "Default app storage"}
                          onClick={() => onOpenTimelinesFolder?.()}
                        >
                          <Folder className="settings-path-icon" size={14} />
                          <span className="settings-path-text">
                            {timelineStorageDir || "Default app storage"}
                          </span>
                        </div>
                        {timelinePathIssue && (
                          <div className="settings-path-error">{timelinePathIssue}</div>
                        )}
                      </div>
                      <div className="settings-row-right">
                        <div className="settings-folder settings-folder-column">
                          <div className="settings-folder-actions">
                            <button
                              className="settings-folder-button"
                              type="button"
                              onClick={() => onPickTimelinesDir?.()}
                            >
                              Choose...
                            </button>
                            <button
                              className="settings-folder-button"
                              type="button"
                              onClick={() => onTimelineStorageDirChange?.("")}
                            >
                              Use Default
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="settings-row">
                      <div className="settings-row-left">
                        <div className="settings-row-label">Notes Folder</div>
                        <div
                          className="settings-path-pill settings-path-pill-clickable"
                          title={notesStorageDir || "Default app storage"}
                          onClick={() => onOpenNotesFolder?.()}
                        >
                          <Folder className="settings-path-icon" size={14} />
                          <span className="settings-path-text">
                            {notesStorageDir || "Default app storage"}
                          </span>
                        </div>
                        {notesPathIssue && (
                          <div className="settings-path-error">{notesPathIssue}</div>
                        )}
                      </div>
                      <div className="settings-row-right">
                        <div className="settings-folder settings-folder-column">
                          <div className="settings-folder-actions">
                            <button
                              className="settings-folder-button"
                              type="button"
                              onClick={() => onPickNotesDir?.()}
                            >
                              Choose...
                            </button>
                            <button
                              className="settings-folder-button"
                              type="button"
                              onClick={() => onNotesStorageDirChange?.("")}
                            >
                              Use Default
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="settings-row">
                      <div className="settings-row-left">
                        <div className="settings-row-label">Assets Folder</div>
                        <div
                          className="settings-path-pill settings-path-pill-clickable"
                          title={assetsStorageDir || "Default app storage"}
                          onClick={() => onOpenAssetsFolder?.()}
                        >
                          <Folder className="settings-path-icon" size={14} />
                          <span className="settings-path-text">
                            {assetsStorageDir || "Default app storage"}
                          </span>
                        </div>
                      </div>
                      <div className="settings-row-right">
                        <div className="settings-folder settings-folder-column">
                          <div className="settings-folder-actions">
                            <button
                              className="settings-folder-button"
                              type="button"
                              onClick={() => onPickAssetsDir?.()}
                            >
                              Choose...
                            </button>
                            <button
                              className="settings-folder-button"
                              type="button"
                              onClick={() => onAssetsStorageDirChange?.("")}
                            >
                              Use Default
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                )}

              </div>
            </div>
          </div>
        </div>
      )}

      {deleteDialogFile && (
        <div
          className="settings-backdrop"
          onClick={() => setDeleteDialogFile(null)}
        >
          <div
            className="settings-modal confirm-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="settings-header">
              <h2 className="settings-title">DELETE TIMELINE</h2>
              <button
                className="settings-back-button"
                onClick={() => setDeleteDialogFile(null)}
                aria-label="Close delete dialog"
              >
                <X size={18} strokeWidth={2} />
              </button>
            </div>

            <div className="confirm-content">
              <p className="confirm-text">
                Are you sure you want to delete "{deleteDialogFile.name}"? This cannot be
                undone.
              </p>
              <label className="confirm-checkbox">
                <input
                  type="checkbox"
                  checked={deleteDialogWithNotes}
                  onChange={(e) => setDeleteDialogWithNotes(e.target.checked)}
                />
                Also delete notes for this timeline
              </label>
              <label className="confirm-checkbox">
                <input
                  type="checkbox"
                  checked={deleteDialogWithAssets}
                  onChange={(e) => setDeleteDialogWithAssets(e.target.checked)}
                />
                Also delete images for this timeline
              </label>
            </div>

            <div className="confirm-actions">
              <button
                className="settings-folder-button"
                onClick={() => setDeleteDialogFile(null)}
              >
                Cancel
              </button>
              <button
                className="settings-folder-button confirm-delete-button"
                onClick={handleConfirmDelete}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {contextMenu && (
        <div
          ref={menuRef}
          className="timeline-context-menu"
          style={{
            position: 'fixed',
            ...(contextMenu.nearRight
              ? { right: `${window.innerWidth - contextMenu.x}px` }
              : { left: `${contextMenu.x}px` }),
            top: `${contextMenu.y}px`,
          }}
        >
          <button
            className="context-menu-item"
            onClick={() => handleMenuAction(() => openTimelineFile(contextMenu.file))}
          >
            <File size={16} />
            <span>{contextMenu.file.isPackage ? 'Import' : 'Open'}</span>
          </button>

          {!contextMenu.file.isPackage && (
            <button
              className="context-menu-item"
              onClick={() => handleMenuAction(() => handleOpenGitSyncShare(contextMenu.file))}
            >
              <Share2 size={16} />
              <span>Share Viewer Link</span>
            </button>
          )}

          {!contextMenu.file.isPackage && (
            <button
              className="context-menu-item"
              onClick={() => handleMenuAction(() => handleOpenGitSyncHistory(contextMenu.file))}
            >
              <History size={16} />
              <span>Version History</span>
            </button>
          )}

          {!contextMenu.file.isPackage && gitSyncConnected && (
            <button
              className="context-menu-item"
              onClick={() => handleMenuAction(() => handleToggleNeverSync(contextMenu.file))}
            >
              <CloudOff size={16} />
              <span>{contextMenu.file.neverSync ? 'Allow syncing to GitHub' : 'Never sync to GitHub'}</span>
            </button>
          )}

          {!contextMenu.file.isPackage && (
            <div className="context-menu-separator" />
          )}

          {!contextMenu.file.isPackage && (
            <button
              className="context-menu-item"
              onClick={() => handleMenuAction(() => handleDuplicate(contextMenu.file))}
            >
              <Copy size={16} />
              <span>Duplicate</span>
            </button>
          )}

          {!contextMenu.file.isPackage && (
            <button
              className="context-menu-item"
              onClick={() => handleMenuAction(() => { setRenameTarget({ type: 'timeline', id: contextMenu.file.id, currentName: contextMenu.file.name }); setRenameName(contextMenu.file.name); })}
            >
              <Pencil size={16} />
              <span>Rename</span>
            </button>
          )}
          <button
            className="context-menu-item"
            onClick={() => handleMenuAction(() => handleOpenMoveDialog(contextMenu.file))}
          >
            <Folder size={16} />
            <span>Move to Folder</span>
          </button>

          <div className="context-menu-separator" />

          <button
            className="context-menu-item"
            onClick={() => handleMenuAction(() => handleDelete(contextMenu.file))}
          >
            <Trash2 size={16} />
            <span>Delete</span>
          </button>
        </div>
      )}

      {gitSyncShareDialog && (
        <div className="settings-backdrop" onClick={() => setGitSyncShareDialog(null)}>
          <div className="folder-modal git-sync-modal" onClick={(e) => e.stopPropagation()}>
            <div className="git-sync-modal-title">Share {gitSyncShareDialog.file?.name}</div>
            {gitSyncShareDialog.loading && (
              <p className="folder-modal-text">Loading share info…</p>
            )}
            {gitSyncShareDialog.error && (
              <p className="folder-modal-text folder-modal-error">{gitSyncShareDialog.error}</p>
            )}
            {!gitSyncShareDialog.loading && gitSyncShareDialog.info && (
              <>
                <p className="folder-modal-text">
                  Viewer links currently work for GitHub remotes and require the repo to be public.
                </p>
                {!gitSyncShareDialog.info.canShareViewer ? (
                  <p className="folder-modal-text">
                    This remote does not map to a GitHub viewer link yet.
                  </p>
                ) : (
                  <>
                    {gitSyncShareDialog.info.pending && (
                      <p className="folder-modal-text">
                        This timeline has local changes or unpushed commits. Sync before sharing if you want the latest version online.
                      </p>
                    )}

                    <div className="git-sync-link-block">
                      <div className="git-sync-link-label">Latest Branch Link</div>
                      <code className="git-sync-link-code">{gitSyncShareDialog.info.viewerUrl}</code>
                      <div className="folder-modal-actions">
                        {gitSyncShareDialog.info.pending ? (
                          <button className="folder-modal-btn folder-modal-btn-primary" onClick={() => handleSyncAndCopyGitSyncLink("viewerUrl")}>
                            Sync & Copy
                          </button>
                        ) : (
                          <button className="folder-modal-btn folder-modal-btn-primary" onClick={() => handleCopyGitSyncLink("viewerUrl")}>
                            {gitSyncShareDialog.copied === "viewerUrl" ? "Copied" : "Copy Link"}
                          </button>
                        )}
                        <button className="folder-modal-btn" onClick={() => window.electron?.openExternal?.({ url: gitSyncShareDialog.info.viewerUrl })}>
                          <ExternalLink size={14} />
                          <span>Open</span>
                        </button>
                      </div>
                    </div>

                    {gitSyncShareDialog.info.exactViewerUrl && (
                      <div className="git-sync-link-block">
                        <div className="git-sync-link-label">Last Synced Exact-Version Link</div>
                        <code className="git-sync-link-code">{gitSyncShareDialog.info.exactViewerUrl}</code>
                        <div className="folder-modal-actions">
                          <button className="folder-modal-btn folder-modal-btn-primary" onClick={() => handleCopyGitSyncLink("exactViewerUrl")}>
                            {gitSyncShareDialog.copied === "exactViewerUrl" ? "Copied" : "Copy Exact Link"}
                          </button>
                          <button className="folder-modal-btn" onClick={() => window.electron?.openExternal?.({ url: gitSyncShareDialog.info.exactViewerUrl })}>
                            <Link2 size={14} />
                            <span>Open</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
            <div className="folder-modal-actions">
              <button className="folder-modal-btn" onClick={() => setGitSyncShareDialog(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {gitSyncHistoryDialog && (
        <div className="settings-backdrop" onClick={() => setGitSyncHistoryDialog(null)}>
          <div className="folder-modal git-sync-modal git-sync-history-modal" onClick={(e) => e.stopPropagation()}>
            <div className="git-sync-modal-title">Version History: {gitSyncHistoryDialog.file?.name}</div>
            {gitSyncHistoryDialog.loading && (
              <p className="folder-modal-text">Loading history…</p>
            )}
            {gitSyncHistoryDialog.error && (
              <p className="folder-modal-text folder-modal-error">{gitSyncHistoryDialog.error}</p>
            )}
            {!gitSyncHistoryDialog.loading && gitSyncHistoryDialog.history && (
              <>
                {gitSyncHistoryDialog.history.entries.length === 0 ? (
                  <p className="folder-modal-text">No synced history found for this timeline yet.</p>
                ) : (
                  <div className="git-sync-history-list">
                    {gitSyncHistoryDialog.history.entries.map((entry) => (
                      <div key={entry.oid} className="git-sync-history-item">
                        <div className="git-sync-history-main">
                          <div className="git-sync-history-subject">{entry.subject || entry.oid.slice(0, 7)}</div>
                          <div className="git-sync-history-meta">
                            {formatDateTime(entry.committedAt)} · {entry.authorName || "Unknown author"} · {entry.oid.slice(0, 7)}
                          </div>
                          {entry.summary && (
                            <div className="git-sync-history-summary">{entry.summary}</div>
                          )}
                        </div>
                        <div className="git-sync-history-actions">
                          {entry.viewerUrl && (
                            <button className="folder-modal-btn" onClick={() => window.electron?.openExternal?.({ url: entry.viewerUrl })}>
                              <ExternalLink size={14} />
                              <span>Open</span>
                            </button>
                          )}
                          <button
                            className="folder-modal-btn folder-modal-btn-primary"
                            disabled={gitSyncHistoryDialog.restoringOid === entry.oid}
                            onClick={() => handleRestoreGitSyncVersion(entry.oid)}
                          >
                            {gitSyncHistoryDialog.restoringOid === entry.oid ? "Restoring…" : "Restore as Copy"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            <div className="folder-modal-actions">
              <button className="folder-modal-btn" onClick={() => setGitSyncHistoryDialog(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      <MarketplaceModal
        isOpen={isMarketplaceOpen}
        onClose={() => setIsMarketplaceOpen(false)}
        appThemes={appThemes}
        userThemes={userThemes}
        userThemeIds={userThemeIds}
        bundledThemes={bundledThemes}
        defaultThemeKey={defaultThemeKey}
        appThemeKey={appThemeKey}
        onAppThemeChange={onAppThemeChange}
        onRefreshThemes={onRefreshThemes}
      />
      {folderContextMenu && (
        <div
          ref={menuRef}
          className="timeline-context-menu"
          style={{
            position: 'fixed',
            ...(folderContextMenu.nearRight
              ? { right: `${window.innerWidth - folderContextMenu.x}px` }
              : { left: `${folderContextMenu.x}px` }),
            top: `${folderContextMenu.y}px`,
          }}
        >
          <button
            className="context-menu-item"
            onClick={() => { setRenameTarget({ type: 'folder', id: folderContextMenu.folderPath, currentName: folderContextMenu.folderName }); setRenameName(folderContextMenu.folderName); setFolderContextMenu(null); }}
          >
            <Pencil size={16} />
            <span>Rename</span>
          </button>
          <button
            className="context-menu-item"
            onClick={async () => { const fc = folderContextMenu; setFolderContextMenu(null); const folders = await listFolders(); setAvailableFolders(folders.filter(f => f !== fc.folderPath && !f.startsWith(fc.folderPath + '/') && !f.split('/').some(part => part.startsWith('.') || part.endsWith('.assets')))); setMoveFolderTarget(fc); }}
          >
            <Folder size={16} />
            <span>Move to Folder</span>
          </button>
          <div className="context-menu-separator" />
          <button
            className="context-menu-item context-menu-item-danger"
            onClick={() => { const fc = folderContextMenu; setFolderContextMenu(null); const fileCount = timelineFiles.filter(f => (f.folder ?? '').startsWith(fc.folderPath)).length; setDeleteFolderTarget({ ...fc, fileCount }); }}
          >
            <Trash2 size={16} />
            <span>Delete</span>
          </button>
        </div>
      )}

      {renameTarget && (
        <div className="settings-backdrop" onClick={closeRenameDialog}>
          <div className="folder-modal" onClick={(e) => e.stopPropagation()}>
            <input
              ref={renameInputRef}
              className="folder-modal-input"
              type="text"
              value={renameName}
              onChange={(e) => {
                setRenameName(e.target.value);
                if (renameError) setRenameError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleRename();
                }
              }}
              autoFocus
            />
            {renameError && <p className="folder-modal-text folder-modal-error">{renameError}</p>}
            <div className="folder-modal-actions">
              <button className="folder-modal-btn" onClick={closeRenameDialog}>Cancel</button>
              <button className="folder-modal-btn folder-modal-btn-primary" onClick={handleRename} disabled={!renameName.trim()}>Rename</button>
            </div>
          </div>
        </div>
      )}

      {deleteFolderTarget && (
        <div className="settings-backdrop" onClick={() => setDeleteFolderTarget(null)}>
          <div className="folder-modal" onClick={(e) => e.stopPropagation()}>
            <p className="folder-modal-text">
              <strong>{deleteFolderTarget.folderName}</strong>
              {deleteFolderTarget.fileCount > 0
                ? ` contains ${deleteFolderTarget.fileCount} timeline${deleteFolderTarget.fileCount !== 1 ? 's' : ''}. This cannot be undone.`
                : ' will be permanently deleted.'}
            </p>
            <div className="folder-modal-actions">
              <button className="folder-modal-btn" onClick={() => setDeleteFolderTarget(null)}>Cancel</button>
              <button className="folder-modal-btn folder-modal-btn-danger" onClick={handleDeleteFolder}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {moveFolderTarget && (
        <div className="settings-backdrop" onClick={() => setMoveFolderTarget(null)}>
          <MovePicker folders={availableFolders} currentFolder={null} onConfirm={handleMoveFolder} onCancel={() => setMoveFolderTarget(null)} />
        </div>
      )}

      {newFolderDialogOpen && (
        <div className="settings-backdrop" onClick={() => setNewFolderDialogOpen(false)}>
          <div className="folder-modal" onClick={(e) => e.stopPropagation()}>
            <input
              className="folder-modal-input"
              type="text"
              placeholder="Folder name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateFolder()}
              autoFocus
            />
            <div className="folder-modal-actions">
              <button className="folder-modal-btn" onClick={() => setNewFolderDialogOpen(false)}>Cancel</button>
              <button className="folder-modal-btn folder-modal-btn-primary" onClick={handleCreateFolder} disabled={!newFolderName.trim()}>Create</button>
            </div>
          </div>
        </div>
      )}

      {moveDialogFile && (
        <div className="settings-backdrop" onClick={() => setMoveDialogFile(null)}>
          <MovePicker folders={availableFolders} currentFolder={moveDialogFile.folder ?? ''} onConfirm={handleMoveTimeline} onCancel={() => setMoveDialogFile(null)} />
        </div>
      )}
    </div>
  );
}
