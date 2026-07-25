import { useMemo, useState, useRef, useEffect, useCallback, startTransition } from "react";
import TimelineView from "./components/TimelineView";
import SpreadsheetView from "./components/SpreadsheetView";
import Sidebar from "./components/Sidebar";
import RightPanel from "./components/RightPanel";
import ErrorBoundary from "./components/ErrorBoundary";
import SettingsModal from "./components/SettingsModal";
import NewTimelineModal from "./components/NewTimelineModal";
import ExportPngModal from "./components/ExportPngModal";
import ExportVideoModal from "./components/ExportVideoModal";
import TopBar from "./components/TopBar";
import HomePage from "./components/HomePage";
import SearchOverlay from "./components/SearchOverlay";
import {
  saveTimelineToFile,
  chooseTimelinesDir,
  chooseNotesDir,
  chooseAssetsDir,
  openAssetsFolder,
  listFonts,
  openFontsFolder,
  openTimelinesFolder,
  openNotesFolder,
  deleteNote,
  deleteAsset,
  renameTimeline,
  copyTimelineStorage,
  exportTimelinePackage,
  importTimeline,
  updateTimelineTitle,
} from "./utils/electronApi";
import { updateElementWithNewId, generateUniqueRandomElementId, generateIdFromTitle, generateStorageUid, getStorageId, ensureUniqueElementIds } from "./utils/idUtils";
import { applyTheme, getInitialThemeKey } from "./utils/theme";
import { loadThemeConfig } from "./utils/themeLoader";
import { countOldFormatThemes, isOldFormatTheme, migrateThemeColors } from "./utils/themeMigration";
import { getAppSettings, saveAppSettings } from "./utils/appSettings";
import { cloneDefaultKeybinds, loadKeybinds, matchesKeybind } from "./utils/keybinds";
import { parseTimelineInput, snapToMonthGrid, snapToDayGrid } from "./utils/dateUtils";
import { parseFilterQuery } from "./utils/filterUtils";
import "./styles/index.css";

const DEFAULT_GROUP_ID = "g-main";
const DEFAULT_GROUP = {
  id: DEFAULT_GROUP_ID,
  title: "Main",
  order: 0,
  stack: 0,
  hideBand: true,
  visible: true,
  locked: false,
};
const EMPTY_SELECTION_NAVIGATION = Object.freeze({
  selectedElement: null,
  prevElement: null,
  nextElement: null,
});
const SELECTION_NAV_REPEAT_INTERVAL_MS = 140;
const CARD_THUMBNAIL_WIDTH = 640;
const CARD_THUMBNAIL_HEIGHT = 240;

const createCardThumbnail = (imageUrl) => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = CARD_THUMBNAIL_WIDTH;
    canvas.height = CARD_THUMBNAIL_HEIGHT;
    const context = canvas.getContext("2d");
    if (!context) {
      reject(new Error("Could not create thumbnail canvas"));
      return;
    }

    const rootStyles = getComputedStyle(document.documentElement);
    context.fillStyle = rootStyles.getPropertyValue("--surface").trim() || "#fffaf4";
    context.fillRect(0, 0, canvas.width, canvas.height);

    const scale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    resolve(canvas.toDataURL("image/jpeg", 0.82));
  };
  image.onerror = () => reject(new Error("Could not load generated timeline preview"));
  image.src = imageUrl;
});

// Bare filename of a local thumbnail; null for external URLs
const getLocalThumbnailFilename = (thumbnail) => {
  if (!thumbnail || typeof thumbnail !== "string") return null;
  if (thumbnail.startsWith("timelines-asset://")) {
    try {
      const url = new URL(thumbnail);
      const p = url.searchParams.get("p");
      const decoded = p !== null ? p : decodeURIComponent(url.pathname.slice(1));
      return decoded.split(/[\\/]/).pop() || null;
    } catch {
      return null;
    }
  }
  if (!thumbnail.includes("://")) return thumbnail.split(/[\\/]/).pop() || null;
  return null;
};

