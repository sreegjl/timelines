import { useState, useMemo, useCallback, useRef, useEffect, useLayoutEffect } from "react";
import {
  ChevronUp, ChevronDown, ChevronsUpDown,
  GanttChartSquare, ListFilter, Settings,
  Eye, EyeOff, Tag, Check, FileText, ImageIcon,
  Search, Plus, ArrowLeft, Download,
} from "lucide-react";
import { parseTimelineInput, formatDateForInput } from "../utils/dateUtils";
import { formatYear } from "../utils/timelineUtils";
import { parseFilterQuery, matchesFilter } from "../utils/filterUtils";
import { normalizeTagValue } from "../utils/validation";
import { ICON_MAP } from "../config/elementIcons";
import { pickAndImportImage } from "../utils/electronApi";

const TYPE_LABEL = { event: "Event", span: "Span", era: "Era" };

const DEFAULT_WIDTHS = {
  type: 72, title: 200, description: 180, parent: 130, parentType: 90, date: 90, end: 85, mergeInto: 130,
  group: 85, tags: 160, icon: 80, hideYear: 75, approximate: 90, color: 110, size: 100,
  hideDetails: 90, lineStyle: 100, borderStyle: 105,
  coords: 150, wiki: 160, note: 110, sources: 110, thumbnail: 180, thumbnailStyle: 120,
};

export default function SpreadsheetView({
  timelineData,
  selectedId,
  onSelect,
  onUpdate,
  leftPanelWidth = 0,
  rightPanelWidth = 0,
  isRightPanelOpen = false,
  onSetViewMode,
  onOpenSettings,
  onBackToHome,
  onAddEvent,
  onAddSpan,
  onAddEra,
  onDelete,
  onDuplicate,
  onSetElementGroup,
  activeTags = [],
  hiddenTags = [],
  allTags = [],
  onToggleTag,
  onToggleHiddenTag,
  onClearTags,
  pinnedTags = [],
  onTogglePinnedTag,
  readOnly = false,
}) {
  const [editCell, setEditCell] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [selectedCell, setSelectedCell] = useState(null); // { id, field } selection anchor
  const [selEnd, setSelEnd] = useState(null); // { id, field } far corner of selection
  const dragSelRef = useRef(false);
  const didDragRef = useRef(false);
  const [sortField, setSortField] = useState("date");
  const [sortDir, setSortDir] = useState("asc");
  const [colWidths, setColWidths] = useState({});
  const scrollRef = useRef(null);
  const [hiddenCols, setHiddenCols] = useState(
    new Set(["icon", "hideYear", "approximate", "color", "size", "hideDetails", "lineStyle", "borderStyle", "coords", "wiki", "note", "sources", "thumbnail", "thumbnailStyle"])
  );
  const [filterOpen, setFilterOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuRef = useRef(null);
  const stickyTopRef = useRef(null);
  const [stickyTopHeight, setStickyTopHeight] = useState(77);
  const colbarRef = useRef(null);
  const filterBtnRef = useRef(null);
  const filterMenuRef = useRef(null);
  const headerMenuRef = useRef(null);
  const newMenuRef = useRef(null);
  const rowRefs = useRef({});
  const prevElementIds = useRef(new Set());
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y, id }
  const ctxMenuRef = useRef(null);
  const [tagDropdown, setTagDropdown] = useState([]);
  const [tagDropdownPos, setTagDropdownPos] = useState(null);
  const tagInputRef = useRef(null);
  const [parentDropdown, setParentDropdown] = useState([]);
  const [parentDropdownPos, setParentDropdownPos] = useState(null);
  const parentInputRef = useRef(null);
  const [mergeDropdown, setMergeDropdown] = useState([]);
  const [mergeDropdownPos, setMergeDropdownPos] = useState(null);
  const mergeInputRef = useRef(null);
  const [noteDropdown, setNoteDropdown] = useState([]);
  const [noteDropdownPos, setNoteDropdownPos] = useState(null);
  const noteInputRef = useRef(null);
  const [sourceDropdown, setSourceDropdown] = useState([]);
  const [sourceDropdownPos, setSourceDropdownPos] = useState(null);
  const sourceInputRef = useRef(null);
  const [newSourceCellId, setNewSourceCellId] = useState(null);
  const [newSourceTitle, setNewSourceTitle] = useState("");
  const [newSourceUrl, setNewSourceUrl] = useState("");
  const [newSourceDesc, setNewSourceDesc] = useState("");
  const newSourceTitleRef = useRef(null);
  const [newGroupCellId, setNewGroupCellId] = useState(null);
  const [newGroupName, setNewGroupName] = useState("");
  const newGroupInputRef = useRef(null);
  const [thumbPanelCellId, setThumbPanelCellId] = useState(null);
  const [thumbPanelUrl, setThumbPanelUrl] = useState("");

  const file = timelineData?.file ?? {};
  const { useCalendar, useMaps, useWiki, negID, posID, hideDecimals } = file;
  const elements = timelineData?.elements ?? [];

  const displayName = useMemo(() => {
    if (!file.id && !file.title) return "";
    if (file.id?.endsWith("-timeline")) return file.id.replace(/-timeline$/, ".timeline");
    return file.title || file.id || "";
  }, [file.id, file.title]);

  const elementById = useMemo(() => {
    const map = {};
    elements.forEach((el) => { map[el.id] = el; });
    return map;
  }, [elements]);

  const groups = file.groups ?? [];

  const groupById = useMemo(() => {
    const map = {};
    groups.forEach((g) => { map[g.id] = g.title; });
    return map;
  }, [groups]);

  const COLS = useMemo(() => {
    const cols = [
      { key: "type",       label: "Type"         },
      { key: "title",      label: "Title"        },
      { key: "description", label: "Description" },
      { key: "date",       label: "Date / Start" },
      { key: "end",        label: "End"          },
      { key: "parent",     label: "Parent"       },
      { key: "parentType", label: "Parent Type"  },
      { key: "mergeInto",  label: "Merge Into"   },
      { key: "group",      label: "Group"        },
      { key: "tags",       label: "Tags"         },
      { key: "icon",        label: "Icon"         },
      { key: "hideYear",    label: "Hide Date"    },
      { key: "approximate", label: "Approximate"  },
      { key: "hideDetails", label: "Hide Details" },
      { key: "color",       label: "Color"        },
      { key: "size",        label: "Size"         },
      { key: "lineStyle",   label: "Line Style"   },
      { key: "borderStyle",    label: "Border Style"    },
      { key: "thumbnail",      label: "Thumbnail"       },
      { key: "thumbnailStyle", label: "Thumbnail Style" },
    ];
    if (useMaps)      cols.push({ key: "coords", label: "Coordinates" });
    if (useWiki) cols.push({ key: "wiki",   label: "Wiki"        });
    cols.push(
      { key: "note",    label: "Note"    },
      { key: "sources", label: "Sources" },
    );
    return cols;
  }, [useMaps, useWiki]);

  const OPTIONAL_COLS = useMemo(() => COLS.filter((c) => c.key !== "type" && c.key !== "title"), [COLS]);

  const toggleCol = (key) =>
    setHiddenCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  const visibleCols = useMemo(() => COLS.filter((c) => !hiddenCols.has(c.key)), [COLS, hiddenCols]);

  const fmtDate = useCallback(
    (yr) => formatYear(yr, negID ?? null, posID ?? null, useCalendar, hideDecimals),
    [negID, posID, useCalendar, hideDecimals]
  );

  const getDateDisplay = useCallback((el) =>
    el.type === "event"
      ? (formatDateForInput(el.dateLabel) || fmtDate(el.date))
      : (formatDateForInput(el.startLabel) || fmtDate(el.start)),
    [fmtDate]
  );

  const getEndDisplay = useCallback((el) =>
    el.type === "event" ? null : (formatDateForInput(el.endLabel) || fmtDate(el.end)),
    [fmtDate]
  );

  const numDate = (el) =>
    el.type === "event" ? (el.date ?? 0) : (el.start ?? 0);

  const getParentTitle = useCallback((el) => {
    const parentId = el.type === "event" ? el.parents?.[0] : (el.parent ?? el.extendFrom);
    return parentId ? (elementById[parentId]?.title ?? "") : "";
  }, [elementById]);

  const getMergeIntoTitle = useCallback((el) => {
    return el.mergeParent ? (elementById[el.mergeParent]?.title ?? "") : "";
  }, [elementById]);

  const searchedElements = useMemo(() => {
    if (!search.trim()) return elements;
    const parsed = parseFilterQuery(search);
    return elements.filter((el) => matchesFilter(el, parsed));
  }, [elements, search]);

  const getCellDisplayValue = useCallback((el, field) => {
    if (!el) return "";
    if (field === "type")    return TYPE_LABEL[el.type] ?? el.type;
    if (field === "title")   return el.title ?? "";
    if (field === "description") return el.type === "span" ? (el.description ?? "") : "";
    if (field === "parent")     return getParentTitle(el);
    if (field === "parentType") return el.type === "span" ? (el.extendFrom ? "extend" : "branch") : "";
    if (field === "mergeInto")  return getMergeIntoTitle(el);
    if (field === "date")    return getDateDisplay(el);
    if (field === "end")     return el.type === "event" ? "" : (getEndDisplay(el) ?? "");
    if (field === "group")   return groupById[el.groupId] ?? "";
    if (field === "tags")    return (el.tags ?? []).join(", ");
    if (field === "icon")    return el.icon ?? "";
    if (field === "hideYear")    return el.hideYears ? "true" : "";
    if (field === "approximate") return el.approximate ? "true" : "";
    if (field === "color")       return el.color ?? "";
    if (field === "size")        return el.type === "span" ? (el.spanSize ?? "") : el.type === "era" ? (el.eraSize ?? "") : "";
    if (field === "hideDetails") return el.hideDetails ? "true" : "";
    if (field === "lineStyle")   return el.eventLineStyle ?? "";
    if (field === "borderStyle") return el.eventBorderStyle ?? "";
    if (field === "coords")  return el.lat != null && el.lng != null ? `${el.lat}, ${el.lng}` : "";
    if (field === "wiki")    return el.wikiUrl ?? "";
    if (field === "note")           return el.noteFile ?? "";
    if (field === "sources")        return String(el.sources?.length ?? 0);
    if (field === "thumbnail")      return el.type === "event" ? (el.thumbnail ?? "") : "";
    if (field === "thumbnailStyle") return el.type === "event" ? (el.thumbnailStyle ?? "") : "";
    return "";
  }, [getParentTitle, getMergeIntoTitle, getDateDisplay, getEndDisplay, groupById]);

  const sortedElements = useMemo(() => {
    return [...searchedElements].sort((a, b) => {
      let cmp = 0;
      if      (sortField === "date")    cmp = numDate(a) - numDate(b);
      else if (sortField === "end")     cmp = (a.end ?? a.date ?? 0) - (b.end ?? b.date ?? 0);
      else if (sortField === "sources") cmp = (a.sources?.length ?? 0) - (b.sources?.length ?? 0);
      else {
        const av = getCellDisplayValue(a, sortField);
        const bv = getCellDisplayValue(b, sortField);
        // empty cells always sort last regardless of direction
        if (!av || !bv) return !av && !bv ? 0 : (av ? -1 : 1);
        cmp = av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" });
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [searchedElements, sortField, sortDir, getCellDisplayValue]);

  const rowIndexById = useMemo(() => {
    const m = {};
    sortedElements.forEach((el, i) => { m[el.id] = i; });
    return m;
  }, [sortedElements]);

  const colIndexByKey = useMemo(() => {
    const m = {};
    visibleCols.forEach((c, i) => { m[c.key] = i; });
    return m;
  }, [visibleCols]);

  const selRect = useMemo(() => {
    if (!selectedCell || !selEnd) return null;
    const r1 = rowIndexById[selectedCell.id], r2 = rowIndexById[selEnd.id];
    const c1 = colIndexByKey[selectedCell.field], c2 = colIndexByKey[selEnd.field];
    if (r1 == null || r2 == null || c1 == null || c2 == null) return null;
    return { top: Math.min(r1, r2), bottom: Math.max(r1, r2), left: Math.min(c1, c2), right: Math.max(c1, c2) };
  }, [selectedCell, selEnd, rowIndexById, colIndexByKey]);

  const selectedCellSet = useMemo(() => {
    const set = new Set();
    if (selRect) {
      for (let r = selRect.top; r <= selRect.bottom; r++)
        for (let c = selRect.left; c <= selRect.right; c++)
          set.add(`${sortedElements[r].id}|${visibleCols[c].key}`);
    }
    return set;
  }, [selRect, sortedElements, visibleCols]);

  // Column resize
  const startResize = (e, key) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const th = e.currentTarget.parentElement;
    const startW = th ? th.getBoundingClientRect().width : (colWidths[key] ?? DEFAULT_WIDTHS[key] ?? 100);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (me) => {
      setColWidths(prev => ({ ...prev, [key]: Math.max(40, startW + me.clientX - startX) }));
    };
    const onUp = () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  // Close menus on outside click
  useEffect(() => {
    if (!filterOpen) return;
    const h = (e) => { if (!filterBtnRef.current?.contains(e.target) && !filterMenuRef.current?.contains(e.target)) setFilterOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [filterOpen]);

  useEffect(() => {
    if (!headerMenuOpen) return;
    const h = (e) => { if (!headerMenuRef.current?.contains(e.target)) setHeaderMenuOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [headerMenuOpen]);

  useEffect(() => {
    if (!newMenuOpen) return;
    const h = (e) => { if (!newMenuRef.current?.contains(e.target)) setNewMenuOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [newMenuOpen]);

  useEffect(() => {
    if (!exportMenuOpen) return;
    const h = (e) => { if (!exportMenuRef.current?.contains(e.target)) setExportMenuOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [exportMenuOpen]);

  useEffect(() => {
    if (!ctxMenu) return;
    const h = (e) => { if (!ctxMenuRef.current?.contains(e.target)) setCtxMenu(null); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [ctxMenu]);

  // Pure update logic — returns updated element or null if no applicable change.
  // Defined before the keyboard effect so it's initialized when the dep array is evaluated.
  const computeFieldUpdate = useCallback((el, field, val) => {
    const updated = { ...el };
    if (field === "title") {
      const t = val.trim(); if (t) updated.title = t; else return null;
    } else if (field === "description") {
      if (el.type !== "span") return null;
      const v = val.trim(); if (v) updated.description = v; else delete updated.description;
    } else if (field === "date") {
      const p = parseTimelineInput(val); if (p.value === null) return null;
      if (el.type === "event") { updated.date = p.value; if (p.label) updated.dateLabel = p.label; else delete updated.dateLabel; }
      else { updated.start = p.value; if (p.label) updated.startLabel = p.label; else delete updated.startLabel; }
    } else if (field === "end") {
      if (el.type === "event") return null;
      const p = parseTimelineInput(val); if (p.value === null) return null;
      if (Number.isFinite(el.start) && p.value <= el.start) return null;
      updated.end = p.value; if (p.label) updated.endLabel = p.label; else delete updated.endLabel;
    } else if (field === "tags") {
      const tags = val.split(",").map((t) => normalizeTagValue(t)).filter(Boolean);
      if (tags.length) updated.tags = tags; else delete updated.tags;
    } else if (field === "icon") {
      const v = val.trim();
      if (v && ICON_MAP[v]) updated.icon = v; else if (!v) delete updated.icon; else return null;
    } else if (field === "coords") {
      const parts = val.split(",").map((s) => parseFloat(s.trim()));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) { updated.lat = parts[0]; updated.lng = parts[1]; }
      else if (!val.trim()) { delete updated.lat; delete updated.lng; }
      else return null;
    } else if (field === "wiki") {
      const v = val.trim(); if (v) updated.wikiUrl = v; else delete updated.wikiUrl;
    } else if (field === "group") {
      const v = val.trim();
      if (v) { const match = groups.find((g) => g.title.toLowerCase() === v.toLowerCase()); if (match) updated.groupId = match.id; else return null; }
      else delete updated.groupId;
    } else if (field === "parent") {
      const v = val.trim();
      const usesExtend = el.type === "span" && el.extendFrom;
      if (!v) {
        if (el.type === "event") { const rest = (el.parents ?? []).slice(1); if (rest.length) updated.parents = rest; else delete updated.parents; }
        else if (usesExtend) delete updated.extendFrom; else delete updated.parent;
      } else {
        const match = elements.find((x) => x.id !== el.id && (x.title ?? "").toLowerCase() === v.toLowerCase());
        if (!match) return null;
        if (el.type === "event") updated.parents = [match.id, ...(el.parents ?? []).slice(1)];
        else if (usesExtend) updated.extendFrom = match.id; else updated.parent = match.id;
      }
    } else if (field === "mergeInto") {
      const v = val.trim();
      if (!v) delete updated.mergeParent;
      else {
        const match = elements.find((x) => x.id !== el.id && x.type === "span" && (x.title ?? "").toLowerCase() === v.toLowerCase());
        if (!match) return null;
        updated.mergeParent = match.id;
      }
    } else if (field === "color") {
      const v = val.trim(); if (v) updated.color = v; else delete updated.color;
    } else if (field === "size") {
      if (el.type === "event") return null;
      const v = val.trim().toLowerCase();
      const sizeKey = el.type === "span" ? "spanSize" : "eraSize";
      if (v) updated[sizeKey] = v; else delete updated[sizeKey];
    } else if (field === "lineStyle") {
      if (el.type !== "event") return null;
      const v = val.trim(); if (v) updated.eventLineStyle = v; else delete updated.eventLineStyle;
    } else if (field === "borderStyle") {
      if (el.type !== "event") return null;
      const v = val.trim(); if (v) updated.eventBorderStyle = v; else delete updated.eventBorderStyle;
    } else if (field === "note") {
      const v = val.trim(); if (v) updated.noteFile = v; else delete updated.noteFile;
    } else if (field === "thumbnail") {
      if (el.type !== "event") return null;
      const v = val.trim(); if (v) updated.thumbnail = v; else delete updated.thumbnail;
    } else if (field === "thumbnailStyle") {
      if (el.type !== "event") return null;
      const valid = ["strip", "banner", "square-fill", "circle-fill"];
      const v = val.trim();
      if (v && valid.includes(v)) updated.thumbnailStyle = v;
      else if (!v) delete updated.thumbnailStyle;
      else return null;
    } else {
      return null;
    }
    return JSON.stringify(el) !== JSON.stringify(updated) ? updated : null;
  }, [elements, groups]);

  // Ctrl+C/X/V and Delete on the selected cell(s), Escape to deselect
  useEffect(() => {
    if (!selectedCell) return;

    const getSelection = () => {
      if (selRect) {
        return {
          rows: sortedElements.slice(selRect.top, selRect.bottom + 1),
          fields: visibleCols.slice(selRect.left, selRect.right + 1).map((c) => c.key),
        };
      }
      const el = elements.find((x) => x.id === selectedCell.id);
      return el ? { rows: [el], fields: [selectedCell.field] } : { rows: [], fields: [] };
    };

    const clearCells = (rows, fields) => {
      rows.forEach((orig) => {
        let el = orig;
        let changed = false;
        fields.forEach((field) => {
          if (field === "sources" || field === "thumbnail") {
            if (el[field] !== undefined) { el = { ...el }; delete el[field]; changed = true; }
          } else {
            const u = computeFieldUpdate(el, field, "");
            if (u) { el = u; changed = true; }
          }
        });
        if (changed) onUpdate(el);
      });
    };

    const cellText = (el, field) =>
      field === "sources" ? JSON.stringify(el.sources ?? []) : (getCellDisplayValue(el, field) ?? "");

    const handler = (e) => {
      if (e.key === "Escape") { setSelectedCell(null); setSelEnd(null); return; }
      if (editCell) return;
      if (!readOnly && (e.key === "Delete" || e.key === "Backspace")) {
        const { rows, fields } = getSelection();
        if (!rows.length) return;
        clearCells(rows, fields);
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      const { rows, fields } = getSelection();
      if (!rows.length) return;
      const copyText = () =>
        rows.length === 1 && fields.length === 1
          ? cellText(rows[0], fields[0])
          : rows.map((el) => fields.map((f) => cellText(el, f).replace(/[\t\r\n]+/g, " ")).join("\t")).join("\n");
      if (e.key === "c") {
        e.preventDefault();
        navigator.clipboard?.writeText(copyText()).catch(() => {});
      } else if (e.key === "x" && !readOnly) {
        e.preventDefault();
        navigator.clipboard?.writeText(copyText()).then(() => clearCells(rows, fields)).catch(() => {});
      } else if (e.key === "v" && !readOnly) {
        e.preventDefault();
        navigator.clipboard?.readText().then((raw) => {
          const grid = raw.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n").map((line) => line.split("\t"));
          if (!grid.length || !grid[0].length) return;
          let tRows = rows, tFields = fields;
          if (rows.length === 1 && fields.length === 1 && (grid.length > 1 || grid[0].length > 1)) {
            const r0 = rowIndexById[rows[0].id];
            const c0 = colIndexByKey[fields[0]];
            if (r0 != null && c0 != null) {
              tRows = sortedElements.slice(r0, r0 + grid.length);
              tFields = visibleCols.slice(c0, c0 + grid[0].length).map((c) => c.key);
            }
          }
          tRows.forEach((orig, ri) => {
            let el = orig;
            let changed = false;
            tFields.forEach((field, ci) => {
              const val = grid[ri % grid.length]?.[ci % grid[0].length];
              if (val === undefined) return;
              if (field === "sources") {
                try {
                  const parsed = JSON.parse(val.trim());
                  if (Array.isArray(parsed)) {
                    el = { ...el };
                    if (parsed.length) el.sources = parsed; else delete el.sources;
                    changed = true;
                  }
                } catch { /* not a sources payload, ignore */ }
              } else {
                const u = computeFieldUpdate(el, field, val.trim());
                if (u) { el = u; changed = true; }
              }
            });
            if (changed) onUpdate(el);
          });
        }).catch(() => {});
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [selectedCell, selRect, editCell, elements, sortedElements, visibleCols, rowIndexById, colIndexByKey, getCellDisplayValue, computeFieldUpdate, onUpdate, readOnly]);

  // Keep thead top in sync with sticky wrapper height
  useLayoutEffect(() => {
    if (!stickyTopRef.current) return;
    const ro = new ResizeObserver(() => {
      setStickyTopHeight(stickyTopRef.current?.offsetHeight ?? 77);
    });
    ro.observe(stickyTopRef.current);
    return () => ro.disconnect();
  }, []);

  // Scale columns to fill container width on first render
  useLayoutEffect(() => {
    if (!scrollRef.current) return;
    const containerW = scrollRef.current.clientWidth;
    if (!containerW) return;
    const cols = COLS.filter((c) => !hiddenCols.has(c.key));
    const totalDefault = cols.reduce((s, c) => s + (DEFAULT_WIDTHS[c.key] ?? 100), 0);
    const scale = Math.max(1, containerW / totalDefault);
    const scaled = {};
    cols.forEach((c) => { scaled[c.key] = Math.round((DEFAULT_WIDTHS[c.key] ?? 100) * scale); });
    setColWidths(scaled);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redirect vertical wheel to horizontal scroll on the colbar.
  // Must attach to document in capture phase because Chrome ignores preventDefault()
  // on wheel events fired on non-vertically-scrollable elements.
  useEffect(() => {
    const handler = (e) => {
      const colbar = colbarRef.current;
      if (!colbar || !colbar.contains(e.target)) return;
      if (e.deltaY === 0) return;
      e.preventDefault();
      colbar.scrollLeft += e.deltaY;
    };
    document.addEventListener("wheel", handler, { passive: false, capture: true });
    return () => document.removeEventListener("wheel", handler, { capture: true });
  }, []);

  // Dismiss dropdowns on scroll so fixed-position menus don't float away from their cells
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = () => {
      setTagDropdown([]); setTagDropdownPos(null);
      setParentDropdown([]); setParentDropdownPos(null);
      setMergeDropdown([]); setMergeDropdownPos(null);
      setNoteDropdown([]); setNoteDropdownPos(null);
      setSourceDropdown([]); setSourceDropdownPos(null);
    };
    el.addEventListener("scroll", handler);
    return () => el.removeEventListener("scroll", handler);
  }, []);

  // Scroll to newly added element
  useEffect(() => {
    const currentIds = new Set(elements.map((el) => el.id));
    const newIds = elements.filter((el) => !prevElementIds.current.has(el.id)).map((el) => el.id);
    prevElementIds.current = currentIds;
    if (newIds.length === 0) return;
    const rowEl = rowRefs.current[newIds[0]];
    rowEl?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [elements]);

  const handleSortClick = (field) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("asc"); }
  };

  const startEdit = (e, id, field) => {
    if (readOnly) return;
    e.stopPropagation();
    if (editCell?.id === id && editCell?.field === field) return;
    const el = elements.find((x) => x.id === id);
    if (!el) return;

    let val = "";
    if      (field === "title")  val = el.title ?? "";
    else if (field === "description") { if (el.type !== "span") return; val = el.description ?? ""; }
    else if (field === "parent") val = getParentTitle(el);
    else if (field === "date")   val = String(el.type === "event" ? (el.date ?? "") : (el.start ?? ""));
    else if (field === "end")    { if (el.type === "event") return; val = String(el.end ?? ""); }
    else if (field === "group")    { if (el.type === "era") return; val = groupById[el.groupId] ?? ""; }
    else if (field === "mergeInto") { if (el.type !== "span") return; val = getMergeIntoTitle(el); }
    else if (field === "tags")   val = (el.tags ?? []).join(", ");
    else if (field === "icon")        val = el.icon ?? "";
    else if (field === "coords")      val = (el.lat != null && el.lng != null) ? `${el.lat}, ${el.lng}` : "";
    else if (field === "wiki")        val = el.wikiUrl ?? "";
    else if (field === "color")       val = el.color ?? "";
    else if (field === "size")        { if (el.type === "event") return; val = (el.type === "span" ? el.spanSize : el.eraSize) ?? ""; }
    else if (field === "lineStyle")   { if (el.type !== "event") return; val = el.eventLineStyle ?? ""; }
    else if (field === "borderStyle") { if (el.type !== "event") return; val = el.eventBorderStyle ?? ""; }
    else if (field === "note")           val = el.noteFile ?? "";
    else if (field === "sources")        val = "";
    else if (field === "thumbnail")      { if (el.type !== "event") return; val = el.thumbnail ?? ""; }
    else if (field === "thumbnailStyle") { if (el.type !== "event" || !el.thumbnail) return; val = el.thumbnailStyle ?? "strip"; }
    else return;

    setEditCell({ id, field });
    setEditValue(val);
  };

  const toggleHideYear = (e, el) => {
    e.stopPropagation();
    if (e.shiftKey) return;
    const updated = { ...el };
    if (el.hideYears) delete updated.hideYears; else updated.hideYears = true;
    onUpdate(updated);
  };

  const toggleApproximate = (e, el) => {
    e.stopPropagation();
    if (e.shiftKey) return;
    const updated = { ...el };
    if (el.approximate) delete updated.approximate; else updated.approximate = true;
    onUpdate(updated);
  };

  const handleTagsChange = (e) => {
    const val = e.target.value;
    setEditValue(val);
    const parts = val.split(",");
    const partial = parts[parts.length - 1].trim().toLowerCase();
    const already = parts.slice(0, -1).map((t) => t.trim()).filter(Boolean);
    const matches = allTags.filter(
      (t) => t.toLowerCase().includes(partial) && !already.includes(t)
    );
    setTagDropdown(matches);
    if (matches.length > 0 && tagInputRef.current) {
      const rect = tagInputRef.current.getBoundingClientRect();
      setTagDropdownPos({ left: rect.left, top: rect.bottom, width: rect.width });
    }
  };

  const spanStart = (span) => { const p = parseTimelineInput(span.startLabel ?? span.start); return p.value ?? span.start; };
  const spanEnd   = (span) => { const p = parseTimelineInput(span.endLabel   ?? span.end);   return p.value ?? span.end;   };

  const handleParentChange = (e) => {
    const val = e.target.value;
    setEditValue(val);
    const q = val.trim().toLowerCase();
    const el = elements.find((x) => x.id === editCell?.id);
    const candidates = elements.filter((x) => {
      if (x.id === editCell?.id || x.type !== "span") return false;
      if (!(x.title ?? "").toLowerCase().includes(q)) return false;
      if (!el) return true;
      const s = spanStart(x), en = spanEnd(x);
      if (!Number.isFinite(s) || !Number.isFinite(en)) return true;
      if (el.type === "event") {
        const d = el.date;
        return Number.isFinite(d) ? d >= s && d <= en : true;
      }
      // span branch: start must fall within parent
      const elS = spanStart(el);
      if (el.extendFrom) {
        // extend: el.start must equal parent's end
        return Number.isFinite(elS) ? Math.abs(en - elS) < 1e-6 : true;
      }
      return Number.isFinite(elS) ? elS >= s && elS <= en : true;
    });
    setParentDropdown(candidates);
    if (candidates.length > 0 && parentInputRef.current) {
      const rect = parentInputRef.current.getBoundingClientRect();
      setParentDropdownPos({ left: rect.left, top: rect.bottom, width: rect.width });
    }
  };

  const selectDropdownParent = (parentEl) => {
    const el = elements.find((x) => x.id === editCell?.id);
    if (!el) return;
    const updated = { ...el };
    if (el.type === "event") {
      updated.parents = [parentEl.id, ...(el.parents ?? []).slice(1)];
    } else if (el.extendFrom) {
      updated.extendFrom = parentEl.id;
    } else {
      updated.parent = parentEl.id;
    }
    if (JSON.stringify(el) !== JSON.stringify(updated)) onUpdate(updated);
    setEditCell(null);
    setParentDropdown([]);
  };


  const commitNewGroup = (elId) => {
    const name = newGroupName.trim();
    if (!name) { setNewGroupCellId(null); setNewGroupName(""); return; }
    const el = elements.find((x) => x.id === elId);
    if (!el) return;
    if (onSetElementGroup) onSetElementGroup(el.id, name);
    setNewGroupCellId(null);
    setNewGroupName("");
  };

  const handleMergeIntoChange = (e) => {
    const val = e.target.value;
    setEditValue(val);
    const q = val.trim().toLowerCase();
    const el = elements.find((x) => x.id === editCell?.id);
    const elEnd = el ? spanEnd(el) : null;
    const matches = elements.filter((x) => {
      if (x.type !== "span" || x.id === editCell?.id) return false;
      if (!(x.title ?? "").toLowerCase().includes(q)) return false;
      if (!Number.isFinite(elEnd)) return true;
      const s = spanStart(x), en = spanEnd(x);
      return Number.isFinite(s) && Number.isFinite(en) && elEnd >= s && elEnd <= en;
    });
    setMergeDropdown(matches);
    if (mergeInputRef.current) {
      const rect = mergeInputRef.current.getBoundingClientRect();
      setMergeDropdownPos({ left: rect.left, top: rect.bottom, width: rect.width });
    }
  };

  const handleNoteChange = (e) => {
    const val = e.target.value;
    setEditValue(val);
    const q = val.trim().toLowerCase();
    const used = new Set(elements.map((x) => x.noteFile).filter(Boolean));
    const matches = [...used].filter((f) => f.toLowerCase().includes(q));
    setNoteDropdown(matches);
    if (matches.length > 0 && noteInputRef.current) {
      const rect = noteInputRef.current.getBoundingClientRect();
      setNoteDropdownPos({ left: rect.left, top: rect.bottom, width: rect.width });
    }
  };

  const selectDropdownNote = (filename) => {
    const el = elements.find((x) => x.id === editCell?.id);
    if (!el) return;
    const updated = { ...el, noteFile: filename };
    if (JSON.stringify(el) !== JSON.stringify(updated)) onUpdate(updated);
    setEditCell(null);
    setNoteDropdown([]);
  };

  const handleSourceChange = (e) => {
    const val = e.target.value;
    setEditValue(val);
    const q = val.trim().toLowerCase();
    const currentSources = elements.find((x) => x.id === editCell?.id)?.sources ?? [];
    const currentTitles = new Set(currentSources.map((s) => s.title));
    const seen = new Set();
    const allSources = [];
    elements.forEach((x) => {
      (x.sources ?? []).forEach((s) => {
        if (!seen.has(s.title) && !currentTitles.has(s.title)) {
          seen.add(s.title);
          allSources.push(s);
        }
      });
    });
    const matches = allSources.filter((s) =>
      s.title.toLowerCase().includes(q) || (s.url ?? "").toLowerCase().includes(q)
    );
    setSourceDropdown(matches);
    requestAnimationFrame(() => {
      if (!sourceInputRef.current || matches.length === 0) return;
      const rect = sourceInputRef.current.getBoundingClientRect();
      if (rect.width === 0) return;
      setSourceDropdownPos({ left: rect.left, top: rect.bottom, width: rect.width });
    });
  };

  const srcSubtitle = (src) => {
    if (src.url) {
      try { return new URL(src.url).hostname.replace(/^www\./, ""); }
      catch { return src.url; }
    }
    return src.description || src.citation || "";
  };

  const commitNewSource = (elId) => {
    const t = newSourceTitle.trim();
    if (!t) { setNewSourceCellId(null); setNewSourceTitle(""); setNewSourceUrl(""); setNewSourceDesc(""); return; }
    const el = elements.find((x) => x.id === elId);
    if (!el) return;
    const src = { title: t };
    const u = newSourceUrl.trim();
    if (u) src.url = u;
    const d = newSourceDesc.trim();
    if (d) src.description = d;
    onUpdate({ ...el, sources: [...(el.sources ?? []), src] });
    setNewSourceCellId(null);
    setNewSourceTitle("");
    setNewSourceUrl("");
  };

  const selectDropdownSource = (src) => {
    const el = elements.find((x) => x.id === editCell?.id);
    if (!el) return;
    const updated = { ...el, sources: [...(el.sources ?? []), src] };
    onUpdate(updated);
    setEditCell(null);
    setSourceDropdown([]);
  };

  const selectDropdownMergeInto = (targetEl) => {
    const el = elements.find((x) => x.id === editCell?.id);
    if (!el) return;
    const updated = { ...el, mergeParent: targetEl.id };
    if (JSON.stringify(el) !== JSON.stringify(updated)) onUpdate(updated);
    setEditCell(null);
    setMergeDropdown([]);
  };

  const selectDropdownTag = (tag) => {
    const parts = editValue.split(",");
    parts[parts.length - 1] = " " + tag;
    setEditValue(parts.join(",") + ", ");
    setTagDropdown([]);
    setTimeout(() => tagInputRef.current?.focus(), 0);
  };

  const commitEdit = () => {
    if (!editCell) return;
    const { id, field } = editCell;
    const el = elements.find((x) => x.id === id);
    if (!el) { setEditCell(null); return; }

    // new group creation — side effect not handled by computeFieldUpdate
    if (field === "group") {
      const v = editValue.trim();
      if (v) {
        const match = groups.find((g) => g.title.toLowerCase() === v.toLowerCase());
        if (!match && onSetElementGroup) {
          setEditCell(null);
          onSetElementGroup(el.id, v);
          return;
        }
      }
    }

    const updated = computeFieldUpdate(el, field, editValue);
    if (updated) onUpdate(updated);
    setEditCell(null);
    setTagDropdown([]); setParentDropdown([]); setMergeDropdown([]); setNoteDropdown([]); setSourceDropdown([]);
    setNewSourceCellId(null); setNewSourceTitle(""); setNewSourceUrl(""); setNewSourceDesc("");
    setNewGroupCellId(null); setNewGroupName("");
    setThumbPanelCellId(null); setThumbPanelUrl("");
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitEdit(); }
    else if (e.key === "Escape") { setEditCell(null); setTagDropdown([]); setParentDropdown([]); setMergeDropdown([]); setNoteDropdown([]); setSourceDropdown([]); setNewSourceCellId(null); setNewSourceTitle(""); setNewSourceUrl(""); setNewSourceDesc(""); setNewGroupCellId(null); setNewGroupName(""); setThumbPanelCellId(null); setThumbPanelUrl(""); }

  };

  const SortIcon = ({ field }) => {
    if (sortField !== field) return <ChevronsUpDown size={11} className="sheet-sort-icon" />;
    return sortDir === "asc"
      ? <ChevronUp size={11} className="sheet-sort-icon" />
      : <ChevronDown size={11} className="sheet-sort-icon" />;
  };

  const w = (key) => colWidths[key] ?? DEFAULT_WIDTHS[key] ?? 100;

  const hasHeaderMenu = Boolean(onBackToHome) || (!readOnly && Boolean(onOpenSettings));

  const triggerDownload = (content, filename, type) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportCsv = () => {
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = visibleCols.map((c) => esc(c.label)).join(",");
    const rows = sortedElements.map((el) =>
      visibleCols.map((c) => esc(getCellDisplayValue(el, c.key))).join(",")
    );
    triggerDownload([header, ...rows].join("\r\n"), `${displayName || "timeline"}.csv`, "text/csv;charset=utf-8;");
  };

  const exportJson = () => {
    const keys = visibleCols.map((c) => c.key);
    const data = sortedElements.map((el) =>
      Object.fromEntries(keys.map((k) => [k, getCellDisplayValue(el, k)]))
    );
    triggerDownload(JSON.stringify(data, null, 2), `${displayName || "timeline"}.json`, "application/json");
  };

  const clearAllMenus = useCallback(() => {
    setEditCell(null);
    setTagDropdown([]); setTagDropdownPos(null);
    setParentDropdown([]); setParentDropdownPos(null);
    setMergeDropdown([]); setMergeDropdownPos(null);
    setNoteDropdown([]); setNoteDropdownPos(null);
    setSourceDropdown([]); setSourceDropdownPos(null);
    setNewSourceCellId(null); setNewSourceTitle(""); setNewSourceUrl(""); setNewSourceDesc("");
    setNewGroupCellId(null); setNewGroupName("");
    setThumbPanelCellId(null); setThumbPanelUrl("");
  }, []);

  const selectCell = (e, id, field) => {
    e.stopPropagation();
    if (e.shiftKey && selectedCell) {
      setSelEnd({ id, field });
      return;
    }
    onSelect(id);
    setSelectedCell({ id, field });
    setSelEnd(null);
    if (editCell && (editCell.id !== id || editCell.field !== field)) {
      clearAllMenus();
    }
    if (thumbPanelCellId && !(id === thumbPanelCellId && field === "thumbnail")) {
      setThumbPanelCellId(null); setThumbPanelUrl("");
    }
  };

  const cellFromEvent = (e) => {
    const td = e.target.closest?.("td.sheet-cell");
    if (!td) return null;
    const id = td.closest("tr")?.dataset.rowId;
    const field = visibleCols[td.cellIndex]?.key;
    return id && field ? { id, field } : null;
  };

  const handleTableMouseDown = (e) => {
    if (e.button !== 0) return;
    if (e.target.closest?.("input, select, button, textarea")) return;
    const cell = cellFromEvent(e);
    if (!cell) return;
    didDragRef.current = false;
    dragSelRef.current = true;
    if (e.shiftKey && selectedCell) {
      setSelEnd(cell);
      return;
    }
    onSelect(cell.id);
    setSelectedCell(cell);
    setSelEnd(null);
  };

  const handleTableMouseOver = (e) => {
    if (!dragSelRef.current) return;
    const cell = cellFromEvent(e);
    if (!cell) return;
    if (selectedCell && (cell.id !== selectedCell.id || cell.field !== selectedCell.field)) {
      if (!didDragRef.current) {
        didDragRef.current = true;
        window.getSelection()?.removeAllRanges();
        document.body.style.userSelect = "none";
      }
    }
    setSelEnd((prev) =>
      prev && prev.id === cell.id && prev.field === cell.field ? prev : cell
    );
  };

  useEffect(() => {
    const onUp = () => {
      dragSelRef.current = false;
      document.body.style.userSelect = "";
      setTimeout(() => { didDragRef.current = false; }, 0);
    };
    document.addEventListener("mouseup", onUp);
    return () => document.removeEventListener("mouseup", onUp);
  }, []);

  const renderCell = (el, col) => {
    const { key: field } = col;
    const isEditing = editCell?.id === el.id && editCell?.field === field;
    const isSel = selectedCell?.id === el.id && selectedCell?.field === field;
    const inRange = selectedCellSet.has(`${el.id}|${field}`);
    const cellW = w(field);
    const selClass = isSel ? " sheet-cell-selected" : inRange ? " sheet-cell-range" : "";

    if (field === "type") {
      return (
        <td key={field} className={`sheet-cell sheet-cell-muted${selClass}`} style={{ width: cellW }}
          onClick={(e) => selectCell(e, el.id, field)}>
          <span className="sheet-type-text" data-type={el.type}>
            {TYPE_LABEL[el.type] ?? el.type}
          </span>
        </td>
      );
    }

    if (field === "parent") {
      if (el.type === "era") {
        return (
          <td key={field} className={`sheet-cell sheet-cell-muted sheet-cell-disabled${selClass}`} style={{ width: cellW }}
            onClick={(e) => selectCell(e, el.id, field)}>
            <span className="sheet-cell-na">—</span>
          </td>
        );
      }
      const p = getParentTitle(el);
      if (isEditing) {
        return (
          <td key={field} className="sheet-cell sheet-cell-editing" style={{ width: cellW }}>
            <input
              ref={parentInputRef}
              autoFocus
              className="sheet-input"
              value={editValue}
              onChange={handleParentChange}
              onBlur={commitEdit}
              onKeyDown={handleKeyDown}
            />
          </td>
        );
      }
      return (
        <td key={field} className={`sheet-cell sheet-cell-muted${selClass}`} style={{ width: cellW }}
          onClick={(e) => selectCell(e, el.id, field)}
          onDoubleClick={(e) => startEdit(e, el.id, field)}>
          {p || <span className="sheet-cell-empty">—</span>}
        </td>
      );
    }

    if (field === "parentType") {
      if (el.type !== "span") {
        return (
          <td key={field} className={`sheet-cell sheet-cell-muted sheet-cell-disabled${selClass}`} style={{ width: cellW }}
            onClick={(e) => selectCell(e, el.id, field)}>
            <span className="sheet-cell-na">—</span>
          </td>
        );
      }
      const isExtend = !!el.extendFrom;
      const toggleParentType = (e) => {
        e.stopPropagation();
        if (e.shiftKey) return;
        const updated = { ...el };
        if (isExtend) {
          updated.parent = el.extendFrom;
          delete updated.extendFrom;
        } else if (el.parent) {
          updated.extendFrom = el.parent;
          delete updated.parent;
        }
        onUpdate(updated);
      };
      return (
        <td key={field} className={`sheet-cell sheet-cell-muted sheet-cell-editable${selClass}`} style={{ width: cellW }}
          onClick={(e) => { selectCell(e, el.id, field); toggleParentType(e); }}>
          <span className="sheet-type-text" data-type={isExtend ? "extend" : "branch"}>
            {isExtend ? "extend" : "branch"}
          </span>
        </td>
      );
    }

    if (field === "mergeInto") {
      const m = getMergeIntoTitle(el);
      if (el.type !== "span") {
        return (
          <td key={field} className={`sheet-cell sheet-cell-muted sheet-cell-disabled${selClass}`} style={{ width: cellW }}
            onClick={(e) => selectCell(e, el.id, field)}>
            <span className="sheet-cell-na">—</span>
          </td>
        );
      }
      if (isEditing) {
        return (
          <td key={field} className="sheet-cell sheet-cell-editing" style={{ width: cellW }}>
            <input
              ref={mergeInputRef}
              autoFocus
              className="sheet-input"
              value={editValue}
              onChange={handleMergeIntoChange}
              onFocus={handleMergeIntoChange}
              onBlur={commitEdit}
              onKeyDown={handleKeyDown}
            />
          </td>
        );
      }
      return (
        <td key={field} className={`sheet-cell sheet-cell-muted${selClass}`} style={{ width: cellW }}
          onClick={(e) => selectCell(e, el.id, field)}
          onDoubleClick={(e) => startEdit(e, el.id, field)}>
          {m || <span className="sheet-cell-empty">—</span>}
        </td>
      );
    }

    if (field === "group") {
      if (el.type === "era") {
        return (
          <td key={field} className={`sheet-cell sheet-cell-muted sheet-cell-disabled${selClass}`} style={{ width: cellW }}
            onClick={(e) => selectCell(e, el.id, field)}>
            <span className="sheet-cell-na">—</span>
          </td>
        );
      }
      const currentGroup = el.groupId ? groups.find((g) => g.id === el.groupId) : null;
      const isGroupFormOpen = newGroupCellId === el.id;
      const expanded = isEditing || isGroupFormOpen;
      return (
        <td key={field}
          className={`sheet-cell sheet-cell-muted sheet-cell-editable${expanded ? " sheet-cell-group-expanded" : ""}${selClass}`}
          style={{ width: cellW }}
          onClick={(e) => selectCell(e, el.id, field)}
          onDoubleClick={(e) => { if (!expanded) startEdit(e, el.id, field); }}
        >
          {!expanded
            ? (currentGroup
                ? <span>{currentGroup.title}</span>
                : <span className="sheet-cell-empty">—</span>)
            : <div className="sheet-group-panel">
                {currentGroup && (
                  <div className="sheet-group-current">
                    <span className="sheet-group-current-name">{currentGroup.title}</span>
                    <button className="sheet-source-remove" style={{ opacity: 0.5 }}
                      onMouseDown={(e) => {
                        e.stopPropagation(); e.preventDefault();
                        const updated = { ...el }; delete updated.groupId;
                        onUpdate(updated); setEditCell(null);
                      }}>×</button>
                  </div>
                )}
                <div className="sheet-group-options">
                  {groups.filter((g) => g.id !== el.groupId).map((g) => (
                    <button key={g.id} className="sheet-group-option"
                      onMouseDown={(e) => {
                        e.stopPropagation(); e.preventDefault();
                        onUpdate({ ...el, groupId: g.id }); setEditCell(null); setNewGroupCellId(null);
                      }}>
                      {g.title}
                    </button>
                  ))}
                </div>
                <div className="sheet-source-add-row">
                  {!isGroupFormOpen
                    ? <button className="sheet-source-new-btn" style={{ width: "100%" }}
                        onMouseDown={(e) => {
                          e.stopPropagation(); e.preventDefault();
                          setNewGroupCellId(el.id); setEditCell(null);
                          setTimeout(() => newGroupInputRef.current?.focus(), 0);
                        }}>+ New group</button>
                    : <div className="sheet-group-new-form">
                        <input
                          ref={newGroupInputRef}
                          className="sheet-source-new-input"
                          placeholder="Group name"
                          value={newGroupName}
                          onChange={(e) => setNewGroupName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); commitNewGroup(el.id); }
                            if (e.key === "Escape") { setNewGroupCellId(null); setNewGroupName(""); }
                          }}
                        />
                        <div className="sheet-source-new-actions">
                          <button className="sheet-source-cancel-btn"
                            onMouseDown={(e) => { e.preventDefault(); setNewGroupCellId(null); setNewGroupName(""); }}>Cancel</button>
                          <button className="sheet-source-add-btn"
                            onMouseDown={(e) => { e.preventDefault(); commitNewGroup(el.id); }}>Add</button>
                        </div>
                      </div>
                  }
                </div>
              </div>}
        </td>
      );
    }

    if (field === "hideYear") {
      if (el.type === "era") {
        return (
          <td key={field} className={`sheet-cell sheet-cell-muted sheet-cell-disabled${selClass}`} style={{ width: cellW }}
            onClick={(e) => selectCell(e, el.id, field)}>
            <span className="sheet-cell-na">—</span>
          </td>
        );
      }
      return (
        <td key={field}
          className={`sheet-cell sheet-cell-center sheet-cell-editable${selClass}`}
          style={{ width: cellW }}
          onClick={(e) => { selectCell(e, el.id, field); if (!readOnly) toggleHideYear(e, el); }}
        >
          {el.hideYears && <Check size={13} className="sheet-check-icon" />}
        </td>
      );
    }

    if (field === "approximate") {
      return (
        <td key={field}
          className={`sheet-cell sheet-cell-center sheet-cell-editable${selClass}`}
          style={{ width: cellW }}
          onClick={(e) => { selectCell(e, el.id, field); if (!readOnly) toggleApproximate(e, el); }}
        >
          {el.approximate && <Check size={13} className="sheet-check-icon" />}
        </td>
      );
    }

    if (field === "color") {
      if (isEditing) {
        return (
          <td key={field} className="sheet-cell sheet-cell-editing" style={{ width: cellW }}>
            <input autoFocus className="sheet-input" value={editValue} placeholder="#000000"
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={commitEdit} onKeyDown={handleKeyDown} />
          </td>
        );
      }
      return (
        <td key={field} className={`sheet-cell sheet-cell-editable${selClass}`} style={{ width: cellW }}
          onClick={(e) => selectCell(e, el.id, field)}
          onDoubleClick={(e) => startEdit(e, el.id, field)}>
          {el.color
            ? <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: el.color, flexShrink: 0, border: "1px solid color-mix(in srgb, currentColor, transparent 70%)" }} />
                <span style={{ fontFamily: "monospace", fontSize: "var(--text-xs)" }}>{el.color}</span>
              </span>
            : <span className="sheet-cell-empty">inherit</span>}
        </td>
      );
    }

    if (field === "size") {
      if (el.type === "event") {
        return (
          <td key={field} className={`sheet-cell sheet-cell-muted sheet-cell-disabled${selClass}`} style={{ width: cellW }}
            onClick={(e) => selectCell(e, el.id, field)}>
            <span className="sheet-cell-na">—</span>
          </td>
        );
      }
      const sizeKey = el.type === "span" ? "spanSize" : "eraSize";
      const sizeVal = el[sizeKey] ?? "";
      const sizeOptions = el.type === "span"
        ? [["thin","Thin"],["normal","Normal"],["thick","Thick"]]
        : [["normal","Normal"],["thick","Thick"],["extra-thick","Extra Thick"]];
      if (isEditing) {
        return (
          <td key={field} className="sheet-cell sheet-cell-editing" style={{ width: cellW }}>
            <select
              autoFocus
              className="sheet-select-input"
              value={sizeVal || "normal"}
              onChange={(e) => {
                const updated = { ...el };
                if (e.target.value !== "normal") updated[sizeKey] = e.target.value; else delete updated[sizeKey];
                onUpdate(updated);
                setEditCell(null);
              }}
              onBlur={() => setEditCell(null)}
              onKeyDown={(e) => { if (e.key === "Escape") setEditCell(null); }}
            >
              {sizeOptions.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </td>
        );
      }
      return (
        <td key={field} className={`sheet-cell sheet-cell-muted sheet-cell-editable${selClass}`} style={{ width: cellW }}
          onClick={(e) => selectCell(e, el.id, field)}
          onDoubleClick={(e) => startEdit(e, el.id, field)}>
          {sizeVal || <span className="sheet-cell-empty">—</span>}
        </td>
      );
    }

    if (field === "hideDetails") {
      if (el.type === "event") {
        return (
          <td key={field} className={`sheet-cell sheet-cell-muted sheet-cell-disabled${selClass}`} style={{ width: cellW }}
            onClick={(e) => selectCell(e, el.id, field)}>
            <span className="sheet-cell-na">—</span>
          </td>
        );
      }
      const toggleHideDetails = (e) => {
        e.stopPropagation();
        if (e.shiftKey) return;
        const updated = { ...el };
        if (el.hideDetails) delete updated.hideDetails; else updated.hideDetails = true;
        onUpdate(updated);
      };
      return (
        <td key={field} className={`sheet-cell sheet-cell-center sheet-cell-editable${selClass}`} style={{ width: cellW }}
          onClick={(e) => { selectCell(e, el.id, field); toggleHideDetails(e); }}>
          {el.hideDetails && <Check size={13} className="sheet-check-icon" />}
        </td>
      );
    }

    if (field === "lineStyle" || field === "borderStyle") {
      const dataKey = field === "lineStyle" ? "eventLineStyle" : "eventBorderStyle";
      if (el.type !== "event") {
        return (
          <td key={field} className={`sheet-cell sheet-cell-muted sheet-cell-disabled${selClass}`} style={{ width: cellW }}
            onClick={(e) => selectCell(e, el.id, field)}>
            <span className="sheet-cell-na">—</span>
          </td>
        );
      }
      const styleVal = el[dataKey] ?? "";
      if (isEditing) {
        return (
          <td key={field} className="sheet-cell sheet-cell-editing" style={{ width: cellW }}>
            <select
              autoFocus
              className="sheet-select-input"
              value={styleVal || "solid"}
              onChange={(e) => {
                const updated = { ...el };
                if (e.target.value !== "solid") updated[dataKey] = e.target.value; else delete updated[dataKey];
                onUpdate(updated);
                setEditCell(null);
              }}
              onBlur={() => setEditCell(null)}
              onKeyDown={(e) => { if (e.key === "Escape") setEditCell(null); }}
            >
              <option value="solid">Solid</option>
              <option value="dashed">Dashed</option>
              <option value="dotted">Dotted</option>
              <option value="none">None</option>
            </select>
          </td>
        );
      }
      return (
        <td key={field} className={`sheet-cell sheet-cell-muted sheet-cell-editable${selClass}`} style={{ width: cellW }}
          onClick={(e) => selectCell(e, el.id, field)}
          onDoubleClick={(e) => startEdit(e, el.id, field)}>
          {styleVal || <span className="sheet-cell-empty">—</span>}
        </td>
      );
    }

    if (field === "icon") {
      const IconComp = el.icon ? ICON_MAP[el.icon] : null;
      const isRowSelected = selectedId === el.id;
      if (isEditing) {
        return (
          <td key={field} className="sheet-cell sheet-cell-editing" style={{ width: cellW }}>
            <input autoFocus className="sheet-input" value={editValue}
              placeholder="icon key"
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={commitEdit} onKeyDown={handleKeyDown} />
          </td>
        );
      }
      return (
        <td key={field} className={`sheet-cell sheet-cell-center sheet-cell-editable${selClass}`}
          style={{ width: cellW }}
          onClick={(e) => selectCell(e, el.id, field)}
          onDoubleClick={(e) => startEdit(e, el.id, field)}>
          {el.icon
            ? isRowSelected
              ? <span className="sheet-icon-key">{el.icon}</span>
              : IconComp ? <IconComp size={14} /> : <span className="sheet-icon-key">{el.icon}</span>
            : <span className="sheet-cell-empty">—</span>}
        </td>
      );
    }

    if (field === "thumbnail") {
      if (el.type !== "event") {
        return (
          <td key={field} className={`sheet-cell sheet-cell-muted sheet-cell-disabled${selClass}`} style={{ width: cellW }}
            onClick={(e) => selectCell(e, el.id, field)}>
            <span className="sheet-cell-na">—</span>
          </td>
        );
      }
      const thumbName = el.thumbnail
        ? (() => { try { return decodeURIComponent(el.thumbnail).split(/[/\\]/).pop() || el.thumbnail; } catch { return el.thumbnail.split("/").pop() || el.thumbnail; } })()
        : null;
      const isPanelOpen = thumbPanelCellId === el.id;
      const timelineId = file.id?.replace(/-timeline$/, "");
      const openPanel = (e) => {
        selectCell(e, el.id, field);
        if (readOnly || e.shiftKey) return;
        if (!isPanelOpen) {
          const isRemote = el.thumbnail?.startsWith("http://") || el.thumbnail?.startsWith("https://");
          setThumbPanelCellId(el.id);
          setThumbPanelUrl(isRemote ? el.thumbnail : "");
        } else setThumbPanelCellId(null);
      };
      const closePanel = () => { setThumbPanelCellId(null); setThumbPanelUrl(""); };
      const saveUrl = () => {
        const v = thumbPanelUrl.trim();
        if (!v) { closePanel(); return; }
        onUpdate({ ...el, thumbnail: v });
        closePanel();
      };
      const removeThumb = () => {
        const updated = { ...el };
        delete updated.thumbnail;
        onUpdate(updated);
        closePanel();
      };
      const browseThumb = async (e) => {
        e.stopPropagation();
        if (!timelineId) return;
        const result = await pickAndImportImage({ timelineId });
        if (result?.cancelled || !result?.success) return;
        onUpdate({ ...el, thumbnail: result.assetUrl });
        closePanel();
      };
      return (
        <td key={field}
          className={`sheet-cell sheet-cell-muted${isPanelOpen ? " sheet-cell-sources" : " sheet-cell-editable"}${selClass}`}
          style={{ width: cellW }}
          onClick={openPanel}>
          {!isPanelOpen && (
            thumbName
              ? <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <ImageIcon size={12} style={{ flexShrink: 0, color: "var(--text-muted)" }} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{thumbName}</span>
                </span>
              : <span className="sheet-cell-empty">—</span>
          )}
          {isPanelOpen && (
            <div className="sheet-source-new-form" onClick={(e) => e.stopPropagation()}>
              <input
                autoFocus
                className="sheet-source-new-input"
                placeholder="Paste image URL or path"
                value={thumbPanelUrl}
                onChange={(e) => setThumbPanelUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") saveUrl(); if (e.key === "Escape") closePanel(); }}
              />
              <button className="sheet-source-new-btn" style={{ width: "100%", marginTop: 4, justifyContent: "center" }}
                onMouseDown={browseThumb}>
                Upload image…
              </button>
              <div className="sheet-source-new-actions">
                {el.thumbnail
                  ? <button className="sheet-source-cancel-btn" style={{ color: "var(--danger, #e05)" }} onMouseDown={removeThumb}>Remove</button>
                  : <button className="sheet-source-cancel-btn" onMouseDown={closePanel}>Cancel</button>}
                <button className="sheet-source-add-btn" onMouseDown={saveUrl}>Save</button>
              </div>
            </div>
          )}
        </td>
      );
    }

    if (field === "thumbnailStyle") {
      if (el.type !== "event" || !el.thumbnail) {
        return (
          <td key={field} className={`sheet-cell sheet-cell-muted sheet-cell-disabled${selClass}`} style={{ width: cellW }}
            onClick={(e) => selectCell(e, el.id, field)}>
            <span className="sheet-cell-na">—</span>
          </td>
        );
      }
      const THUMB_STYLES = [
        { value: "strip",       label: "Left strip"  },
        { value: "banner",      label: "Top banner"  },
        { value: "square-fill", label: "Square fill" },
        { value: "circle-fill", label: "Circle fill" },
      ];
      const styleVal = el.thumbnailStyle ?? "strip";
      const styleLabel = THUMB_STYLES.find((s) => s.value === styleVal)?.label ?? styleVal;
      if (isEditing) {
        return (
          <td key={field} className="sheet-cell sheet-cell-editing" style={{ width: cellW }}>
            <select autoFocus className="sheet-select-input"
              value={styleVal}
              onChange={(e) => {
                const updated = { ...el, thumbnailStyle: e.target.value };
                onUpdate(updated); setEditCell(null);
              }}
              onBlur={() => setEditCell(null)}
              onKeyDown={(e) => { if (e.key === "Escape") setEditCell(null); }}
            >
              {THUMB_STYLES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </td>
        );
      }
      return (
        <td key={field} className={`sheet-cell sheet-cell-muted sheet-cell-editable${selClass}`} style={{ width: cellW }}
          onClick={(e) => selectCell(e, el.id, field)}
          onDoubleClick={(e) => startEdit(e, el.id, field)}>
          {el.thumbnail
            ? <span>{styleLabel}</span>
            : <span className="sheet-cell-empty">—</span>}
        </td>
      );
    }

    if (field === "note") {
      if (isEditing) {
        return (
          <td key={field} className="sheet-cell sheet-cell-editing" style={{ width: cellW }}>
            <input
              ref={noteInputRef}
              autoFocus
              className="sheet-input"
              value={editValue}
              onChange={handleNoteChange}
              onFocus={handleNoteChange}
              onBlur={commitEdit}
              onKeyDown={handleKeyDown}
              placeholder="filename.md"
            />
          </td>
        );
      }
      return (
        <td key={field} className={`sheet-cell sheet-cell-muted sheet-cell-editable${selClass}`} style={{ width: cellW }}
          onClick={(e) => selectCell(e, el.id, field)}
          onDoubleClick={(e) => startEdit(e, el.id, field)}>
          {el.noteFile
            ? <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <FileText size={12} className="sheet-note-icon" style={{ flexShrink: 0 }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{el.noteFile}</span>
              </span>
            : <span className="sheet-cell-empty">—</span>}
        </td>
      );
    }

    if (field === "sources") {
      const srcList = el.sources ?? [];
      const isNewFormOpen = newSourceCellId === el.id;
      return (
        <td key={field}
          className={`sheet-cell sheet-cell-muted${srcList.length > 0 || isEditing || isNewFormOpen ? " sheet-cell-sources" : ""}${selClass}`}
          style={{ width: cellW }}
          onClick={(e) => selectCell(e, el.id, field)}
          onDoubleClick={(e) => startEdit(e, el.id, field)}>
          {srcList.length === 0 && !isEditing && !isNewFormOpen
            ? <span className="sheet-cell-empty">—</span>
            : <div className="sheet-sources-list">
                {srcList.map((src, i) => {
                  const sub = srcSubtitle(src);
                  return (
                    <div key={i} className={`sheet-source-item${isEditing || isNewFormOpen ? " sheet-source-item-edit" : ""}`}>
                      <div className="sheet-source-avatar">{src.title.charAt(0).toUpperCase()}</div>
                      <div className="sheet-source-text">
                        <span className="sheet-source-title">{src.title}</span>
                        {sub && <span className="sheet-source-sub">{sub}</span>}
                      </div>
                      {(isEditing || isNewFormOpen) && (
                        <button
                          className="sheet-source-remove"
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            const updated = { ...el, sources: srcList.filter((_, j) => j !== i) };
                            if (!updated.sources.length) delete updated.sources;
                            onUpdate(updated);
                          }}
                        >×</button>
                      )}
                    </div>
                  );
                })}
                {isEditing && !isNewFormOpen && (
                  <div className="sheet-source-add-row">
                    <input
                      ref={sourceInputRef}
                      autoFocus
                      className="sheet-source-search"
                      value={editValue}
                      onChange={handleSourceChange}
                      onFocus={handleSourceChange}
                      onBlur={commitEdit}
                      onKeyDown={handleKeyDown}
                      placeholder="Search existing…"
                    />
                    <button
                      className="sheet-source-new-btn"
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        setNewSourceCellId(el.id);
                        setEditCell(null);
                        setSourceDropdown([]);
                        setTimeout(() => newSourceTitleRef.current?.focus(), 0);
                      }}
                    >+ New</button>
                  </div>
                )}
                {isNewFormOpen && (
                  <div className="sheet-source-new-form">
                    <input
                      ref={newSourceTitleRef}
                      className="sheet-source-new-input"
                      placeholder="Title"
                      value={newSourceTitle}
                      onChange={(e) => setNewSourceTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); commitNewSource(el.id); }
                        if (e.key === "Escape") { setNewSourceCellId(null); setNewSourceTitle(""); setNewSourceUrl(""); setNewSourceDesc(""); }
                      }}
                    />
                    <input
                      className="sheet-source-new-input"
                      placeholder="URL (optional)"
                      value={newSourceUrl}
                      onChange={(e) => setNewSourceUrl(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); commitNewSource(el.id); }
                        if (e.key === "Escape") { setNewSourceCellId(null); setNewSourceTitle(""); setNewSourceUrl(""); setNewSourceDesc(""); }
                      }}
                    />
                    <input
                      className="sheet-source-new-input"
                      placeholder="Description (optional)"
                      value={newSourceDesc}
                      onChange={(e) => setNewSourceDesc(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); commitNewSource(el.id); }
                        if (e.key === "Escape") { setNewSourceCellId(null); setNewSourceTitle(""); setNewSourceUrl(""); setNewSourceDesc(""); }
                      }}
                    />
                    <div className="sheet-source-new-actions">
                      <button className="sheet-source-cancel-btn" onMouseDown={(e) => { e.preventDefault(); setNewSourceCellId(null); setNewSourceTitle(""); setNewSourceUrl(""); setNewSourceDesc(""); }}>Cancel</button>
                      <button className="sheet-source-add-btn" onMouseDown={(e) => { e.preventDefault(); commitNewSource(el.id); }}>Add</button>
                    </div>
                  </div>
                )}
              </div>}
        </td>
      );
    }

    if (field === "end" && el.type === "event") {
      return (
        <td key={field} className={`sheet-cell sheet-cell-muted sheet-cell-disabled${selClass}`} style={{ width: cellW }}
          onClick={(e) => selectCell(e, el.id, field)}>
          <span className="sheet-cell-na">—</span>
        </td>
      );
    }

    if (field === "description" && el.type !== "span") {
      return (
        <td key={field} className={`sheet-cell sheet-cell-muted sheet-cell-disabled${selClass}`} style={{ width: cellW }}
          onClick={(e) => selectCell(e, el.id, field)}>
          <span className="sheet-cell-na">—</span>
        </td>
      );
    }

    let display = "";
    if      (field === "date")   display = getDateDisplay(el);
    else if (field === "end")    display = getEndDisplay(el) ?? "";
    else if (field === "title")  display = el.title ?? "";
    else if (field === "description") display = el.type === "span" ? (el.description ?? "") : "";
    else if (field === "tags")   display = (el.tags ?? []).join(", ");
    else if (field === "coords") display = (el.lat != null && el.lng != null) ? `${el.lat}, ${el.lng}` : "";
    else if (field === "wiki")   display = el.wikiUrl ?? "";

    if (isEditing) {
      return (
        <td key={field} className="sheet-cell sheet-cell-editing" style={{ width: cellW }}>
          <input
            ref={field === "tags" ? tagInputRef : undefined}
            autoFocus
            className="sheet-input"
            value={editValue}
            onChange={field === "tags" ? handleTagsChange : (e) => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleKeyDown}
          />
        </td>
      );
    }

    return (
      <td key={field} className={`sheet-cell sheet-cell-editable${field === "title" ? " sheet-cell-name" : ""}${selClass}`} style={{ width: cellW }}
        onClick={(e) => selectCell(e, el.id, field)}
        onDoubleClick={(e) => startEdit(e, el.id, field)}>
        {display || <span className="sheet-cell-empty">—</span>}
      </td>
    );
  };

  const hasActiveFilter = activeTags.length > 0 || hiddenTags.length > 0;

  return (
    <div
      className={`sheet-container${readOnly ? " sheet-readonly" : ""}`}
      style={{
        paddingLeft: leftPanelWidth,
        paddingRight: isRightPanelOpen ? rightPanelWidth : 0,
      }}
    >
      {/* Header bar + column bar: sticky as one unit to avoid scroll-through gap */}
      <div ref={stickyTopRef} className="sheet-sticky-top">
      {/* Header bar: title/menu + search + new */}
      <div className="sheet-header">
        <div className="sheet-header-title-wrap" ref={headerMenuRef} onClick={() => { if (hasHeaderMenu) setHeaderMenuOpen((v) => !v); }}>
          <div className="sidebar-header" style={{ margin: 0, padding: 0, border: 'none', cursor: hasHeaderMenu ? 'pointer' : 'default' }}>
            <h2 className="timeline-title">{displayName}</h2>
            {hasHeaderMenu && <ChevronDown size={16} className="sidebar-menu" strokeWidth={2} color="var(--text-primary)" />}
          </div>
          {file.title && (
            <div className="sidebar-info" style={{ padding: 0, border: 'none' }}>
              <h3 className="sidebar-info-title">{file.title}</h3>
            </div>
          )}
          {headerMenuOpen && (
            <div className="timeline-context-menu sheet-header-menu">
              {onBackToHome && (
                <button className="context-menu-item" onClick={() => { setHeaderMenuOpen(false); onBackToHome(); }}>
                  <ArrowLeft size={14} /><span>Back to Files</span>
                </button>
              )}
              {!readOnly && onOpenSettings && (
                <>
                  <div className="context-menu-separator" />
                  <button className="context-menu-item" onClick={() => { setHeaderMenuOpen(false); onOpenSettings(); }}>
                    <Settings size={14} /><span>Settings</span>
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <div className="sb-search-row sheet-search-expand">
          <Search size={12} className="sb-search-icon" />
          <input
            className="sb-search-input"
            type="text"
            placeholder="Search…"
            spellCheck={false}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="sheet-header-controls">
          {!readOnly && (
          <div className="sb-new-wrapper" ref={exportMenuRef}>
            <button className="sb-new-btn" title="Export" onClick={() => setExportMenuOpen((v) => !v)}>
              <Download size={13} strokeWidth={2.5} />
              <span>Export</span>
              <ChevronDown size={11} strokeWidth={2.5} />
            </button>
            {exportMenuOpen && (
              <div className="sb-new-menu sheet-export-menu">
                <div className="sb-new-menu-section-label">Export</div>
                <button className="sb-new-menu-item" onClick={() => { setExportMenuOpen(false); exportCsv(); }}>
                  Comma-separated
                  <span className="sb-new-menu-shortcut">.csv</span>
                </button>
                <button className="sb-new-menu-item" onClick={() => { setExportMenuOpen(false); exportJson(); }}>
                  Structured data
                  <span className="sb-new-menu-shortcut">.json</span>
                </button>
              </div>
            )}
          </div>
          )}
          {!readOnly && (onAddEvent || onAddSpan || onAddEra) && (
            <div className="sb-new-wrapper" ref={newMenuRef}>
              <button className="sb-new-btn" onClick={() => setNewMenuOpen((v) => !v)}>
                <Plus size={13} strokeWidth={2.5} />
                <span>New</span>
                <ChevronDown size={11} strokeWidth={2.5} />
              </button>
              {newMenuOpen && (
                <div className="sb-new-menu">
                  {onAddEra && (
                    <button className="sb-new-menu-item" onClick={() => { setNewMenuOpen(false); setSearch(""); onAddEra(); }}>
                      <span className="sb-new-menu-icon"><span style={{ display: "inline-block", width: 9, height: 9, border: "2px solid currentColor", borderRadius: 2 }} /></span>
                      Era
                    </button>
                  )}
                  {onAddSpan && (
                    <button className="sb-new-menu-item" onClick={() => { setNewMenuOpen(false); setSearch(""); onAddSpan(); }}>
                      <span className="sb-new-menu-icon"><span style={{ display: "inline-block", width: 12, height: 2, borderRadius: 1, background: "currentColor" }} /></span>
                      Span
                    </button>
                  )}
                  {onAddEvent && (
                    <button className="sb-new-menu-item" onClick={() => { setNewMenuOpen(false); setSearch(""); onAddEvent(); }}>
                      <span className="sb-new-menu-icon"><span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "currentColor" }} /></span>
                      Event
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          <div className="sheet-colbar-divider" />
          {onSetViewMode && (
            <button
              type="button"
              className="timeline-canvas-button"
              onClick={() => onSetViewMode("timeline")}
              data-tooltip="Timeline view"
            >
              <GanttChartSquare size={16} />
            </button>
          )}
          <button
            type="button"
            ref={filterBtnRef}
            className={`timeline-canvas-button${hasActiveFilter ? " timeline-canvas-button-active" : ""}`}
            onClick={() => setFilterOpen((v) => !v)}
            data-tooltip="Filter"
          >
            <ListFilter size={16} />
          </button>
          {onOpenSettings && (
            <button
              type="button"
              className="timeline-canvas-button"
              onClick={onOpenSettings}
              data-tooltip="Settings"
            >
              <Settings size={16} />
            </button>
          )}
        </div>
      </div>

      <div ref={colbarRef} className="sheet-colbar">
        <span className="sheet-colbar-label">Fields</span>
        <div className="sheet-colbar-divider" />
        {OPTIONAL_COLS.map((col) => (
          <button
            key={col.key}
            type="button"
            className={`sheet-colbar-btn${!hiddenCols.has(col.key) ? " sheet-colbar-btn-on" : ""}`}
            onClick={() => toggleCol(col.key)}
          >
            {col.label}
          </button>
        ))}
      </div>
      </div>{/* end sheet-sticky-top */}

      <div ref={scrollRef} className="sheet-scroll-x" onClick={() => {
        if (didDragRef.current) { didDragRef.current = false; return; }
        setSelectedCell(null); setSelEnd(null); clearAllMenus();
      }}>
      <table className="sheet-table" style={{ width: visibleCols.reduce((s, c) => s + w(c.key), 0) }}>
        <colgroup>
          {visibleCols.map((col) => (
            <col key={col.key} style={{ width: w(col.key) }} />
          ))}
        </colgroup>
        <thead className="sheet-thead" style={{ top: 0 }}>
          <tr>
            {visibleCols.map((col) => (
              <th
                key={col.key}
                className={`sheet-th sheet-th-sortable${sortField === col.key ? " sheet-th-active" : ""}`}
                style={{ width: w(col.key) }}
                onClick={() => handleSortClick(col.key)}
              >
                {col.label}
                <SortIcon field={col.key} />
                <div className="sheet-resize-handle" onMouseDown={(e) => startResize(e, col.key)} onClick={(e) => e.stopPropagation()} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody onMouseDown={handleTableMouseDown} onMouseOver={handleTableMouseOver}>
          {sortedElements.length === 0 ? (
            <tr>
              <td colSpan={visibleCols.length} className="sheet-empty">
                No elements to display
              </td>
            </tr>
          ) : (
            sortedElements.map((el) => (
              <tr
                key={el.id}
                data-row-id={el.id}
                ref={(node) => { if (node) rowRefs.current[el.id] = node; else delete rowRefs.current[el.id]; }}
                className={`sheet-row${selectedId === el.id ? " sheet-row-selected" : ""}`}
                onClick={() => onSelect(el.id)}
                onContextMenu={(e) => {
                  if (readOnly) return;
                  e.preventDefault();
                  let ids = [el.id];
                  const r = rowIndexById[el.id];
                  if (selRect && r != null && r >= selRect.top && r <= selRect.bottom) {
                    ids = sortedElements.slice(selRect.top, selRect.bottom + 1).map((x) => x.id);
                  }
                  setCtxMenu({ x: e.clientX, y: e.clientY, id: el.id, ids });
                }}
              >
                {visibleCols.map((col) => renderCell(el, col))}
              </tr>
            ))
          )}
        </tbody>
      </table>
      </div>{/* end sheet-scroll-x */}


      {/* Row context menu */}
      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          className="timeline-context-menu"
          style={{ position: "fixed", left: ctxMenu.x, top: ctxMenu.y, zIndex: 300 }}
        >
          {onDuplicate && (
            <button className="context-menu-item" onClick={() => { onDuplicate(ctxMenu.id); setCtxMenu(null); }}>
              Duplicate
            </button>
          )}
          {onDelete && (
            <button className="context-menu-item context-menu-item-danger"
              onClick={() => { onDelete(ctxMenu.ids?.length > 1 ? ctxMenu.ids : ctxMenu.id); setCtxMenu(null); }}>
              {ctxMenu.ids?.length > 1 ? `Delete ${ctxMenu.ids.length} elements` : "Delete"}
            </button>
          )}
        </div>
      )}

      {/* Tag autocomplete dropdown */}
      {tagDropdown.length > 0 && tagDropdownPos && (
        <div
          className="timeline-context-menu sheet-tag-dropdown"
          style={{ position: "fixed", left: tagDropdownPos.left, top: tagDropdownPos.top, minWidth: tagDropdownPos.width }}
        >
          {tagDropdown.map((tag) => (
            <button
              key={tag}
              className="context-menu-item"
              onMouseDown={(e) => { e.preventDefault(); selectDropdownTag(tag); }}
            >
              {tag}
            </button>
          ))}
        </div>
      )}

      {/* Parent autocomplete dropdown */}
      {parentDropdown.length > 0 && parentDropdownPos && (
        <div
          className="timeline-context-menu sheet-tag-dropdown"
          style={{ position: "fixed", left: parentDropdownPos.left, top: parentDropdownPos.top, minWidth: parentDropdownPos.width }}
        >
          {parentDropdown.map((pel) => (
            <button
              key={pel.id}
              className="context-menu-item"
              onMouseDown={(e) => { e.preventDefault(); selectDropdownParent(pel); }}
            >
              {pel.title}
            </button>
          ))}
        </div>
      )}



      {/* Source autocomplete dropdown */}
      {sourceDropdown.length > 0 && sourceDropdownPos && (
        <div
          className="timeline-context-menu sheet-tag-dropdown sheet-source-dropdown"
          style={{ position: "fixed", left: sourceDropdownPos.left, top: sourceDropdownPos.top, minWidth: sourceDropdownPos.width }}
        >
          {sourceDropdown.map((src, i) => (
            <button
              key={`${src.title}-${i}`}
              className="context-menu-item"
              style={{ flexDirection: "column", alignItems: "flex-start", gap: 1 }}
              onMouseDown={(e) => { e.preventDefault(); selectDropdownSource(src); }}
            >
              <span>{src.title}</span>
              {src.url && <span style={{ fontSize: "var(--text-2xs)", color: "var(--text-subtle)", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%", whiteSpace: "nowrap" }}>{src.url}</span>}
            </button>
          ))}
        </div>
      )}

      {/* Note autocomplete dropdown */}
      {noteDropdown.length > 0 && noteDropdownPos && (
        <div
          className="timeline-context-menu sheet-tag-dropdown"
          style={{ position: "fixed", left: noteDropdownPos.left, top: noteDropdownPos.top, minWidth: noteDropdownPos.width }}
        >
          {noteDropdown.map((filename) => (
            <button
              key={filename}
              className="context-menu-item"
              onMouseDown={(e) => { e.preventDefault(); selectDropdownNote(filename); }}
            >
              {filename}
            </button>
          ))}
        </div>
      )}

      {/* Merge Into autocomplete dropdown */}
      {mergeDropdown.length > 0 && mergeDropdownPos && (
        <div
          className="timeline-context-menu sheet-tag-dropdown"
          style={{ position: "fixed", left: mergeDropdownPos.left, top: mergeDropdownPos.top, minWidth: mergeDropdownPos.width }}
        >
          {mergeDropdown.map((span) => (
            <button
              key={span.id}
              className="context-menu-item"
              onMouseDown={(e) => { e.preventDefault(); selectDropdownMergeInto(span); }}
            >
              {span.title}
            </button>
          ))}
        </div>
      )}

      {/* Filter dropdown */}
      {filterOpen && (
        <div
          ref={filterMenuRef}
          className="timeline-context-menu sidebar-filter-menu"
          style={{ position: "fixed", right: 50, top: stickyTopHeight + 8 }}
        >
          <div className="filter-menu-dropdown">
            {allTags.length === 0 && (
              <div className="filter-menu-empty">No tags found</div>
            )}
            {allTags.map((tag) => {
              const isShown = activeTags.includes(tag);
              const isHidden = hiddenTags.includes(tag);
              const isPinned = pinnedTags.includes(tag);
              return (
                <div key={tag} className="context-menu-item filter-menu-item filter-menu-item-with-pin">
                  <span className="filter-menu-label">{tag}</span>
                  <div className="filter-menu-actions">
                    <button type="button"
                      className={`filter-menu-icon-btn filter-menu-show-btn${isShown ? " is-active" : ""}`}
                      onClick={(e) => { e.stopPropagation(); onToggleTag?.(tag); }}
                      title={isShown ? "Disable show filter" : "Enable show filter"}
                    ><Eye size={12} /></button>
                    <button type="button"
                      className={`filter-menu-icon-btn filter-menu-hide-btn${isHidden ? " is-active" : ""}`}
                      onClick={(e) => { e.stopPropagation(); onToggleHiddenTag?.(tag); }}
                      title={isHidden ? "Disable hide filter" : "Enable hide filter"}
                    ><EyeOff size={12} /></button>
                    <button type="button"
                      className={`filter-menu-icon-btn filter-menu-pin-btn${isPinned ? " is-pinned" : ""}`}
                      onClick={(e) => { e.stopPropagation(); onTogglePinnedTag?.(tag); }}
                      title={isPinned ? "Remove label" : "Use as label"}
                    ><Tag size={12} /></button>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="filter-menu-divider" />
          <button className="context-menu-item" type="button" onClick={() => { onClearTags?.(); }}>
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