function App() {
  const normalizeTimelineData = useCallback((data) => {
    if (!data || typeof data !== "object") return data;

    const elements = ensureUniqueElementIds(Array.isArray(data.elements) ? data.elements : []);
    const groupsRaw = Array.isArray(data.file?.groups) ? data.file.groups : [];
    const sourceGroups = groupsRaw.length > 0 ? groupsRaw : [DEFAULT_GROUP];
    const groups = sourceGroups.map((group, index) => {
      const fallbackId = index === 0 ? DEFAULT_GROUP_ID : `g-${index + 1}`;
      return {
        ...DEFAULT_GROUP,
        ...group,
        id: group?.id || fallbackId,
        title: group?.title || (index === 0 ? "Main" : `Group ${index + 1}`),
        order: Number.isFinite(group?.order) ? group.order : index,
        stack: Number.isFinite(group?.stack) ? group.stack : index,
        visible: group?.visible !== false,
        locked: group?.locked === true,
        belowLine: group?.belowLine === true,
      };
    });
    const groupIdSet = new Set(groups.map((group) => group?.id).filter(Boolean));
    const defaultGroupId = groups[0]?.id || DEFAULT_GROUP_ID;

    // Migrate old parent-defined branches/forks/merges to child-defined parent/mergeParent.
    const branchParentMap = {};
    const mergeParentMap = {};
    for (const el of elements) {
      if (el.type !== "span") continue;
      const branches = Array.isArray(el.branches) ? el.branches : [];
      const forks = Array.isArray(el.forks) ? el.forks : [];
      const allBranches = Array.from(new Set([...branches, ...forks]));
      for (const childId of allBranches) {
        branchParentMap[childId] = el.id;
      }
      const merges = Array.isArray(el.merges) ? el.merges : [];
      for (const childId of merges) {
        mergeParentMap[childId] = el.id;
      }
    }

    const spanGroupById = Object.fromEntries(
      elements.filter((el) => el.type === "span" && groupIdSet.has(el.groupId)).map((el) => [el.id, el.groupId])
    );

    const nextElements = elements.map((element) => {
      const next = { ...element };
      const needsGroupId = next.type === "event" || next.type === "span";
      if (needsGroupId && !groupIdSet.has(next.groupId)) {
        const parentGroupId = next.type === "event" && Array.isArray(next.parents)
          ? next.parents.map((pid) => spanGroupById[pid]).find(Boolean)
          : undefined;
        next.groupId = parentGroupId ?? defaultGroupId;
      }

      // Strip stale default color auto-set on every new event by an older version.
      if (next.type === "event" && next.color === "#EDE6DA") {
        delete next.color;
      }

      if (next.type !== "span") return next;

      const { branches: _b, forks: _f, merges: _m, ...rest } = next;
      if (!rest.parent && branchParentMap[element.id]) {
        rest.parent = branchParentMap[element.id];
      }
      if (!rest.mergeParent && mergeParentMap[element.id]) {
        rest.mergeParent = mergeParentMap[element.id];
      }
      return rest;
    });

    const file = { ...(data.file || {}), groups };
    if (file.useWikipedia && !file.useWiki) {
      file.useWiki = file.useWikipedia;
    }
    delete file.useWikipedia;

    return { ...data, file, elements: nextElements };
  }, []);

  const [themeConfig, setThemeConfig] = useState(loadThemeConfig());
  const [oldFormatThemeCount, setOldFormatThemeCount] = useState(0);
  const MIN_WIDTH = 220;
  const MAX_WIDTH = 600;
  const COLLAPSED_WIDTH = 44;
  const DEFAULT_LEFT_WIDTH = 350;
  const DEFAULT_RIGHT_WIDTH = 385;

  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_LEFT_WIDTH);
  const [rightWidth, setRightWidth] = useState(DEFAULT_RIGHT_WIDTH);
  const [isLeftCollapsed, setIsLeftCollapsed] = useState(false);
  const [isRightCollapsed, setIsRightCollapsed] = useState(false);
  const [rightLockState, setRightLockState] = useState(null); // null | "open" | "closed"
  const [viewMode, setViewMode] = useState("timeline"); // "timeline" | "spreadsheet"
  const [isRightMaximized, setIsRightMaximized] = useState(false);
  const [lastSelectedId, setLastSelectedId] = useState(null);

  const [selectedId, setSelectedId] = useState(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsRenameError, setSettingsRenameError] = useState("");
  const [screenshotToast, setScreenshotToast] = useState(false);
  const [deleteElementDialog, setDeleteElementDialog] = useState(null);
  const [deleteElementWithNotes, setDeleteElementWithNotes] = useState(false);
  const [deleteElementWithImage, setDeleteElementWithImage] = useState(false);
  const [downloadPngTrigger, setDownloadPngTrigger] = useState(0);
  const [timelineData, setTimelineData] = useState(null);
  const [currentTimelineId, setCurrentTimelineId] = useState(null);
  const currentTimelineIdRef = useRef(null);
  const [isNewTimelineModalOpen, setIsNewTimelineModalOpen] = useState(false);
  const [importConflict, setImportConflict] = useState(null); // { title, sourcePath }
  const [skippedFilesNotice, setSkippedFilesNotice] = useState(null); // { title, message, files }
  const [isExportPngModalOpen, setIsExportPngModalOpen] = useState(false);
  const [exportPngOptions, setExportPngOptions] = useState(null);
  const [isExportVideoModalOpen, setIsExportVideoModalOpen] = useState(false);
  const [editRequestId, setEditRequestId] = useState(null);
  const defaultThemeKey = useMemo(() => getInitialThemeKey(themeConfig), [themeConfig]);
  const [themeKey, setThemeKey] = useState(defaultThemeKey);
  const [appThemeKey, setAppThemeKey] = useState(defaultThemeKey);
  const [appThemePreference, setAppThemePreference] = useState(defaultThemeKey);
  const [timelineStorageDir, setTimelineStorageDir] = useState("");
  const [notesStorageDir, setNotesStorageDir] = useState("");
  const [assetsStorageDir, setAssetsStorageDir] = useState("");
  const [appFontFamily, setAppFontFamily] = useState("Inter");
  const [appFontSize, setAppFontSize] = useState(14);
  const [hardwareAcceleration, setHardwareAcceleration] = useState(true);
  const [startMaximized, setStartMaximized] = useState(false);
  const [keybinds, setKeybinds] = useState(() => cloneDefaultKeybinds());
  const [availableFonts, setAvailableFonts] = useState([]);
  const [activeTags, setActiveTags] = useState([]);
  const [hiddenTags, setHiddenTags] = useState([]);
  const [pinnedTags, setPinnedTags] = useState([]);
  const [chipQuery, setChipQuery] = useState("");
  const parsedChipQuery = useMemo(() => parseFilterQuery(chipQuery), [chipQuery]);
  const [viewportYear, setViewportYear] = useState(null);
  const handleViewportYearChange = useCallback((year) => {
    startTransition(() => {
      setViewportYear(year);
    });
  }, []);
  const [homeSettingsSignal, setHomeSettingsSignal] = useState(0);
  const [isAppSettingsOverlayOpen, setIsAppSettingsOverlayOpen] = useState(false);
  const [returnToProjectSettings, setReturnToProjectSettings] = useState(false);
  const [isProjectSettingsCovered, setIsProjectSettingsCovered] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [diskReloadNotice, setDiskReloadNotice] = useState(false);
  const [thumbnailRefreshSignal, setThumbnailRefreshSignal] = useState(0);

  const HISTORY_LIMIT = 100;
  const historyRef = useRef({ past: [], future: [] });
  const historyLockRef = useRef(false);
  const prevTimelineRef = useRef(null);
  const lastTimelineIdRef = useRef(null);
  const timelineDataRef = useRef(null);
  const selectedIdRef = useRef(null);
  const selectionNavRepeatRef = useRef({ previous: 0, next: 0 });
  const leftWidthRef = useRef(DEFAULT_LEFT_WIDTH);
  const rightWidthRef = useRef(DEFAULT_RIGHT_WIDTH);
  const leftCollapsedRef = useRef(false);
  const rightCollapsedRef = useRef(false);
  const isDraggingLeft = useRef(false);
  const isDraggingRight = useRef(false);
  const rightMaxReachedRef = useRef(false);
  const rightReversedAfterMaxRef = useRef(false);
  const rightLastDistanceRef = useRef(null);
  const timelineViewRef = useRef(null);
  const currentLeftWidth = isLeftCollapsed ? COLLAPSED_WIDTH : sidebarWidth;

  useEffect(() => {
    function handleMouseMove(e) {
      if (isDraggingLeft.current) {
        e.preventDefault();
        const dragX = e.clientX;
        if (isLeftCollapsed && dragX > 30) {
          setIsLeftCollapsed(false);
          setSidebarWidth(Math.min(Math.max(dragX, MIN_WIDTH), MAX_WIDTH));
        } else if (!isLeftCollapsed && dragX < 50) {
          setIsLeftCollapsed(true);
        } else if (!isLeftCollapsed) {
          setSidebarWidth(Math.min(Math.max(dragX, MIN_WIDTH), MAX_WIDTH));
        }
      } else if (isDraggingRight.current) {
        e.preventDefault();
        if (!selectedIdRef.current) return;
        const windowWidth = window.innerWidth;
        const distanceFromRight = windowWidth - e.clientX;
        const maximizeThreshold = MAX_WIDTH + 24;
        if (!Number.isFinite(rightLastDistanceRef.current)) {
          rightLastDistanceRef.current = distanceFromRight;
        }
        if (isRightCollapsed && distanceFromRight > 30) {
          const next = Math.min(Math.max(distanceFromRight, MIN_WIDTH), MAX_WIDTH);
          setIsRightCollapsed(false);
          setRightWidth(next);
          setIsRightMaximized(false);
          rightLastDistanceRef.current = distanceFromRight;
        } else if (!isRightCollapsed && distanceFromRight < 50) {
          setIsRightCollapsed(true);
          setIsRightMaximized(false);
        } else if (!isRightCollapsed && distanceFromRight > maximizeThreshold) {
          if (rightMaxReachedRef.current && rightReversedAfterMaxRef.current) {
            setIsRightMaximized(true);
          }
        } else if (!isRightCollapsed) {
          const lastDistance = rightLastDistanceRef.current;
          if (
            rightMaxReachedRef.current &&
            Number.isFinite(lastDistance) &&
            distanceFromRight < lastDistance - 4
          ) {
            rightReversedAfterMaxRef.current = true;
          }
          const next = Math.min(Math.max(distanceFromRight, MIN_WIDTH), MAX_WIDTH);
          if (isRightMaximized) setIsRightMaximized(false);
          setRightWidth(next);
          if (next >= MAX_WIDTH) {
            rightMaxReachedRef.current = true;
          }
          rightLastDistanceRef.current = distanceFromRight;
        }
      }
    }

    function handleMouseUp() {
      if (isDraggingLeft.current || isDraggingRight.current) {
        isDraggingLeft.current = false;
        isDraggingRight.current = false;
        rightMaxReachedRef.current = false;
        rightReversedAfterMaxRef.current = false;
        rightLastDistanceRef.current = null;
        document.body.classList.remove("dragging");
      }
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isLeftCollapsed, isRightCollapsed, isRightMaximized]);

  useEffect(() => {
    timelineDataRef.current = timelineData;
  }, [timelineData]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    leftWidthRef.current = currentLeftWidth;
  }, [currentLeftWidth]);

  useEffect(() => {
    rightWidthRef.current = rightWidth;
  }, [rightWidth]);

  useEffect(() => {
    leftCollapsedRef.current = isLeftCollapsed;
  }, [isLeftCollapsed]);

  useEffect(() => {
    rightCollapsedRef.current = isRightCollapsed;
  }, [isRightCollapsed]);

  useEffect(() => {
    function handleKeyDown(e) {
      if (!selectedId) return;
      const target = e.target;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      const deleteBind = keybinds.delete;
      const altDeleteBind = { keys: ["Backspace"] };
      if (!matchesKeybind(e, deleteBind) && !matchesKeybind(e, altDeleteBind)) return;
      e.preventDefault();
      if (!timelineData?.elements) return;
      const element = timelineData.elements.find(el => el.id === selectedId);
      if (!element) return;
      handleRequestDelete(element.id);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedId, timelineData, keybinds]);


  const refreshUserThemes = async () => {
    if (!window.electron?.listThemes) return;
    try {
      const bundledThemes = loadThemeConfig().themes || {};
      const userThemes = await window.electron.listThemes();
      setThemeConfig((prev) => ({
        ...prev,
        themes: {
          ...bundledThemes,
          ...(userThemes || {}),
        },
      }));
      setOldFormatThemeCount(countOldFormatThemes(userThemes));
    } catch (error) {
      console.error('Failed to load user themes:', error);
    }
  };

  const handleMigrateOldThemes = async () => {
    if (!window.electron?.listThemes || !window.electron?.saveUserTheme) return 0;
    try {
      const userThemes = await window.electron.listThemes();
      const oldEntries = Object.entries(userThemes || {}).filter(([, theme]) => isOldFormatTheme(theme));

      for (const [key, theme] of oldEntries) {
        const migrated = migrateThemeColors(theme);
        await window.electron.saveUserTheme({ id: key, content: JSON.stringify(migrated, null, 2) });
      }

      await refreshUserThemes();
      return oldEntries.length;
    } catch (error) {
      console.error('Failed to migrate themes:', error);
      return 0;
    }
  };

  useEffect(() => {
    refreshUserThemes();
  }, []);

  useEffect(() => {
    const loadFonts = async () => {
      const result = await listFonts();
      if (!result?.success) return;
      setAvailableFonts(result.fonts || []);
    };

    loadFonts();
  }, []);

  useEffect(() => {
    const resolvedDefault = getInitialThemeKey(themeConfig);
    setThemeKey((current) =>
      themeConfig.themes?.[current] ? current : resolvedDefault
    );
  }, [themeConfig]);

  useEffect(() => {
    const fileId = timelineData?.file?.id || null;
    if (fileId !== lastTimelineIdRef.current) {
      historyRef.current = { past: [], future: [] };
      prevTimelineRef.current = timelineData;
      lastTimelineIdRef.current = fileId;
    }
  }, [timelineData?.file?.id]);

  useEffect(() => {
    if (!timelineData) {
      historyRef.current = { past: [], future: [] };
      prevTimelineRef.current = null;
      return;
    }

    if (historyLockRef.current) {
      historyLockRef.current = false;
      prevTimelineRef.current = timelineData;
      return;
    }

    if (prevTimelineRef.current && timelineData !== prevTimelineRef.current) {
      const nextPast = [...historyRef.current.past, prevTimelineRef.current];
      if (nextPast.length > HISTORY_LIMIT) {
        nextPast.shift();
      }
      historyRef.current = { past: nextPast, future: [] };
    }

    prevTimelineRef.current = timelineData;
  }, [timelineData]);

  // Keep ref in sync so saveCurrentTimeline can read it inside stale closures
  useEffect(() => { currentTimelineIdRef.current = currentTimelineId; }, [currentTimelineId]);

  useEffect(() => {
    if (!window.electron?.onGitSyncApplied) return undefined;
    const handleApplied = (ids) => {
      if (Array.isArray(ids) && currentTimelineIdRef.current && ids.includes(currentTimelineIdRef.current)) {
        setDiskReloadNotice(true);
      }
    };
    return window.electron.onGitSyncApplied(handleApplied);
  }, []);

  // Serialize renames/saves so an in-flight save can't land after a rename and recreate the old file
  const persistQueueRef = useRef(Promise.resolve());
  const enqueuePersist = useCallback((task) => {
    const next = persistQueueRef.current.catch(() => {}).then(task);
    persistQueueRef.current = next.catch(console.error);
    return next;
  }, []);

  // Saves the open timeline where it currently lives; explicit-path writes use saveTimelineToFile via enqueuePersist
  const saveCurrentTimeline = useCallback(async (data) => {
    const id = currentTimelineIdRef.current || data?.file?.id?.replace(/-timeline$/, '') || 'timeline';
    return enqueuePersist(() => saveTimelineToFile(data, id));
  }, [enqueuePersist]);

  const handleCloseSettings = useCallback(() => {
    setSettingsRenameError("");
    setIsSettingsOpen(false);
  }, []);

  const handleLibraryTimelineRenamed = useCallback(({ oldId, newId, title, fileId }) => {
    if (!oldId || !newId || currentTimelineIdRef.current !== oldId) return;
    currentTimelineIdRef.current = newId;
    setCurrentTimelineId(newId);
    setTimelineData((prevData) => {
      if (!prevData) return prevData;
      return {
        ...prevData,
        file: {
          ...prevData.file,
          id: fileId || `${newId.split('/').pop() || 'timeline'}-timeline`,
          title: title ?? prevData.file?.title,
        },
      };
    });
  }, []);

  const handleRenameTimelineFromLibrary = useCallback(async (id, title) => {
    if (!id) return { success: false, error: 'Missing timeline id' };
    if (!title || !String(title).trim()) return { success: false, error: 'INVALID_TITLE' };

    if (currentTimelineIdRef.current !== id || !timelineData) {
      const result = await updateTimelineTitle(id, title);
      if (result?.success) handleLibraryTimelineRenamed(result);
      return result;
    }

    const oldPathId = currentTimelineIdRef.current;
    const nextTimelineId = generateIdFromTitle(title, "timeline").replace(/^timeline-/, "");
    if (!nextTimelineId) return { success: false, error: 'INVALID_TITLE' };

    const folderPrefix = oldPathId.includes('/')
      ? oldPathId.slice(0, oldPathId.lastIndexOf('/') + 1)
      : '';
    const nextPathId = `${folderPrefix}${nextTimelineId}`;
    const updatedData = {
      ...timelineData,
      file: {
        ...timelineData.file,
        id: `${nextTimelineId}-timeline`,
        title,
      },
    };

    if (nextPathId === oldPathId) {
      setTimelineData(updatedData);
      const result = await enqueuePersist(() => saveTimelineToFile(updatedData, oldPathId));
      if (!result?.success) return result;
      return { success: true, oldId: oldPathId, newId: nextPathId, title, fileId: updatedData.file.id };
    }

    currentTimelineIdRef.current = nextPathId;
    setCurrentTimelineId(nextPathId);
    setTimelineData(updatedData);

    const result = await enqueuePersist(async () => {
      const renameResult = await renameTimeline({ oldId: oldPathId, newId: nextPathId });
      if (!renameResult?.success) return renameResult;
      return saveTimelineToFile(updatedData, nextPathId);
    });

    if (!result?.success) {
      currentTimelineIdRef.current = oldPathId;
      setCurrentTimelineId(oldPathId);
      setTimelineData(timelineData);
      return result;
    }

    return { success: true, oldId: oldPathId, newId: nextPathId, title, fileId: updatedData.file.id };
  }, [enqueuePersist, handleLibraryTimelineRenamed, timelineData]);

  const undoTimeline = () => {
    if (!timelineData) return;
    const { past, future } = historyRef.current;
    if (past.length === 0) return;

    const previous = past[past.length - 1];
    historyRef.current = {
      past: past.slice(0, -1),
      future: [timelineData, ...future],
    };

    historyLockRef.current = true;
    setTimelineData(previous);

    saveCurrentTimeline(previous).catch(console.error);
  };

  const redoTimeline = () => {
    if (!timelineData) return;
    const { past, future } = historyRef.current;
    if (future.length === 0) return;

    const next = future[0];
    historyRef.current = {
      past: [...past, timelineData].slice(-HISTORY_LIMIT),
      future: future.slice(1),
    };

    historyLockRef.current = true;
    setTimelineData(next);

    saveCurrentTimeline(next).catch(console.error);
  };

  useEffect(() => {
    const handleUndoRedo = (e) => {
      if (!timelineData) return;
      const target = e.target;
      const isEditable =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;
      if (isEditable) return;
      if (matchesKeybind(e, keybinds.undo)) {
        e.preventDefault();
        undoTimeline();
      } else if (matchesKeybind(e, keybinds.redo)) {
        e.preventDefault();
        redoTimeline();
      } else if (e.shiftKey && e.key === "S") {
        e.preventDefault();
        window.electron?.captureScreenshot()
          .then(() => { setScreenshotToast(true); setTimeout(() => setScreenshotToast(false), 2000); })
          .catch((err) => console.error("[screenshot] error:", err));
      }
    };

    window.addEventListener("keydown", handleUndoRedo);
    return () => window.removeEventListener("keydown", handleUndoRedo);
  }, [timelineData, currentTimelineId, keybinds]);

  useEffect(() => {
    if (!timelineData) return;
    const handleSearchKey = (e) => {
      if (!matchesKeybind(e, keybinds.search)) return;
      const target = e.target;
      const isEditable =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;
      if (isEditable) return;
      e.preventDefault();
      setIsSearchOpen(true);
    };
    window.addEventListener("keydown", handleSearchKey);
    return () => window.removeEventListener("keydown", handleSearchKey);
  }, [timelineData, keybinds]);

  useEffect(() => {
    if (!timelineData) return;
    const handleAddShortcuts = (e) => {
      const target = e.target;
      const isEditable =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;
      if (isEditable) return;

      if (matchesKeybind(e, keybinds.newEvent)) {
        e.preventDefault();
        handleAddEvent();
      } else if (matchesKeybind(e, keybinds.newSpan)) {
        e.preventDefault();
        handleAddSpan();
      } else if (matchesKeybind(e, keybinds.newEra)) {
        e.preventDefault();
        handleAddEra();
      }
    };

    window.addEventListener("keydown", handleAddShortcuts);
    return () => window.removeEventListener("keydown", handleAddShortcuts);
  }, [timelineData, keybinds, viewportYear]);

  const handleSelect = (id) => {
    setSelectedId(id);
    if (id) setLastSelectedId(id);
    if (id && rightLockState !== "closed") setIsRightCollapsed(false);
  };

  const handleSearchSelect = (id) => {
    handleSelect(id);
    requestAnimationFrame(() => {
      timelineViewRef.current?.scrollToElement(id);
    });
  };

  const handleCenterGroup = (groupId) => {
    timelineViewRef.current?.scrollToGroup(groupId);
  };

  useEffect(() => {
    if (!selectedId && isRightMaximized && rightLockState !== "open") {
      setIsRightMaximized(false);
    }
    if (!selectedId && rightLockState !== "open") {
      if (!isRightCollapsed) {
        // default: collapse when nothing selected
      }
    }
  }, [selectedId, isRightMaximized, isRightCollapsed, rightLockState]);

  const handleToggleTag = (tag) => {
    setActiveTags((prev) => {
      if (prev.includes(tag)) {
        return prev.filter((value) => value !== tag);
      }
      return [...prev, tag];
    });
    setHiddenTags((prev) => prev.filter((value) => value !== tag));
  };

  const handleToggleHiddenTag = (tag) => {
    setHiddenTags((prev) => {
      if (prev.includes(tag)) {
        return prev.filter((value) => value !== tag);
      }
      return [...prev, tag];
    });
    setActiveTags((prev) => prev.filter((value) => value !== tag));
  };

  const handleClearTags = () => {
    setActiveTags([]);
    setHiddenTags([]);
  };

  const handleAddGroup = () => {
    setTimelineData((prevData) => {
      const existing = Array.isArray(prevData.file?.groups) ? prevData.file.groups : [];
      const existingIds = new Set(existing.map((group) => group?.id).filter(Boolean));
      let nextIndex = existing.length + 1;
      let nextId = `g-${nextIndex}`;
      while (existingIds.has(nextId)) {
        nextIndex += 1;
        nextId = `g-${nextIndex}`;
      }

      const nextGroup = {
        id: nextId,
        title: `Group ${nextIndex}`,
        order: existing.length,
        stack: existing.length,
        visible: true,
        locked: false,
      };

      const updatedData = {
        ...prevData,
        file: {
          ...prevData.file,
          groups: [...existing, nextGroup],
        },
      };

      saveCurrentTimeline(updatedData).catch(console.error);
      return updatedData;
    });
  };

  const handleUpdateGroup = (groupId, updates) => {
    if (!groupId || !updates || typeof updates !== "object") return;
    setTimelineData((prevData) => {
      const existing = Array.isArray(prevData.file?.groups) ? prevData.file.groups : [];
      const baseGroups = existing.length > 0 ? existing : [DEFAULT_GROUP];
      const nextGroups = baseGroups.map((group) => (
        group.id === groupId ? { ...group, ...updates } : group
      ));
      const hasMatch = baseGroups.some((group) => group.id === groupId);
      const finalGroups = hasMatch
        ? nextGroups
        : [...nextGroups, { ...DEFAULT_GROUP, id: groupId, ...updates }];
      const updatedData = {
        ...prevData,
        file: {
          ...prevData.file,
          groups: finalGroups,
        },
      };
      saveCurrentTimeline(updatedData).catch(console.error);
      return updatedData;
    });
  };

  const handleSetElementGroup = (elementId, groupTitle) => {
    if (!elementId || !groupTitle?.trim()) return;
    const title = groupTitle.trim();
    setTimelineData((prevData) => {
      const existing = Array.isArray(prevData.file?.groups) ? prevData.file.groups : [];
      let group = existing.find((g) => g.title.toLowerCase() === title.toLowerCase());
      let updatedGroups = existing;
      if (!group) {
        const existingIds = new Set(existing.map((g) => g.id).filter(Boolean));
        let nextIndex = existing.length + 1;
        let nextId = `g-${nextIndex}`;
        while (existingIds.has(nextId)) { nextIndex++; nextId = `g-${nextIndex}`; }
        group = { id: nextId, title, order: existing.length, stack: existing.length, visible: true, locked: false, hideBand: true };
        updatedGroups = [...existing, group];
      }
      const updatedElements = (prevData.elements ?? []).map((el) =>
        el.id === elementId ? { ...el, groupId: group.id } : el
      );
      const updatedData = { ...prevData, file: { ...prevData.file, groups: updatedGroups }, elements: updatedElements };
      saveCurrentTimeline(updatedData).catch(console.error);
      return updatedData;
    });
  };

  const handleUpdateTagColor = (tag, color) => {
    if (!tag) return;
    setTimelineData((prevData) => {
      const prevTagColors = prevData.file?.tagColors || {};
      const nextTagColors = color
        ? { ...prevTagColors, [tag]: color }
        : Object.fromEntries(Object.entries(prevTagColors).filter(([k]) => k !== tag));
      const updatedData = {
        ...prevData,
        file: { ...prevData.file, tagColors: nextTagColors },
      };
      saveCurrentTimeline(updatedData).catch(console.error);
      return updatedData;
    });
  };

  const handleDeleteGroup = (groupId) => {
    if (!groupId) return;
    setTimelineData((prevData) => {
      const existing = Array.isArray(prevData.file?.groups) ? prevData.file.groups : [];
      const baseGroups = existing.length > 0 ? existing : [DEFAULT_GROUP];
      if (baseGroups.length <= 1) return prevData;

      const remainingGroups = baseGroups.filter((group) => group.id !== groupId);
      if (remainingGroups.length === 0) return prevData;
      const fallbackGroupId = remainingGroups[0].id;

      const nextElements = (prevData.elements || []).map((element) => {
        if ((element.type === "event" || element.type === "span") && element.groupId === groupId) {
          return { ...element, groupId: fallbackGroupId };
        }
        return element;
      });

      const normalizedGroups = remainingGroups.map((group, index) => ({
        ...group,
        order: index,
      }));

      const updatedData = {
        ...prevData,
        file: {
          ...prevData.file,
          groups: normalizedGroups,
        },
        elements: nextElements,
      };
      saveCurrentTimeline(updatedData).catch(console.error);
      return updatedData;
    });
  };

  const handleFilterByTag = (tag) => {
    setActiveTags([tag]);
    setHiddenTags((prev) => prev.filter((value) => value !== tag));
  };

  const handleTogglePinnedTag = (tag) => {
    if (!tag) return;
    const nextPinnedTags = pinnedTags.includes(tag)
      ? pinnedTags.filter((value) => value !== tag)
      : [...pinnedTags, tag];
    setPinnedTags(nextPinnedTags);
    setTimelineData((prevData) => {
      if (!prevData?.file) return prevData;
      const nextFile = { ...prevData.file };
      if (nextPinnedTags.length > 0) {
        nextFile.pinnedTags = nextPinnedTags;
      } else {
        delete nextFile.pinnedTags;
      }
      const updatedData = { ...prevData, file: nextFile };
      saveCurrentTimeline(updatedData).catch(console.error);
      return updatedData;
    });
  };

  const handleEditElement = (id) => {
    setSelectedId(id);
    setEditRequestId(id);
  };

  const handleRequestDelete = (elementId) => {
    if (!timelineData?.elements) return;
    const ids = new Set(Array.isArray(elementId) ? elementId : [elementId]);
    const targets = timelineData.elements.filter((el) => ids.has(el.id));
    if (!targets.length) return;
    setDeleteElementDialog(targets);
    setDeleteElementWithNotes(false);
    setDeleteElementWithImage(false);
  };

  const handleConfirmDeleteElement = async () => {
    const targets = deleteElementDialog;
    if (!targets?.length) return;
    const timelineId = getStorageId(timelineData?.file) || 'timeline';
    const deletedIds = new Set(targets.map((el) => el.id));
    const removedImages = new Set();
    for (const element of targets) {
      if (deleteElementWithNotes && element.noteFile) {
        await deleteNote({ timelineId, filename: element.noteFile }).catch(console.error);
      }
      if (deleteElementWithImage) {
        const filename = getLocalThumbnailFilename(element.thumbnail);
        // Don't delete the file if a surviving element still references the same image
        const sharedWithSurvivor = filename && timelineData?.elements?.some(
          (el) => !deletedIds.has(el.id) && getLocalThumbnailFilename(el.thumbnail) === filename
        );
        if (filename && !sharedWithSurvivor && !removedImages.has(filename)) {
          removedImages.add(filename);
          await deleteAsset({ timelineId, filename }).catch(console.error);
        }
      }
    }
    handleDelete([...deletedIds]);
    setDeleteElementDialog(null);
  };

  const handleUpdate = async (updatedElement) => {
    const originalId = updatedElement.id;

    setTimelineData((prevData) => {
      const nextElement = { ...updatedElement };
      if (!nextElement.dateLabel) delete nextElement.dateLabel;
      if (!nextElement.startLabel) delete nextElement.startLabel;
      if (!nextElement.endLabel) delete nextElement.endLabel;
      delete nextElement.dateInput;
      delete nextElement.startInput;
      delete nextElement.endInput;

      const updatedData = updateElementWithNewId(prevData, nextElement, originalId);

      
      saveCurrentTimeline(updatedData)
        .then(() => {
          console.log('Timeline saved to file successfully');
        })
        .catch((error) => {
          console.error('Failed to save timeline to file:', error);
        });

      return updatedData;
    });
  };

  const handleAddEvent = (groupId, clickYear, clickCoords) => {
    if (!timelineData?.file) return;
    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
    const fallbackMid = (timelineData.file.start + timelineData.file.end) / 2;
    const baseYear = Number.isFinite(clickYear) ? clickYear : Number.isFinite(viewportYear) ? viewportYear : fallbackMid;
    const clampedYear = clamp(baseYear, timelineData.file.start, timelineData.file.end);
    const snappedYear = timelineData.file.useCalendar === true ? snapToDayGrid(clampedYear) : Math.round(clampedYear);
    const eventId = generateUniqueRandomElementId(timelineData.elements, "event");
    const newEvent = {
      id: eventId,
      type: "event",
      title: "New Event",
      date: snappedYear,
      groupId: groupId || null,
      parents: [],
      eventLineStyle: "solid",
      eventBorderStyle: "solid",
    };
    if (Number.isFinite(clickCoords?.lat) && Number.isFinite(clickCoords?.lng)) {
      newEvent.lat = clickCoords.lat;
      newEvent.lng = clickCoords.lng;
    }

    setTimelineData((prevData) => {
      const updatedData = {
        ...prevData,
        elements: [...prevData.elements, newEvent],
      };

      saveCurrentTimeline(updatedData).catch(console.error);

      return updatedData;
    });

    setSelectedId(newEvent.id);
    setEditRequestId(newEvent.id);
  };

  const handleAddSpan = (groupId, clickYear, clickCoords) => {
    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
    const range = timelineData.file.end - timelineData.file.start;
    const duration = Math.max(1, Math.floor(range / 4));
    const fallbackStart = timelineData.file.start + Math.floor(range / 2);
    const baseStart = Number.isFinite(clickYear) ? clickYear : Number.isFinite(viewportYear) ? viewportYear : fallbackStart;
    const start = clamp(baseStart, timelineData.file.start, timelineData.file.end);
    const snappedStart = timelineData.file.useCalendar === true ? snapToDayGrid(start) : Math.round(start);
    const end = clamp(snappedStart + duration, timelineData.file.start, timelineData.file.end);

    const spanId = generateUniqueRandomElementId(timelineData.elements, "span");
    const defaultGroupId = groupId || timelineData.file?.groups?.[0]?.id || DEFAULT_GROUP_ID;
    const newSpan = {
      id: spanId,
      type: "span",
      title: "New Span",
      start: snappedStart,
      end,
      groupId: defaultGroupId,
      color: "#A6977E",
    };
    if (Number.isFinite(clickCoords?.lat) && Number.isFinite(clickCoords?.lng)) {
      newSpan.lat = clickCoords.lat;
      newSpan.lng = clickCoords.lng;
    }

    setTimelineData((prevData) => {
      const updatedData = {
        ...prevData,
        elements: [...prevData.elements, newSpan],
      };

      saveCurrentTimeline(updatedData).catch(console.error);

      return updatedData;
    });

    setSelectedId(newSpan.id);
    setEditRequestId(newSpan.id);
  };

  const handleAddEra = (_clickYear, clickCoords) => {
    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
    const tlStart = timelineData.file.start;
    const tlEnd = timelineData.file.end;
    const range = tlEnd - tlStart;
    const duration = Math.max(1, Math.floor(range / 3));

    const topLevelEras = timelineData.elements
      .filter((el) => el.type === "era")
      .sort((a, b) => a.start - b.start);

    const isFree = (s, e) => !topLevelEras.some((era) => s < era.end && e > era.start);

    // Try placing after each existing top-level era, then at timeline start
    const candidates = [tlStart, ...topLevelEras.map((era) => era.end)];
    let start = tlStart;
    let end = clamp(tlStart + duration, tlStart, tlEnd);
    for (const candidate of candidates) {
      const s = clamp(candidate, tlStart, tlEnd);
      const e = clamp(s + duration, tlStart, tlEnd);
      if (e > s && isFree(s, e)) {
        start = s;
        end = e;
        break;
      }
    }

    const eraId = generateUniqueRandomElementId(timelineData.elements, "era");
    const newEra = {
      id: eraId,
      type: "era",
      title: "New Era",
      start,
      end,
      color: "#F4D05A",
    };
    if (Number.isFinite(clickCoords?.lat) && Number.isFinite(clickCoords?.lng)) {
      newEra.lat = clickCoords.lat;
      newEra.lng = clickCoords.lng;
    }

    setTimelineData((prevData) => {
      const updatedData = {
        ...prevData,
        elements: [...prevData.elements, newEra],
      };

      saveCurrentTimeline(updatedData).catch(console.error);

      return updatedData;
    });

    setSelectedId(newEra.id);
    setEditRequestId(newEra.id);
  };

  const handleDuplicateElement = (elementId) => {
    setTimelineData((prevData) => {
      const original = prevData.elements.find((el) => el.id === elementId);
      if (!original) return prevData;

      const nextTitle = `${original.title} Copy`;
      const nextId = generateUniqueRandomElementId(prevData.elements, original.type);

      const baseCopy = {
        ...original,
        id: nextId,
        title: nextTitle,
      };

      if (original.type === "span") {
        delete baseCopy.parent;
        delete baseCopy.extendFrom;
        delete baseCopy.mergeParent;
      }

      const updatedData = {
        ...prevData,
        elements: [...prevData.elements, baseCopy],
      };

      saveCurrentTimeline(updatedData).catch(console.error);

      return updatedData;
    });
  };

  const handleDelete = (elementId) => {
    const toDelete = new Set(Array.isArray(elementId) ? elementId : [elementId]);
    setTimelineData((prevData) => {
      const filteredElements = prevData.elements.filter((el) => !toDelete.has(el.id));

      const cleanedElements = filteredElements.map(el => {
        if (el.type === "event" && el.parents?.some((id) => toDelete.has(id))) {
          return {
            ...el,
            parents: el.parents.filter((id) => !toDelete.has(id)),
          };
        }

        if (el.type === "span" && (toDelete.has(el.parent) || toDelete.has(el.extendFrom) || toDelete.has(el.mergeParent))) {
          const cleaned = { ...el };
          if (toDelete.has(cleaned.parent)) delete cleaned.parent;
          if (toDelete.has(cleaned.extendFrom)) delete cleaned.extendFrom;
          if (toDelete.has(cleaned.mergeParent)) delete cleaned.mergeParent;
          return cleaned;
        }

        return el;
      });

      const updatedData = {
        ...prevData,
        elements: cleanedElements,
      };

      saveCurrentTimeline(updatedData).catch(console.error);

      return updatedData;
    });

    setSelectedId(null);
  };

  const handleUpdateTimeline = useCallback(({
    title,
    start,
    end,
    detailLevel,
    tickDensity,
    negID,
    posID,
    theme,
    font,
    startLabel,
    endLabel,
    useCalendar,
    scaleSections,
    layout,
    branchOrdering,
    fixedEventHeight,
    eventWidth,
    eventFontSize,
    thinConnectors,
    hideSpanConnectors,
    eventLinesToGroupBottom,
    hideDecimals,
    showGrid,
    showTodayLine,
    spanColorEvents,
    disableGroups,
    panelGroupMode,
    nestEraSubGroups,
    autoHideEmptyGroups,
    showPopularTags,
    keepSelection,
    useSecondaryBg,
    useWiki,
    useSpreadsheet,
    useMaps,
    mapTileUrl,
    mapLimitToViewportYear,
    mapEventMarker,
    mapSpanMarker,
    mapEraMarker,
    scaleType,
    logScaleFactor,
  }) => {
    const parsedStart = parseTimelineInput(start);
    const parsedEnd = parseTimelineInput(end);
    setTimelineData((prevData) => {
      const oldTimelineId = prevData.file?.id?.replace(/-timeline$/, '') || 'timeline';
      const nextTimelineId = title
        ? generateIdFromTitle(title, "timeline").replace(/^timeline-/, "")
        : oldTimelineId;
      const applyMonthSnap = useCalendar === true;
      const startValue = parsedStart.value ?? prevData.file.start;
      const endValue = parsedEnd.value ?? prevData.file.end;
      const nextFile = {
        ...prevData.file,
        id: `${nextTimelineId}-timeline`,
        title,
        start:
          applyMonthSnap && parsedStart.precision !== "day"
            ? snapToMonthGrid(startValue)
            : startValue,
        end:
          applyMonthSnap && parsedEnd.precision !== "day"
            ? snapToMonthGrid(endValue)
            : endValue,
        detailLevel,
        tickDensity,
        negID,
        posID,
        theme,
        font,
        startLabel,
        endLabel,
        useCalendar: useCalendar || undefined,
        scaleSections,
        layout,
        branchOrdering,
        fixedEventHeight,
        eventWidth,
        eventFontSize,
        thinConnectors,
        hideSpanConnectors,
        eventLinesToGroupBottom,
        hideDecimals,
        showGrid,
        showTodayLine,
        spanColorEvents,
        disableGroups,
        panelGroupMode,
        nestEraSubGroups,
        autoHideEmptyGroups,
        showPopularTags,
        keepSelection,
        useSecondaryBg,
        useWiki,
        useSpreadsheet,
        useMaps,
        mapTileUrl,
        mapLimitToViewportYear,
        mapEventMarker,
        mapSpanMarker,
        mapEraMarker,
        scaleType,
        logScaleFactor,
      };

      // Clean up legacy breaks field when saving with new scaleSections
      delete nextFile.breaks;
      if (!startLabel) delete nextFile.startLabel;
      if (!endLabel) delete nextFile.endLabel;
      delete nextFile.useMonths;
      delete nextFile.useDays;
      delete nextFile.datePrecision;
      if (!nextFile.useCalendar) delete nextFile.useCalendar;
      if (!tickDensity || tickDensity === 1) delete nextFile.tickDensity;
      if (!scaleSections || scaleSections.length === 0) delete nextFile.scaleSections;
      if (!scaleType || scaleType === "default") delete nextFile.scaleType;
      if (!logScaleFactor || scaleType !== "logarithmic") delete nextFile.logScaleFactor;
      if (!layout) delete nextFile.layout;
      if (!branchOrdering) delete nextFile.branchOrdering;
      if (!fixedEventHeight) delete nextFile.fixedEventHeight;
      delete nextFile.compactEvents;
      delete nextFile.eventHeight;
      if (!eventWidth || eventWidth === 150) delete nextFile.eventWidth;
      if (!eventFontSize || eventFontSize === 10) delete nextFile.eventFontSize;
      if (!thinConnectors) delete nextFile.thinConnectors;
      if (!eventLinesToGroupBottom) delete nextFile.eventLinesToGroupBottom;
      if (!hideDecimals) delete nextFile.hideDecimals;
      if (!showGrid) delete nextFile.showGrid;
      if (!showTodayLine) delete nextFile.showTodayLine;
      if (!spanColorEvents) delete nextFile.spanColorEvents;
      if (!disableGroups) delete nextFile.disableGroups;
      if (!panelGroupMode || panelGroupMode === "default") delete nextFile.panelGroupMode;
      if (!nestEraSubGroups) delete nextFile.nestEraSubGroups;
      if (!autoHideEmptyGroups) delete nextFile.autoHideEmptyGroups;
      delete nextFile.useEraGroupsInPanel;
      delete nextFile.useSpanGroupsInPanel;
      if (!keepSelection) delete nextFile.keepSelection;
      if (!useWiki) delete nextFile.useWiki;
      if (!useSpreadsheet) delete nextFile.useSpreadsheet;
      if (!useMaps) delete nextFile.useMaps;
      if (!mapTileUrl) delete nextFile.mapTileUrl;
      if (!mapLimitToViewportYear) delete nextFile.mapLimitToViewportYear;
      if (!mapEventMarker || mapEventMarker === "pin") delete nextFile.mapEventMarker;
      if (!mapSpanMarker || mapSpanMarker === "circle") delete nextFile.mapSpanMarker;
      if (!mapEraMarker || mapEraMarker === "diamond") delete nextFile.mapEraMarker;
      if (!font || String(font).toLowerCase() === "default") delete nextFile.font;

      const updatedData = {
        ...prevData,
        file: nextFile,
      };

      // The physical file lives at currentTimelineId, which carries the folder; file.id never does
      const oldPathId = currentTimelineIdRef.current || oldTimelineId;
      const folderPrefix = oldPathId.includes('/') ? oldPathId.slice(0, oldPathId.lastIndexOf('/') + 1) : '';
      const nextPathId = `${folderPrefix}${nextTimelineId}`;

      // Rename only on an actual title edit; a HomePage rename legitimately leaves title and filename out of sync
      const titleChanged = title !== prevData.file?.title;
      if (titleChanged && nextPathId !== oldPathId) {
        // The effect syncing this ref runs post-render, too late for the save below
        currentTimelineIdRef.current = nextPathId;
        setCurrentTimelineId(nextPathId);
        const oldTitle = prevData.file?.title;
        enqueuePersist(async () => {
          const result = await renameTimeline({ oldId: oldPathId, newId: nextPathId });
          if (result?.error === 'EXISTS') {
            setSettingsRenameError(`A timeline named "${title}" already exists. Keeping the name "${oldTitle}".`);
            const revertedData = { ...updatedData, file: { ...updatedData.file, id: `${oldTimelineId}-timeline`, title: oldTitle } };
            currentTimelineIdRef.current = oldPathId;
            setCurrentTimelineId(oldPathId);
            setTimelineData(revertedData);
            return saveTimelineToFile(revertedData, oldPathId);
          }
          setSettingsRenameError("");
          return saveTimelineToFile(updatedData, nextPathId);
        }).catch(console.error);
      } else {
        saveCurrentTimeline(updatedData).catch(console.error);
      }

      return updatedData;
    });
  }, [enqueuePersist, saveCurrentTimeline]);

  const handlePatchFile = (patch) => {
    setTimelineData((prevData) => {
      const nextFile = { ...prevData.file, ...patch };
      if (!nextFile.panelGroupMode || nextFile.panelGroupMode === "default") delete nextFile.panelGroupMode;
      if (!nextFile.nestEraSubGroups) delete nextFile.nestEraSubGroups;
      if (nextFile.panelSortField !== "name") delete nextFile.panelSortField;
      if (nextFile.panelSortOrder !== "desc") delete nextFile.panelSortOrder;
      const updatedData = { ...prevData, file: nextFile };
      saveCurrentTimeline(updatedData).catch(console.error);
      return updatedData;
    });
  };

  const handleUpdateGroups = (nextGroups) => {
    setTimelineData((prevData) => {
      const updatedData = {
        ...prevData,
        file: {
          ...prevData.file,
          groups: nextGroups,
        },
      };
      saveCurrentTimeline(updatedData).catch(console.error);
      return updatedData;
    });
  };

  const handleDownloadJSON = () => {
    const dataStr = JSON.stringify(timelineData, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${timelineData.file?.id || 'timeline'}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDownloadPackage = async () => {
    const baseName = timelineData.file?.uid || timelineData.file?.id?.replace(/-timeline$/, "") || "timeline";
    const result = await exportTimelinePackage(timelineData, `${baseName}.timeline`);
    if (result?.success && result.skipped?.length > 0) {
      setSkippedFilesNotice({
        title: "EXPORT FINISHED",
        message: `Package exported, but ${result.skipped.length} referenced file(s) could not be found and were skipped:`,
        files: result.skipped,
      });
    } else if (result && !result.success && !result.canceled) {
      alert(`Failed to export package: ${result.error || "unknown error"}`);
    }
  };

  const finishImport = async (result) => {
    if (result?.success && result.id) {
      if (result.skipped?.length > 0) {
        setSkippedFilesNotice({
          title: "IMPORT FINISHED",
          message: `Imported, but ${result.skipped.length} bundled file(s) could not be written:`,
          files: result.skipped,
        });
      }
      await handleLoadTimeline(result.id);
    } else if (result && !result.success && !result.canceled) {
      alert(`Failed to import timeline: ${result.error || "unknown error"}`);
    }
  };

  // sourcePath skips the file picker
  const handleImportTimeline = async (sourcePath) => {
    const result = await importTimeline(
      typeof sourcePath === "string" && sourcePath ? { sourcePath } : undefined
    );
    if (result?.conflict) {
      setImportConflict({ title: result.title, sourcePath: result.sourcePath });
      return;
    }
    await finishImport(result);
  };

  const handleResolveImportConflict = async (resolution) => {
    const conflict = importConflict;
    setImportConflict(null);
    if (!conflict) return;
    await finishImport(await importTimeline({ sourcePath: conflict.sourcePath, resolution }));
  };

  const importConflictModal = importConflict && (
    <div className="settings-backdrop" onClick={() => setImportConflict(null)}>
      <div className="settings-modal confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2 className="settings-title">ALREADY IN LIBRARY</h2>
        </div>
        <div className="confirm-content">
          <p className="confirm-text">
            This file looks like "{importConflict.title}", a timeline that is already in
            your library. You can open your existing timeline, or import this file as a
            separate copy alongside it.
          </p>
        </div>
        <div className="confirm-actions">
          <button className="settings-folder-button" onClick={() => setImportConflict(null)}>
            Cancel
          </button>
          <button className="settings-folder-button" onClick={() => handleResolveImportConflict("copy")}>
            Import as Copy
          </button>
          <button className="settings-folder-button" onClick={() => handleResolveImportConflict("open-existing")}>
            Open Existing
          </button>
        </div>
      </div>
    </div>
  );

  const skippedFilesModal = skippedFilesNotice && (
    <div className="settings-backdrop" onClick={() => setSkippedFilesNotice(null)}>
      <div className="settings-modal confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2 className="settings-title">{skippedFilesNotice.title}</h2>
        </div>
        <div className="confirm-content">
          <p className="confirm-text">{skippedFilesNotice.message}</p>
          <ul className="confirm-file-list">
            {skippedFilesNotice.files.map((file, i) => (
              <li key={i}>{file}</li>
            ))}
          </ul>
        </div>
        <div className="confirm-actions">
          <button className="settings-folder-button" onClick={() => setSkippedFilesNotice(null)}>
            OK
          </button>
        </div>
      </div>
    </div>
  );

  const handleDownloadPNG = () => {
    // Open the export PNG modal
    setIsExportPngModalOpen(true);
  };

  const handleExportPng = (options) => {
    setExportPngOptions(options);
    setDownloadPngTrigger(prev => prev + 1);
  };

  const handleDownloadVideo = () => {
    setIsExportVideoModalOpen(true);
  };

  const handleLoadTimeline = async (timelineId) => {
    try {
      if (!window.electron?.loadTimeline) {
        throw new Error("Timeline loading is only available in the desktop app.");
      }
      const loadedTimeline = await window.electron.loadTimeline(timelineId);

      setTimelineData(normalizeTimelineData(loadedTimeline));
      setPinnedTags(Array.isArray(loadedTimeline.file?.pinnedTags) ? loadedTimeline.file.pinnedTags : []);
      setCurrentTimelineId(timelineId);
      setDiskReloadNotice(false);
      setSelectedId(null);
    } catch (error) {
      console.error('Failed to load timeline:', error);
      alert(`Failed to load timeline: ${error.message}`);
    }
  };

  const captureTimelineThumbnail = useCallback(async () => {
    const timelineId = getStorageId(timelineDataRef.current?.file);
    if (!timelineId || !timelineViewRef.current?.generatePreview || !window.electron?.saveTimelineThumbnail) return;

    try {
      const rootStyles = getComputedStyle(document.documentElement);
      const secondaryBg = rootStyles.getPropertyValue("--surface").trim() || "#fffaf4";
      const preview = await timelineViewRef.current.generatePreview({
        customBg: secondaryBg,
        maxWidth: 1280,
        maxHeight: 480,
        simplifyContent: true,
      });
      if (!preview?.imageUrl) return;
      const dataUrl = await createCardThumbnail(preview.imageUrl);
      const result = await window.electron.saveTimelineThumbnail({ timelineId, dataUrl });
      if (result?.success === false) throw new Error(result.error || "Thumbnail save failed");
      setThumbnailRefreshSignal((value) => value + 1);
    } catch (error) {
      console.warn("Could not update timeline card thumbnail:", error);
    }
  }, []);

  const handleBackToHome = async () => {
    // Capture while the timeline DOM is still mounted; no-ops in spreadsheet view
    await captureTimelineThumbnail();
    setTimelineData(null);
    setCurrentTimelineId(null);
    setSelectedId(null);
    setPinnedTags([]);
    setDiskReloadNotice(false);
    setIsSettingsOpen(false);
    setIsAppSettingsOverlayOpen(false);
    setReturnToProjectSettings(false);
    setIsProjectSettingsCovered(false);
    setHomeSettingsSignal(0);
  };

  const handleNewTimeline = () => {
    setIsNewTimelineModalOpen(true);
  };

  // Failures return { error } for inline display; native alerts break input focus in Electron
  const handleCreateTimeline = async (timelineConfig) => {
    // Create new timeline data structure
    const timelineId = generateIdFromTitle(timelineConfig.title, "timeline").replace(/^timeline-/, "");
      const newTimeline = {
        file: {
          id: `${timelineId}-timeline`,
          uid: generateStorageUid(timelineId),
          type: "timeline",
        title: timelineConfig.title,
        appVersion: "0.6.0-alpha.2",
        start: timelineConfig.start,
        end: timelineConfig.end,
          detailLevel: timelineConfig.detailLevel,
          theme: timelineConfig.theme || defaultThemeKey,
          startLabel: timelineConfig.startLabel,
          endLabel: timelineConfig.endLabel,
          layout: timelineConfig.layout || "Horizontal",
          branchOrdering: timelineConfig.branchOrdering || "later-first",
          useSpreadsheet: timelineConfig.useSpreadsheet || undefined,
          useMaps: timelineConfig.useMaps || undefined,
          useWiki: timelineConfig.useWiki || undefined,
          groups: [DEFAULT_GROUP],
        },
        elements: []
      };

    if (!timelineConfig.startLabel) delete newTimeline.file.startLabel;
    if (!timelineConfig.endLabel) delete newTimeline.file.endLabel;

    // Save to file system
    const saveId = timelineConfig.folder ? `${timelineConfig.folder}/${timelineId}` : timelineId;
    try {
      const result = await enqueuePersist(() => saveTimelineToFile(newTimeline, saveId, { create: true }));
      if (!result?.success) {
        if (result?.error === 'EXISTS') {
          return { error: `A timeline named "${timelineConfig.title}" already exists${timelineConfig.folder ? ' in that folder' : ''}. Choose a different name.` };
        }
        throw new Error(result?.error || 'Save failed');
      }

      // Load the newly created timeline
      setIsNewTimelineModalOpen(false);
      currentTimelineIdRef.current = saveId;
      setTimelineData(newTimeline);
      setCurrentTimelineId(saveId);
      setSelectedId(null);
      return { success: true };
    } catch (error) {
      console.error('Failed to create timeline:', error);
      return { error: `Failed to create timeline: ${error.message}` };
    }
  };

  const handleDuplicateTimeline = async () => {
    if (!timelineData || !currentTimelineId) return;

    try {
      const folderPrefix = currentTimelineId.includes('/')
        ? currentTimelineId.slice(0, currentTimelineId.lastIndexOf('/') + 1)
        : '';

      let duplicateData = null;
      let saveId = null;
      for (let counter = 1; counter <= 50; counter++) {
        const duplicateName = `${timelineData.file.title} Copy${counter > 1 ? ` ${counter}` : ''}`;
        const duplicateId = generateIdFromTitle(duplicateName, "timeline").replace(/^timeline-/, "");
        const candidateData = {
          ...timelineData,
          file: {
            ...timelineData.file,
            id: `${duplicateId}-timeline`,
            uid: generateStorageUid(duplicateId),
            title: duplicateName,
          },
        };
        const candidateId = `${folderPrefix}${duplicateId}`;
        const result = await enqueuePersist(() => saveTimelineToFile(candidateData, candidateId, { create: true }));
        if (result?.success) {
          duplicateData = candidateData;
          saveId = candidateId;
          break;
        }
        if (result?.error !== 'EXISTS') throw new Error(result?.error || 'Save failed');
      }
      if (!duplicateData) throw new Error('Could not find a free name for the copy');

      const sourceId = getStorageId(timelineData.file) || 'timeline';
      await copyTimelineStorage({ sourceId, targetId: getStorageId(duplicateData.file) });

      // Load the newly created duplicate
      currentTimelineIdRef.current = saveId;
      setTimelineData(duplicateData);
      setCurrentTimelineId(saveId);
      setSelectedId(null);
    } catch (error) {
      console.error('Failed to duplicate timeline:', error);
      alert(`Failed to duplicate timeline: ${error.message}`);
    }
  };

  const isElectron = window.electron !== undefined;

  const resolveThemeKey = useCallback((value, fallback = defaultThemeKey) => {
    if (!value) return fallback;
    const lower = String(value).toLowerCase();
    if (lower === "default") return fallback;
    const match = Object.keys(themeConfig.themes || {}).find(
      (key) => key.toLowerCase() === lower
    );
    return match || fallback;
  }, [defaultThemeKey, themeConfig]);

  const resolveFontStack = (family) => {
    const fallback =
      '"Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    if (!family) return fallback;
    const normalized = String(family);
    const lower = normalized.toLowerCase();
    if (lower === "default") return fallback;
    if (lower === "system") {
      return 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    }
    const safeName = normalized.replace(/([\\"])/g, "\\$1");
    return `"${safeName}", ${fallback}`;
  };

  const getThemeFont = useCallback((themeKeyValue) => {
    const theme = themeConfig.themes?.[themeKeyValue];
    if (!theme?.font?.family) return null;
    return {
      family: theme.font.family,
      cssUrl: theme.font.cssUrl,
    };
  }, [themeConfig]);

  const resolveFontChoice = (setting, themeFont) => {
    const normalized = String(setting || "").trim();
    const lower = normalized.toLowerCase();
    if (!normalized || lower === "default") {
      if (themeFont?.family) {
        return {
          family: themeFont.family,
          source: "theme",
          cssUrl: themeFont.cssUrl,
        };
      }
      return { family: "Inter", source: "inter" };
    }
    if (lower === "system") {
      return { family: "system", source: "system" };
    }
    return { family: normalized, source: "user" };
  };

  useEffect(() => {
    let isMounted = true;

    const loadAppSettings = async () => {
      const [settings, savedKeybinds] = await Promise.all([getAppSettings(), loadKeybinds()]);
      if (!isMounted) return;
      setAppThemePreference(settings?.theme || defaultThemeKey);
      const storedTimelineDir = settings?.timelineStorageDir ?? settings?.storageDir ?? "";
      const storedNotesDir = settings?.notesStorageDir ?? "";
      const storedAssetsDir = settings?.assetsStorageDir ?? "";
      const storedFontFamily = settings?.appFontFamily ?? "Inter";
      const storedFontSize = settings?.appFontSize ?? 14;
      setTimelineStorageDir(storedTimelineDir);
      setNotesStorageDir(storedNotesDir);
      setAssetsStorageDir(storedAssetsDir);
      setAppFontFamily(storedFontFamily);
      setAppFontSize(storedFontSize);
      setHardwareAcceleration(settings?.hardwareAcceleration !== false);
      setStartMaximized(settings?.startMaximized === true);
      setKeybinds(savedKeybinds);
    };

    loadAppSettings();
    return () => {
      isMounted = false;
    };
  }, [defaultThemeKey]);

  useEffect(() => {
    const resolved = resolveThemeKey(appThemePreference);
    setAppThemeKey(resolved);
  }, [appThemePreference, resolveThemeKey]);

  useEffect(() => {
    if (!timelineData) {
      setThemeKey(appThemeKey);
    }
  }, [appThemeKey, timelineData]);

  useEffect(() => {
    applyTheme(themeConfig, themeKey);
  }, [themeKey, themeConfig]);

  useEffect(() => {
    const styleId = "user-fonts";
    const style =
      document.getElementById(styleId) || document.createElement("style");
    style.id = styleId;
    const css = (availableFonts || [])
      .map((font) => {
        const name = String(font.name || "").replace(/([\\"])/g, "\\$1");
        if (!name || !font.fileUrl) return "";
        const isItalic = /italic/i.test(name);
        return `@font-face{font-family:"${name}";src:url("${font.fileUrl}") format("${font.format}");font-weight:normal;font-style:${isItalic ? "italic" : "normal"};font-display:swap;}`;
      })
      .filter(Boolean)
      .join("\n");
    style.textContent = css;
    if (!style.parentNode) {
      document.head.appendChild(style);
    }
  }, [availableFonts]);

  useEffect(() => {
    const themeFont = getThemeFont(themeKey);
    const appChoice = resolveFontChoice(appFontFamily, themeFont);
    const timelineSetting = timelineData?.file?.font;
    const useAppFont =
      !timelineSetting || String(timelineSetting).toLowerCase() === "default";
    const timelineChoice = useAppFont
      ? appChoice
      : resolveFontChoice(timelineSetting, null);
    const finalChoice = timelineData ? timelineChoice : appChoice;

    document.documentElement.style.setProperty(
      "--app-font-family",
      resolveFontStack(finalChoice.family)
    );
    document.documentElement.style.setProperty(
      "--app-font-size",
      `${Number(appFontSize) || 14}px`
    );
    document.documentElement.style.setProperty(
      "--app-font-scale",
      String((Number(appFontSize) || 14) / 14)
    );

    const linkId = "theme-font-css";
    const existing = document.getElementById(linkId);
    if (finalChoice.source === "theme" && finalChoice.cssUrl) {
      if (existing) {
        if (existing.getAttribute("href") !== finalChoice.cssUrl) {
          existing.setAttribute("href", finalChoice.cssUrl);
        }
      } else {
        const link = document.createElement("link");
        link.id = linkId;
        link.rel = "stylesheet";
        link.href = finalChoice.cssUrl;
        document.head.appendChild(link);
      }
    } else if (existing) {
      existing.remove();
    }
  }, [
    appFontFamily,
    appFontSize,
    timelineData,
    timelineData?.file?.font,
    themeKey,
    themeConfig,
    getThemeFont,
  ]);

  useEffect(() => {
    if (timelineData?.file) {
      setThemeKey(resolveThemeKey(timelineData.file.theme, appThemeKey));
      return;
    }
    setThemeKey(appThemeKey);
  }, [timelineData?.file, appThemeKey, resolveThemeKey]);

  const handleAppThemeChange = async (nextThemeKey) => {
    setAppThemePreference(nextThemeKey);
    const resolved = resolveThemeKey(nextThemeKey);
    setAppThemeKey(resolved);
    await saveAppSettings({
      theme: nextThemeKey,
      timelineStorageDir,
      notesStorageDir,
      appFontFamily,
      appFontSize,
      hardwareAcceleration,
      startMaximized,
    });
  };

  const handleOpenAppSettingsFromProject = () => {
    setReturnToProjectSettings(true);
    setIsProjectSettingsCovered(true);
    setIsAppSettingsOverlayOpen(true);
    setIsSettingsOpen(true);
    setHomeSettingsSignal((value) => value + 1);
  };

  const handleAppSettingsClosedFromHome = () => {
    setIsProjectSettingsCovered(false);
    setIsAppSettingsOverlayOpen(false);
    setIsSettingsOpen(returnToProjectSettings);
    setReturnToProjectSettings(false);
  };

  const handleTimelineStorageDirChange = async (nextDir) => {
    setTimelineStorageDir(nextDir || "");
    await saveAppSettings({
      theme: appThemePreference,
      timelineStorageDir: nextDir || "",
      notesStorageDir,
      appFontFamily,
      appFontSize,
      hardwareAcceleration,
      startMaximized,
    });
  };

  const handleNotesStorageDirChange = async (nextDir) => {
    setNotesStorageDir(nextDir || "");
    await saveAppSettings({
      theme: appThemePreference,
      timelineStorageDir,
      notesStorageDir: nextDir || "",
      assetsStorageDir,
      appFontFamily,
      appFontSize,
      hardwareAcceleration,
      startMaximized,
    });
  };

  const handleAssetsStorageDirChange = async (nextDir) => {
    setAssetsStorageDir(nextDir || "");
    await saveAppSettings({
      theme: appThemePreference,
      timelineStorageDir,
      notesStorageDir,
      assetsStorageDir: nextDir || "",
      appFontFamily,
      appFontSize,
      hardwareAcceleration,
      startMaximized,
    });
  };


  const handleAppFontSizeChange = async (nextSize) => {
    const next = Number(nextSize) || 14;
    setAppFontSize(next);
    await saveAppSettings({
      theme: appThemePreference,
      timelineStorageDir,
      notesStorageDir,
      appFontFamily,
      appFontSize: next,
      hardwareAcceleration,
    });
  };

  const handleAppFontChange = async (nextFont) => {
    setAppFontFamily(nextFont);
    await saveAppSettings({
      theme: appThemePreference,
      timelineStorageDir,
      notesStorageDir,
      appFontFamily: nextFont,
      appFontSize,
      hardwareAcceleration,
      startMaximized,
    });
  };

  const handleHardwareAccelerationChange = async (next) => {
    setHardwareAcceleration(next);
    await saveAppSettings({
      theme: appThemePreference,
      timelineStorageDir,
      notesStorageDir,
      appFontFamily,
      appFontSize,
      hardwareAcceleration: next,
      startMaximized,
    });
    if (window.electron?.relaunchApp) {
      const confirmed = window.confirm("Restart required to apply hardware acceleration change. Restart now?");
      if (confirmed) window.electron.relaunchApp();
    }
  };

  const handleStartMaximizedChange = async (next) => {
    setStartMaximized(next);
    await saveAppSettings({
      theme: appThemePreference,
      timelineStorageDir,
      notesStorageDir,
      appFontFamily,
      appFontSize,
      hardwareAcceleration,
      startMaximized: next,
    });
  };

  const handlePickTimelinesDir = async () => {
    const result = await chooseTimelinesDir();
    if (result?.success && result.path) {
      await handleTimelineStorageDirChange(result.path);
    }
  };

  const handlePickNotesDir = async () => {
    const result = await chooseNotesDir();
    if (result?.success && result.path) {
      await handleNotesStorageDirChange(result.path);
    }
  };

  const handlePickAssetsDir = async () => {
    const result = await chooseAssetsDir();
    if (result?.success && result.path) {
      await handleAssetsStorageDirChange(result.path);
    }
  };

  const handleOpenAssetsFolder = async () => {
    await openAssetsFolder();
  };


  const handleOpenFontsFolder = async () => {
    await openFontsFolder();
  };

  const handleOpenTimelinesFolder = async () => {
    await openTimelinesFolder();
  };

  const handleOpenNotesFolder = async () => {
    await openNotesFolder();
  };

  const filteredElements = useMemo(() => {
    if (!timelineData) return [];
    if (activeTags.length === 0 && hiddenTags.length === 0) return timelineData.elements;
    const showSet = new Set(activeTags);
    const hideSet = new Set(hiddenTags);
    return timelineData.elements.filter((element) => {
      if (element.type !== "event" && element.type !== "span") {
        return true;
      }
      const tags = Array.isArray(element.tags) ? element.tags : [];

      if (tags.some((tag) => hideSet.has(tag))) {
        return false;
      }

      if (showSet.size === 0) {
        return true;
      }

      return tags.some((tag) => showSet.has(tag));
    });
  }, [timelineData, activeTags, hiddenTags]);

  const filteredTimelineData = useMemo(() => {
    if (!timelineData) return null;
    const groups = timelineData.file?.groups ?? [];
    const groupIdSet = new Set(groups.map((g) => g.id).filter(Boolean));
    const defaultGroupId = groups[0]?.id || DEFAULT_GROUP_ID;
    const spanGroupById = Object.fromEntries(
      filteredElements
        .filter((el) => el.type === "span" && groupIdSet.has(el.groupId))
        .map((el) => [el.id, el.groupId])
    );
    const resolvedElements = filteredElements.map((el) => {
      if ((el.type !== "event" && el.type !== "span") || groupIdSet.has(el.groupId)) return el;
      const parentGroupId = el.type === "event" && Array.isArray(el.parents)
        ? el.parents.map((pid) => spanGroupById[pid]).find(Boolean)
        : undefined;
      return { ...el, groupId: parentGroupId ?? defaultGroupId };
    });
    return { ...timelineData, elements: resolvedElements };
  }, [timelineData, filteredElements]);

  const allTags = useMemo(() => {
    if (!timelineData?.elements) return [];
    const tags = new Set();
    timelineData.elements.forEach((element) => {
      if (element.type !== "event" && element.type !== "span") return;
      if (Array.isArray(element.tags)) {
        element.tags.forEach((tag) => {
          if (tag) tags.add(tag);
        });
      }
    });
    return Array.from(tags).sort((a, b) => a.localeCompare(b));
  }, [timelineData]);

  useEffect(() => {
    setPinnedTags((prev) => prev.filter((tag) => allTags.includes(tag)));
  }, [allTags]);

  useEffect(() => {
    setHiddenTags((prev) => prev.filter((tag) => allTags.includes(tag)));
  }, [allTags]);

  useEffect(() => {
    if (!selectedId) return;
    const isVisible = filteredElements.some((el) => el.id === selectedId);
    if (!isVisible) {
      setSelectedId(null);
    }
  }, [filteredElements, selectedId]);

  useEffect(() => {
    if (viewMode === "spreadsheet" && !timelineData?.file?.useSpreadsheet) {
      setViewMode("timeline");
    }
  }, [viewMode, timelineData?.file?.useSpreadsheet]);

  const compareElementsByTimelineOrder = useCallback((a, b) => {
    if (a.type === "event" && b.type === "event") {
      if ((a.date ?? 0) !== (b.date ?? 0)) return (a.date ?? 0) - (b.date ?? 0);
      return String(a.id).localeCompare(String(b.id));
    }
    if (a.type === "span" && b.type === "span") {
      if ((a.start ?? 0) !== (b.start ?? 0)) return (a.start ?? 0) - (b.start ?? 0);
      if ((a.end ?? 0) !== (b.end ?? 0)) return (a.end ?? 0) - (b.end ?? 0);
      return String(a.id).localeCompare(String(b.id));
    }
    if (a.type === "era" && b.type === "era") {
      if ((a.start ?? 0) !== (b.start ?? 0)) return (a.start ?? 0) - (b.start ?? 0);
      if ((a.end ?? 0) !== (b.end ?? 0)) return (b.end ?? 0) - (a.end ?? 0);
      return String(a.id).localeCompare(String(b.id));
    }
    return 0;
  }, []);

  const selectionNavigation = useMemo(() => {
    if (!selectedId) return EMPTY_SELECTION_NAVIGATION;

    const selectedElement = filteredElements.find((el) => el.id === selectedId);
    if (!selectedElement) return EMPTY_SELECTION_NAVIGATION;

    const sameTypeElements = filteredElements
      .filter((el) => el.type === selectedElement.type)
      .sort(compareElementsByTimelineOrder);
    const currentIndex = sameTypeElements.findIndex((el) => el.id === selectedId);

    return {
      selectedElement,
      prevElement: currentIndex > 0 ? sameTypeElements[currentIndex - 1] : null,
      nextElement: currentIndex >= 0 && currentIndex < sameTypeElements.length - 1
        ? sameTypeElements[currentIndex + 1]
        : null,
    };
  }, [selectedId, filteredElements, compareElementsByTimelineOrder]);

  const handleSelectPrevious = useCallback(() => {
    if (!selectionNavigation.prevElement) return;
    handleSelect(selectionNavigation.prevElement.id);
  }, [selectionNavigation.prevElement, handleSelect]);

  const handleSelectNext = useCallback(() => {
    if (!selectionNavigation.nextElement) return;
    handleSelect(selectionNavigation.nextElement.id);
  }, [selectionNavigation.nextElement, handleSelect]);

  const TYPE_ORDER = ["event", "span", "era"];

  const elementRepDate = (el) => {
    if (el.type === "event") return el.date ?? 0;
    return el.start ?? 0;
  };

  const selectByTypeDelta = useCallback((delta) => {
    const selectedElement = selectionNavigation.selectedElement;
    if (!selectedElement) return;
    const currentTypeIdx = TYPE_ORDER.indexOf(selectedElement.type);
    const targetTypeIdx = currentTypeIdx + delta;
    if (currentTypeIdx === -1 || targetTypeIdx < 0 || targetTypeIdx >= TYPE_ORDER.length) return;
    const targetType = TYPE_ORDER[targetTypeIdx];
    const candidates = filteredElements.filter((el) => el.type === targetType);
    if (!candidates.length) return;
    const refDate = elementRepDate(selectedElement);
    const closest = candidates.reduce((best, el) =>
      Math.abs(elementRepDate(el) - refDate) < Math.abs(elementRepDate(best) - refDate) ? el : best
    );
    handleSelect(closest.id);
  }, [selectionNavigation.selectedElement, filteredElements, handleSelect]);

  const handleSelectTypeDown = useCallback(() => {
    selectByTypeDelta(1);
  }, [selectByTypeDelta]);

  const handleSelectTypeUp = useCallback(() => {
    selectByTypeDelta(-1);
  }, [selectByTypeDelta]);

  useEffect(() => {
    if (!selectedId || !timelineData) return;

    const handleSelectionNavigation = (e) => {
      const target = e.target;
      const isEditable =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;
      if (isEditable) return;

      if (matchesKeybind(e, keybinds.selectPrevious)) {
        if (!selectionNavigation.prevElement) return;
        const now = performance.now();
        if (e.repeat && now - selectionNavRepeatRef.current.previous < SELECTION_NAV_REPEAT_INTERVAL_MS) return;
        selectionNavRepeatRef.current.previous = now;
        e.preventDefault();
        handleSelectPrevious();
      } else if (matchesKeybind(e, keybinds.selectNext)) {
        if (!selectionNavigation.nextElement) return;
        const now = performance.now();
        if (e.repeat && now - selectionNavRepeatRef.current.next < SELECTION_NAV_REPEAT_INTERVAL_MS) return;
        selectionNavRepeatRef.current.next = now;
        e.preventDefault();
        handleSelectNext();
      } else if (matchesKeybind(e, keybinds.selectTypeDown)) {
        e.preventDefault();
        handleSelectTypeDown();
      } else if (matchesKeybind(e, keybinds.selectTypeUp)) {
        e.preventDefault();
        handleSelectTypeUp();
      }
    };

    window.addEventListener("keydown", handleSelectionNavigation);
    return () => window.removeEventListener("keydown", handleSelectionNavigation);
  }, [selectedId, timelineData, keybinds, selectionNavigation.prevElement, selectionNavigation.nextElement, handleSelectPrevious, handleSelectNext, handleSelectTypeDown, handleSelectTypeUp]);

  // Show HomePage if no timeline is loaded
  if (!timelineData) {
    return (
      <>
        <TopBar title="Timelines" version="v0.6.0-alpha.2" />
        <div className={`app-shell ${isElectron ? 'with-title-bar' : ''}`}>
          <HomePage
            onSelectTimeline={handleLoadTimeline}
            onRenameTimeline={handleRenameTimelineFromLibrary}
            onTimelineRenamed={handleLibraryTimelineRenamed}
            onCreateTimeline={handleCreateTimeline}
            onImportTimeline={handleImportTimeline}
            appThemeKey={appThemeKey}
            themes={themeConfig.themes}
            onAppThemeChange={handleAppThemeChange}
            oldFormatThemeCount={oldFormatThemeCount}
            onMigrateOldThemes={handleMigrateOldThemes}
            appFontFamily={appFontFamily}
            appFontSize={appFontSize}
            fonts={availableFonts}
            timelineStorageDir={timelineStorageDir}
            notesStorageDir={notesStorageDir}
            onTimelineStorageDirChange={handleTimelineStorageDirChange}
            onNotesStorageDirChange={handleNotesStorageDirChange}
            onPickTimelinesDir={handlePickTimelinesDir}
            onPickNotesDir={handlePickNotesDir}
            assetsStorageDir={assetsStorageDir}
            onAssetsStorageDirChange={handleAssetsStorageDirChange}
            onPickAssetsDir={handlePickAssetsDir}
            onOpenAssetsFolder={handleOpenAssetsFolder}
            onOpenFontsFolder={handleOpenFontsFolder}
            onOpenTimelinesFolder={handleOpenTimelinesFolder}
            onOpenNotesFolder={handleOpenNotesFolder}
            onAppFontChange={handleAppFontChange}
            onAppFontSizeChange={handleAppFontSizeChange}
            hardwareAcceleration={hardwareAcceleration}
            onHardwareAccelerationChange={handleHardwareAccelerationChange}
            startMaximized={startMaximized}
            onStartMaximizedChange={handleStartMaximizedChange}
            onRefreshThemes={refreshUserThemes}
            openSettingsSignal={homeSettingsSignal}
            onAppSettingsClosed={handleAppSettingsClosedFromHome}
            keybinds={keybinds}
            onKeybindsChange={setKeybinds}
            thumbnailRefreshSignal={thumbnailRefreshSignal}
          />
        </div>
        {importConflictModal}
        {skippedFilesModal}
      </>
    );
  }

  const selectedElement = timelineData.elements.find((el) => el.id === selectedId);
  const displayedElement = selectedElement
    || (rightLockState === "open" ? timelineData.elements.find((el) => el.id === lastSelectedId) : null);
  const isRightPanelVisible = rightLockState === "closed"
    ? false
    : rightLockState === "open"
      ? Boolean(displayedElement) && !isRightCollapsed
      : Boolean(selectedElement) && !isRightCollapsed;

  return (
    <>
      <TopBar
        title={timelineData.file?.title || "Timelines"}
        isLeftCollapsed={isLeftCollapsed}
        onToggleLeft={viewMode !== "spreadsheet" ? () => setIsLeftCollapsed((v) => !v) : undefined}
        showRightToggle={Boolean(selectedId) && viewMode !== "spreadsheet"}
        isRightCollapsed={!isRightPanelVisible}
        onToggleRight={viewMode !== "spreadsheet" ? () => {
          if (rightLockState === "closed") setRightLockState(null);
          setIsRightCollapsed((v) => !v);
        } : undefined}
        rightLockState={rightLockState}
        onCycleRightLock={viewMode !== "spreadsheet" ? () => {
          setRightLockState((prev) => {
            if (prev) return null;
            return isRightPanelVisible ? "open" : "closed";
          });
        } : undefined}
      />
      <div className={`app-shell ${isElectron ? 'with-title-bar' : ''}`}>
      {viewMode !== "spreadsheet" && (
        <>
          <div
            className="sidebar-resizer overlay-resizer"
            style={{ left: `${currentLeftWidth - 3}px` }}
            onMouseDown={(e) => {
              e.preventDefault();
              isDraggingLeft.current = true;
              document.body.classList.add("dragging");
            }}
          />
          <aside
            className="app-sidebar overlay-sidebar"
            style={{ width: isLeftCollapsed ? COLLAPSED_WIDTH : sidebarWidth }}
          >
            <ErrorBoundary name="Sidebar">
            <Sidebar
              isCollapsed={isLeftCollapsed}
              onToggle={() => setIsLeftCollapsed((v) => !v)}
              selectedId={selectedId}
              onSelect={handleSelect}
              timelineData={filteredTimelineData}
              allElements={timelineData.elements}
              chipFilter={parsedChipQuery}
              activeTags={activeTags}
              hiddenTags={hiddenTags}
              onToggleTag={handleToggleTag}
              onToggleHiddenTag={handleToggleHiddenTag}
              onClearTags={handleClearTags}
              pinnedTags={pinnedTags}
              onTogglePinnedTag={handleTogglePinnedTag}
              onAddGroup={handleAddGroup}
              onUpdateGroup={handleUpdateGroup}
              onUpdateGroups={handleUpdateGroups}
              onDeleteGroup={handleDeleteGroup}
              onCenterGroup={handleCenterGroup}
              tagColors={timelineData.file?.tagColors || {}}
              onUpdateTagColor={handleUpdateTagColor}
              onAddEvent={handleAddEvent}
              onAddSpan={handleAddSpan}
              onAddEra={handleAddEra}
              onOpenSettings={() => setIsSettingsOpen(true)}
              onDownloadJson={handleDownloadJSON}
              onDownloadPackage={handleDownloadPackage}
              onDownloadPng={handleDownloadPNG}
              onDownloadVideo={handleDownloadVideo}
              onLoadTimeline={handleLoadTimeline}
              onNewTimeline={handleNewTimeline}
              onDuplicateTimeline={handleDuplicateTimeline}
              onBackToHome={handleBackToHome}
              onDelete={handleRequestDelete}
              onDuplicateElement={handleDuplicateElement}
              onEditElement={handleEditElement}
              onPatchFile={handlePatchFile}
              keybinds={keybinds}
            />
            </ErrorBoundary>
          </aside>
        </>
      )}

      {diskReloadNotice && currentTimelineId && (
        <div
          style={{
            position: "fixed",
            top: 52,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 1200,
            display: "flex",
            gap: 8,
            alignItems: "center",
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid var(--border-color)",
            background: "var(--surface)",
            boxShadow: "0 12px 30px rgba(0,0,0,0.12)",
          }}
        >
          <span>Timeline changed on disk.</span>
          <button className="folder-modal-btn folder-modal-btn-primary" onClick={() => handleLoadTimeline(currentTimelineId)}>
            Reload
          </button>
          <button className="folder-modal-btn" onClick={() => setDiskReloadNotice(false)}>
            Dismiss
          </button>
        </div>
      )}

      <main
        className="app-content"
        style={{ display: isRightMaximized ? "none" : "block" }}
      >
          {viewMode === "spreadsheet" ? (
            <ErrorBoundary name="Spreadsheet">
              <SpreadsheetView
                timelineData={filteredTimelineData}
                selectedId={selectedId}
                onSelect={handleSelect}
                onUpdate={handleUpdate}
                leftPanelWidth={0}
                rightPanelWidth={0}
                isRightPanelOpen={false}
                onSetViewMode={filteredTimelineData?.file?.useSpreadsheet ? setViewMode : undefined}
                onOpenSettings={() => setIsSettingsOpen(true)}
                onBackToHome={handleBackToHome}
                onAddEvent={handleAddEvent}
                onAddSpan={handleAddSpan}
                onAddEra={handleAddEra}
                onDelete={handleRequestDelete}
                onDuplicate={handleDuplicateElement}
                onSetElementGroup={handleSetElementGroup}
                activeTags={activeTags}
                hiddenTags={hiddenTags}
                allTags={allTags}
                onToggleTag={handleToggleTag}
                onToggleHiddenTag={handleToggleHiddenTag}
                onClearTags={handleClearTags}
                pinnedTags={pinnedTags}
                onTogglePinnedTag={handleTogglePinnedTag}
              />
            </ErrorBoundary>
          ) : (
            <ErrorBoundary name="Timeline">
            <TimelineView
              ref={timelineViewRef}
              selectedId={selectedId}
              onSelect={handleSelect}
              timelineData={filteredTimelineData}
              onAddEvent={handleAddEvent}
              onAddSpan={handleAddSpan}
              onAddEra={handleAddEra}
              onOpenSettings={() => setIsSettingsOpen(true)}
              onDelete={handleRequestDelete}
              onDuplicateElement={handleDuplicateElement}
              onEditElement={handleEditElement}
              downloadPngTrigger={downloadPngTrigger}
              exportPngOptions={exportPngOptions}
              onExportPng={handleDownloadPNG}
              onExportVideo={handleDownloadVideo}
              rightPanelWidth={rightWidth}
              isRightPanelOpen={isRightPanelVisible}
              leftPanelWidth={currentLeftWidth}
              isLeftPanelOpen={!isLeftCollapsed}
              activeTags={activeTags}
              hiddenTags={hiddenTags}
              allTags={allTags}
              onToggleTag={handleToggleTag}
              onToggleHiddenTag={handleToggleHiddenTag}
              onClearTags={handleClearTags}
              pinnedTags={pinnedTags}
              onTogglePinnedTag={handleTogglePinnedTag}
              onViewportYearChange={handleViewportYearChange}
              onChipQueryChange={setChipQuery}
              tagColors={timelineData.file?.tagColors || {}}
              keybinds={keybinds}
              onSetViewMode={filteredTimelineData?.file?.useSpreadsheet ? setViewMode : undefined}
            />
            </ErrorBoundary>
          )}
      </main>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={handleCloseSettings}
        onOpenAppSettings={handleOpenAppSettingsFromProject}
        isCovered={isProjectSettingsCovered}
        timelineData={timelineData}
        onUpdateTimeline={handleUpdateTimeline}
        renameErrorMessage={settingsRenameError}
        onClearRenameError={() => setSettingsRenameError("")}
        themeKey={themeKey}
        defaultThemeKey={defaultThemeKey}
        themes={themeConfig.themes}
        fonts={availableFonts}
        onThemeChange={setThemeKey}
        oldFormatThemeCount={oldFormatThemeCount}
        onMigrateOldThemes={handleMigrateOldThemes}
      />

      {isAppSettingsOverlayOpen && (
        <HomePage
          settingsOnly
          reuseExistingBackdrop={returnToProjectSettings}
          onSelectTimeline={handleLoadTimeline}
          onRenameTimeline={handleRenameTimelineFromLibrary}
          onTimelineRenamed={handleLibraryTimelineRenamed}
          onCreateTimeline={handleCreateTimeline}
          appThemeKey={appThemeKey}
          themes={themeConfig.themes}
          onAppThemeChange={handleAppThemeChange}
          oldFormatThemeCount={oldFormatThemeCount}
          onMigrateOldThemes={handleMigrateOldThemes}
          appFontFamily={appFontFamily}
          appFontSize={appFontSize}
          fonts={availableFonts}
          timelineStorageDir={timelineStorageDir}
          notesStorageDir={notesStorageDir}
          onTimelineStorageDirChange={handleTimelineStorageDirChange}
          onNotesStorageDirChange={handleNotesStorageDirChange}
          onPickTimelinesDir={handlePickTimelinesDir}
          onPickNotesDir={handlePickNotesDir}
          assetsStorageDir={assetsStorageDir}
          onAssetsStorageDirChange={handleAssetsStorageDirChange}
          onPickAssetsDir={handlePickAssetsDir}
          onOpenAssetsFolder={handleOpenAssetsFolder}
          onOpenFontsFolder={handleOpenFontsFolder}
          onOpenTimelinesFolder={handleOpenTimelinesFolder}
          onOpenNotesFolder={handleOpenNotesFolder}
          onAppFontChange={handleAppFontChange}
          onAppFontSizeChange={handleAppFontSizeChange}
          hardwareAcceleration={hardwareAcceleration}
          onHardwareAccelerationChange={handleHardwareAccelerationChange}
          startMaximized={startMaximized}
          onStartMaximizedChange={handleStartMaximizedChange}
          onRefreshThemes={refreshUserThemes}
          openSettingsSignal={homeSettingsSignal}
          onAppSettingsClosed={handleAppSettingsClosedFromHome}
          keybinds={keybinds}
          onKeybindsChange={setKeybinds}
          thumbnailRefreshSignal={thumbnailRefreshSignal}
        />
      )}

      {viewMode !== "spreadsheet" && (
        <>
          {!isRightMaximized && isRightPanelVisible && (
            <div
              className="right-resizer overlay-resizer"
              style={{ right: `${Math.max(rightWidth, MIN_WIDTH) - 3}px` }}
              onMouseDown={(e) => {
                e.preventDefault();
                isDraggingRight.current = true;
                rightMaxReachedRef.current = false;
                rightReversedAfterMaxRef.current = false;
                rightLastDistanceRef.current = null;
                document.body.classList.add("dragging");
              }}
            />
          )}

          {!isRightPanelVisible && rightLockState !== "closed" && (
            <div
              className="right-resizer overlay-resizer"
              style={{ right: "-3px" }}
              onMouseDown={(e) => {
                e.preventDefault();
                isDraggingRight.current = true;
                rightMaxReachedRef.current = false;
                rightReversedAfterMaxRef.current = false;
                rightLastDistanceRef.current = null;
                document.body.classList.add("dragging");
              }}
            />
          )}

          {isRightPanelVisible && (
            <aside
              className="app-right overlay-right"
              style={{
                width: isRightMaximized
                  ? `calc(100% - ${currentLeftWidth}px)`
                  : rightWidth
              }}
            >
              <ErrorBoundary name="Right panel">
              <RightPanel
                onSelect={handleSelect}
                selectedElement={displayedElement}
                onUpdate={handleUpdate}
                timelineData={timelineData}
                editRequestId={editRequestId}
                onEditRequestHandled={() => setEditRequestId(null)}
                isMaximized={isRightMaximized}
                onToggleMaximize={() => setIsRightMaximized((prev) => !prev)}
                onFilterByTag={handleFilterByTag}
                activeTags={activeTags}
                onToggleTag={handleToggleTag}
                onUpdateGroups={handleUpdateGroups}
                tagColors={timelineData.file?.tagColors || {}}
                onRequestDelete={handleRequestDelete}
                onSelectPrevious={handleSelectPrevious}
                onSelectNext={handleSelectNext}
                prevElement={selectionNavigation.prevElement}
                nextElement={selectionNavigation.nextElement}
              />
              </ErrorBoundary>
            </aside>
          )}
        </>
      )}

      {deleteElementDialog && (
        <div
          className="settings-backdrop"
          onClick={() => setDeleteElementDialog(null)}
        >
          <div
            className="settings-modal confirm-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="settings-header">
              <h2 className="settings-title">
                {deleteElementDialog.length > 1
                  ? `DELETE ${deleteElementDialog.length} ELEMENTS`
                  : `DELETE ${deleteElementDialog[0].type?.toUpperCase()}`}
              </h2>
              <button
                className="settings-back-button"
                onClick={() => setDeleteElementDialog(null)}
                aria-label="Close delete dialog"
              >
                Close
              </button>
            </div>

            <div className="confirm-content">
              <p className="confirm-text">
                {deleteElementDialog.length > 1
                  ? `Are you sure you want to delete these ${deleteElementDialog.length} elements? This cannot be undone.`
                  : `Are you sure you want to delete "${deleteElementDialog[0].title}"? This cannot be undone.`}
              </p>
              <label className="confirm-checkbox">
                <input
                  type="checkbox"
                  checked={deleteElementWithNotes}
                  disabled={!deleteElementDialog.some((el) => el.noteFile)}
                  onChange={(e) => setDeleteElementWithNotes(e.target.checked)}
                />
                Also delete linked note file{deleteElementDialog.filter((el) => el.noteFile).length > 1 ? "s" : ""}
              </label>
              <label className="confirm-checkbox">
                <input
                  type="checkbox"
                  checked={deleteElementWithImage}
                  disabled={!deleteElementDialog.some((el) => getLocalThumbnailFilename(el.thumbnail))}
                  onChange={(e) => setDeleteElementWithImage(e.target.checked)}
                />
                Also delete image file{deleteElementDialog.filter((el) => getLocalThumbnailFilename(el.thumbnail)).length > 1 ? "s" : ""}
              </label>
            </div>

            <div className="confirm-actions">
              <button
                className="settings-folder-button"
                onClick={() => setDeleteElementDialog(null)}
              >
                Cancel
              </button>
              <button
                className="settings-folder-button confirm-delete-button"
                onClick={handleConfirmDeleteElement}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      <NewTimelineModal
        isOpen={isNewTimelineModalOpen}
        onClose={() => setIsNewTimelineModalOpen(false)}
        onCreate={handleCreateTimeline}
      />

      <ExportPngModal
        isOpen={isExportPngModalOpen}
        onClose={() => setIsExportPngModalOpen(false)}
        onExport={handleExportPng}
        timelineData={timelineData}
        timelineViewRef={timelineViewRef}
      />

      <ExportVideoModal
        isOpen={isExportVideoModalOpen}
        onClose={() => setIsExportVideoModalOpen(false)}
        timelineData={timelineData}
        timelineViewRef={timelineViewRef}
      />

      <SearchOverlay
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        elements={timelineData?.elements ?? []}
        onSelect={handleSearchSelect}
        fileSettings={timelineData?.file}
      />
      {importConflictModal}
      {skippedFilesModal}
      </div>
      {screenshotToast && (
        <div style={{ position: 'fixed', bottom: '20px', right: '20px', background: '#1a7a4a', borderRadius: '8px', padding: '8px 14px', zIndex: 9999, fontSize: 'var(--text-sm)', color: '#fff', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', pointerEvents: 'none' }}>
          Screenshot saved
        </div>
      )}
    </>
  );
}

export default App;
