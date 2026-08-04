import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from "react";
import { Maximize2, Minimize2, Underline, Link, Trash2, Unlink, ChevronLeft, ChevronRight, ChevronDown, Pencil, ExternalLink, Calendar, Clock, FileText, BookOpen, ImagePlus, RotateCcw, X } from "lucide-react";
import NoteEditor from "./NoteEditor";
import WikiSection from "./WikiSection";
import SourcesSection from "./SourcesSection";
import { useNoteManagement } from "../hooks/useNoteManagement";
import IconPicker from "./IconPicker";
import { ICON_MAP } from "../config/elementIcons";
import { parseTimelineInput, fractionalYearToDate, displayDateLabel, formatDateForInput, formatCalendarDate } from "../utils/dateUtils";

const DYNAMIC_DATE_OPTIONS = [
  { label: "Today", value: "current" },
  { label: "This month", value: "current-month" },
  { label: "This year", value: "current-year" },
];
import { formatYear } from "../utils/timelineUtils";
import { isValidIdValue, isValidTagValue, normalizeTagValue, buildValidatedUpdate } from "../utils/validation";
import { normalizeColor } from "../utils/colorUtils";
import ColorPicker from "./ColorPicker";



function SectionHeader({ title, isOpen, onToggle, summary }) {
  return (
    <button type="button" className="edit-section-header" onClick={onToggle}>
      <ChevronDown size={15} className={`edit-section-header-chevron${isOpen ? "" : " is-collapsed"}`} />
      <span className="edit-section-header-title">{title}</span>
      {!isOpen && summary && (
        <span className="edit-section-header-summary">{summary}</span>
      )}
    </button>
  );
}

const EVENT_STROKE_STYLE_OPTIONS = [
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "dotted", label: "Dotted" },
  { value: "none", label: "None" },
];

export default function RightPanel({
  onSelect,
  selectedElement,
  onUpdate,
  timelineData,
  editRequestId,
  onEditRequestHandled,
  isMaximized,
  onToggleMaximize,
  onFilterByTag,
  activeTags = [],
  onToggleTag,
  tagColors = {},
  onRequestDelete,
  onSelectPrevious,
  onSelectNext,
  prevElement,
  nextElement,
  readOnly = false,
  onClose,
}) {
  const [formData, setFormData] = useState(null);
  const [validationErrors, setValidationErrors] = useState([]);
  const [isEditMode, setIsEditMode] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isThumbnailUrlMode, setIsThumbnailUrlMode] = useState(false);
  const [thumbnailUrlInput, setThumbnailUrlInput] = useState("");
  const [isDetailsOpen, setIsDetailsOpen] = useState(true);
  const [isDisplayOpen, setIsDisplayOpen] = useState(true);
  const [isNotesOpen, setIsNotesOpen] = useState(true);

  const {
    noteInitialContent,
    isNoteLoading,
    noteExists,
    isNoteAddOpen,
    setIsNoteAddOpen,
    noteEditorRef,
    noteWordCount,
    noteViewCallbackRef,
    handleTaskToggle,
    handleNoteSave,
    handleAddNote,
    handleAddExistingNote,
    handleDeleteNote,
    handleUnlinkNote,
    handlePickLocalImage,
    handlePickThumbnail,
    handleDropThumbnail,
  } = useNoteManagement({ selectedElement, timelineData, formData, setFormData, onUpdate });
  const prevSelectedIdRef = useRef(null);
  const titleTextareaRef = useRef(null);

  useLayoutEffect(() => {
    const el = titleTextareaRef.current;
    if (!el) return;
    const syncHeight = () => {
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    };
    syncHeight();
    const parent = el.parentElement;
    if (!parent) return;
    const observer = new ResizeObserver(syncHeight);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [formData?.title, isEditMode]);
  const [spanParentQuery, setSpanParentQuery] = useState("");
  const [isSpanParentMenuOpen, setIsSpanParentMenuOpen] = useState(false);
  const spanParentMenuTimeoutRef = useRef(null);
  const [spanRelationType, setSpanRelationType] = useState("branch");
  const [isSpanRelationOpen, setIsSpanRelationOpen] = useState(false);
  const [mergeParentQuery, setMergeParentQuery] = useState("");
  const [isMergeParentMenuOpen, setIsMergeParentMenuOpen] = useState(false);
  const mergeParentMenuTimeoutRef = useRef(null);
  const [parentQuery, setParentQuery] = useState("");
  const [isParentMenuOpen, setIsParentMenuOpen] = useState(false);
  const parentMenuTimeoutRef = useRef(null);
  const [tagQuery, setTagQuery] = useState("");
  const [isTagMenuOpen, setIsTagMenuOpen] = useState(false);
  const tagMenuTimeoutRef = useRef(null);
  const [isNoteCollapsed, setIsNoteCollapsed] = useState(false);
  const [thumbnailMeta, setThumbnailMeta] = useState(null);
  const panelRef = useRef(null);
  const datePickerRefs = useRef({});
  const TAG_MAX_LENGTH = 32;
  const ID_MAX_LENGTH = 60;
  const showCalendarInputIcon = timelineData?.file?.useCalendar === true;
  const [dynamicMenuField, setDynamicMenuField] = useState(null);

  const applyDynamicDate = (field, keyword) => {
    const next = { ...formData, [field]: keyword };
    setFormData(next);
    commitDraft(next);
    setDynamicMenuField(null);
  };

  useEffect(() => {
    if (!dynamicMenuField) return;
    const close = (e) => {
      // ignore clicks on any dynamic-date toggle or menu so toggling/selecting works
      if (e.target.closest?.(".dynamic-date-menu, .edit-input-icon-button-dynamic")) return;
      setDynamicMenuField(null);
    };
    const onKeyDown = (e) => { if (e.key === "Escape") setDynamicMenuField(null); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [dynamicMenuField]);

  const renderDynamicDateButton = (field) => (
    <>
      <button
        type="button"
        className={`edit-input-icon-button edit-input-icon-button-dynamic${dynamicMenuField === field ? " is-open" : ""}`}
        aria-label="Insert dynamic date"
        title="Dynamic date (stays anchored to the current date)"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setDynamicMenuField((v) => (v === field ? null : field))}
      >
        <Clock size={14} className="edit-input-icon" aria-hidden="true" />
      </button>
      {dynamicMenuField === field && (
        <div className="span-relation-dropdown-menu dynamic-date-menu">
          {DYNAMIC_DATE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className="span-relation-dropdown-item"
              onMouseDown={() => applyDynamicDate(field, opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </>
  );

  const pushValidationError = (message) => {
    if (!message) return;
    setValidationErrors([message]);
  };

  const stripEditableEraSuffix = useCallback((input) => {
    const raw = String(input ?? "").trim();
    if (!raw) return "";
    const negSuffix = typeof timelineData?.file?.negID === "string" ? timelineData.file.negID.trim() : "";
    const posSuffix = typeof timelineData?.file?.posID === "string" ? timelineData.file.posID.trim() : "";
    let next = raw;

    if (negSuffix) {
      const spacedNegSuffix = ` ${negSuffix}`;
      if (next.endsWith(spacedNegSuffix)) {
        const base = next.slice(0, -spacedNegSuffix.length).trim();
        if (base && !base.startsWith("-")) {
          next = `-${base}`;
        } else {
          next = base;
        }
      }
    }

    if (posSuffix) {
      const spacedPosSuffix = ` ${posSuffix}`;
      if (next.endsWith(spacedPosSuffix)) {
        next = next.slice(0, -spacedPosSuffix.length).trim();
      }
    }

    return next;
  }, [
    timelineData?.file?.negID,
    timelineData?.file?.posID,
  ]);

  const formatEditableDateInput = useCallback((value, label) => {
    if (label != null && label !== "") return stripEditableEraSuffix(formatDateForInput(label));
    if (!Number.isFinite(value)) return value ?? "";
    return stripEditableEraSuffix(formatYear(
      value,
      timelineData?.file?.negID,
      timelineData?.file?.posID,
      timelineData?.file?.useCalendar === true,
      timelineData?.file?.hideDecimals
    ));
  }, [
    stripEditableEraSuffix,
    timelineData?.file?.negID,
    timelineData?.file?.posID,
    timelineData?.file?.useCalendar,
    timelineData?.file?.hideDecimals,
  ]);

  const getPickerIsoValue = useCallback((inputValue, fallbackValue) => {
    const parsed = parseTimelineInput(inputValue);
    const resolvedValue = Number.isFinite(parsed.value) ? parsed.value : fallbackValue;
    if (!Number.isFinite(resolvedValue)) return "";
    const { year, month, day } = fractionalYearToDate(resolvedValue);
    if (!Number.isFinite(year) || year < 0 || year > 9999) return "";
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }, []);

  const getTimelineLimitIsoValue = useCallback((value) => {
    if (!Number.isFinite(value)) return "";
    const { year, month, day } = fractionalYearToDate(value);
    if (!Number.isFinite(year) || year < 0 || year > 9999) return "";
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }, []);

  const calendarMinIso = showCalendarInputIcon
    ? getTimelineLimitIsoValue(timelineData?.file?.start)
    : "";
  const calendarMaxIso = showCalendarInputIcon
    ? getTimelineLimitIsoValue(timelineData?.file?.end)
    : "";

  const formatIsoAsEditableDate = useCallback((isoValue) => {
    const raw = String(isoValue ?? "").trim();
    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return "";
    const [, year, month, day] = match;
    return formatCalendarDate(Number(year), Number(month), Number(day), "day");
  }, []);

  const handleCalendarPick = useCallback((field, isoValue) => {
    const formatted = formatIsoAsEditableDate(isoValue);
    if (!formatted) return;
    const nextDraft = { ...formData, [field]: formatted };
    setFormData(nextDraft);
    commitDraft(nextDraft);
  }, [formData, formatIsoAsEditableDate]);

  const openCalendarPicker = useCallback((pickerKey) => {
    const input = datePickerRefs.current[pickerKey];
    if (!input) return;
    if (typeof input.showPicker === "function") {
      input.showPicker();
      return;
    }
    input.focus();
    input.click();
  }, []);

  useEffect(() => {
    const anyOpen = isSpanParentMenuOpen || isMergeParentMenuOpen ||
      isParentMenuOpen || isTagMenuOpen || isSpanRelationOpen;
    if (!anyOpen) return;
    const handleKeyDown = (e) => {
      if (e.key !== "Escape") return;
      setIsSpanParentMenuOpen(false);
      setIsMergeParentMenuOpen(false);
      setIsParentMenuOpen(false);
      setIsTagMenuOpen(false);
      setIsSpanRelationOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isSpanParentMenuOpen, isMergeParentMenuOpen, isParentMenuOpen, isTagMenuOpen, isSpanRelationOpen]);

  useEffect(() => {
    if (selectedElement) {
      const prevId = prevSelectedIdRef.current;
      const shouldPreserveEditMode = isEditMode;
      setFormData({
        ...selectedElement,
        dateInput: formatEditableDateInput(selectedElement.date, selectedElement.dateLabel),
        startInput: formatEditableDateInput(selectedElement.start, selectedElement.startLabel),
        endInput: formatEditableDateInput(selectedElement.end, selectedElement.endLabel),
      });
      const parentId = selectedElement.parents?.[0];
      const parentTitle = parentId
        ? timelineData?.elements?.find((el) => el.id === parentId)?.title || parentId
        : "";
      setParentQuery(parentTitle);
      setTagQuery("");
      setValidationErrors([]);
      if (prevId !== selectedElement.id) {
        setSpanRelationType(selectedElement.extendFrom ? "extend" : "branch");
        setIsThumbnailUrlMode(false);
        setThumbnailUrlInput("");
        if (!shouldPreserveEditMode) {
          setIsEditMode(false);
          setSpanParentQuery("");
          setIsSpanParentMenuOpen(false);
          setMergeParentQuery("");
          setIsMergeParentMenuOpen(false);
          setIsParentMenuOpen(false);
          setIsTagMenuOpen(false);
        }
      }
      prevSelectedIdRef.current = selectedElement.id;
    }
  }, [selectedElement, isEditMode, timelineData?.elements, formatEditableDateInput]);

  useEffect(() => {
    if (!isEditMode) {
      setSpanParentQuery("");
      setIsSpanParentMenuOpen(false);
      setMergeParentQuery("");
      setIsMergeParentMenuOpen(false);
      setIsParentMenuOpen(false);
      setIsTagMenuOpen(false);
    }
  }, [isEditMode]);



  useEffect(() => {
    if (!isEditMode) return;

    const handleOutsideClick = (event) => {
      const panel = panelRef.current;
      if (!panel || panel.contains(event.target)) {
        return;
      }
      if (formData) {
        commitDraft(formData);
        if (formData.noteFile) {
          noteEditorRef.current?.save();
        }
      }
    };

    document.addEventListener("mousedown", handleOutsideClick, true);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick, true);
    };
  }, [isEditMode, formData]);

  // Cleanup all menu timeouts on unmount
  useEffect(() => {
    return () => {
      if (spanParentMenuTimeoutRef.current) clearTimeout(spanParentMenuTimeoutRef.current);
      if (mergeParentMenuTimeoutRef.current) clearTimeout(mergeParentMenuTimeoutRef.current);
      if (parentMenuTimeoutRef.current) clearTimeout(parentMenuTimeoutRef.current);
      if (tagMenuTimeoutRef.current) clearTimeout(tagMenuTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (readOnly) return;
    if (!selectedElement || !editRequestId) return;
    if (selectedElement.id !== editRequestId) return;
    setIsEditMode(true);
    onEditRequestHandled?.();
  }, [selectedElement, editRequestId, onEditRequestHandled, readOnly]);

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (field === "dateInput" || field === "parents") {
      setValidationErrors([]);
    }
  };

  const getSpanNumericStart = (span) => {
    const parsed = parseTimelineInput(span.startLabel ?? span.start);
    return parsed.value ?? span.start;
  };

  const getSpanNumericEnd = (span) => {
    const parsed = parseTimelineInput(span.endLabel ?? span.end);
    return parsed.value ?? span.end;
  };

  const parentRange = useMemo(() => {
    if (!formData || formData.type !== "span") return null;
    const parsedStart = parseTimelineInput(formData.startInput ?? formData.start);
    const parsedEnd = parseTimelineInput(formData.endInput ?? formData.end);
    const start = parsedStart.value ?? formData.start;
    const end = parsedEnd.value ?? formData.end;
    if (start === undefined || end === undefined || start === null || end === null) {
      return null;
    }
    return { start, end };
  }, [formData]);

  const parentCandidates = useMemo(() => {
    if (!timelineData || !formData || formData.type !== "event") return [];
    return timelineData.elements
      .filter((el) => el.type === "span")
      .map((span) => ({
        ...span,
        _start: getSpanNumericStart(span),
        _end: getSpanNumericEnd(span),
      }))
      .filter((span) => {
        if (!Number.isFinite(span._start) || !Number.isFinite(span._end)) return false;
        if (!formData.dateInput) return true;
        const parsedEventDate = parseTimelineInput(formData.dateInput).value;
        if (!Number.isFinite(parsedEventDate)) return true;
        return parsedEventDate >= span._start && parsedEventDate <= span._end;
      });
  }, [timelineData, formData]);

  const parentSuggestions = useMemo(() => {
    const needle = parentQuery.trim().toLowerCase();
    if (!needle) return parentCandidates;
    return parentCandidates.filter((span) =>
      span.id.toLowerCase().includes(needle) ||
      (span.title || "").toLowerCase().includes(needle)
    );
  }, [parentCandidates, parentQuery]);

  const eventParentSpan = useMemo(() => {
    if (formData?.type !== "event") return null;
    const parentId = formData?.parents?.[0];
    if (!parentId) return null;
    return timelineData?.elements?.find(el => el.id === parentId && el.type === "span") ?? null;
  }, [formData?.type, formData?.parents, timelineData?.elements]);

  const resolvedDefaultBorderColor = useMemo(() => {
    try {
      return getComputedStyle(document.documentElement).getPropertyValue('--ui-muted').trim() || '#888888';
    } catch {
      return '#888888';
    }
  }, []);

  // Span parent candidates: spans whose time range contains this span's START
  const spanParentCandidates = useMemo(() => {
    if (!timelineData || !formData || formData.type !== "span" || !parentRange) return [];
    return timelineData.elements
      .filter((el) => el.type === "span" && el.id !== formData.id)
      .map((span) => ({
        ...span,
        _start: getSpanNumericStart(span),
        _end: getSpanNumericEnd(span),
      }))
      .filter((span) => Number.isFinite(span._start) && Number.isFinite(span._end) && parentRange.start >= span._start && parentRange.start <= span._end);
  }, [timelineData, formData, parentRange]);

  const spanParentSuggestions = useMemo(() => {
    if (!spanParentQuery.trim()) return spanParentCandidates;
    const needle = spanParentQuery.trim().toLowerCase();
    return spanParentCandidates.filter((span) =>
      span.id.toLowerCase().includes(needle) ||
      (span.title || "").toLowerCase().includes(needle)
    );
  }, [spanParentCandidates, spanParentQuery]);

  const extendFromCandidates = useMemo(() => {
    if (!timelineData || !formData || formData.type !== "span" || !parentRange) return [];
    return timelineData.elements
      .filter((el) => el.type === "span" && el.id !== formData.id)
      .map((span) => ({
        ...span,
        _start: getSpanNumericStart(span),
        _end: getSpanNumericEnd(span),
      }))
      .filter((span) => Number.isFinite(span._end) && Math.abs(span._end - parentRange.start) < 1e-6);
  }, [timelineData, formData, parentRange]);

  const extendFromSuggestions = useMemo(() => {
    if (!spanParentQuery.trim()) return extendFromCandidates;
    const needle = spanParentQuery.trim().toLowerCase();
    return extendFromCandidates.filter((span) =>
      span.id.toLowerCase().includes(needle) ||
      (span.title || "").toLowerCase().includes(needle)
    );
  }, [extendFromCandidates, spanParentQuery]);

  const extendEnabled = useMemo(() => {
    const selectedId = formData?.parent || formData?.extendFrom;
    if (!selectedId) return extendFromCandidates.length > 0;
    return extendFromCandidates.some((c) => c.id === selectedId);
  }, [formData?.parent, formData?.extendFrom, extendFromCandidates]);

  const mergeParentCandidates = useMemo(() => {
    if (!timelineData || !formData || formData.type !== "span" || !parentRange) return [];
    return timelineData.elements
      .filter((el) => el.type === "span" && el.id !== formData.id)
      .map((span) => ({
        ...span,
        _start: getSpanNumericStart(span),
        _end: getSpanNumericEnd(span),
      }))
      .filter((span) => Number.isFinite(span._start) && Number.isFinite(span._end) && parentRange.end >= span._start && parentRange.end <= span._end);
  }, [timelineData, formData, parentRange]);

  const mergeParentSuggestions = useMemo(() => {
    if (!mergeParentQuery.trim()) return mergeParentCandidates;
    const needle = mergeParentQuery.trim().toLowerCase();
    return mergeParentCandidates.filter((span) =>
      span.id.toLowerCase().includes(needle) ||
      (span.title || "").toLowerCase().includes(needle)
    );
  }, [mergeParentCandidates, mergeParentQuery]);


  const renderEventStrokeStyleControl = (field, currentValue, ariaLabel, variant) => (
    <div className="event-style-toggle" role="group" aria-label={ariaLabel}>
      {EVENT_STROKE_STYLE_OPTIONS.map((option) => {
        const isActive = (currentValue || "solid") === option.value;
        return (
          <button
            key={`${field}-${option.value}`}
            type="button"
            className={`event-style-option${isActive ? " is-active" : ""}`}
            aria-pressed={isActive ? "true" : "false"}
            aria-label={option.label}
            title={option.label}
            onClick={() => {
              const next = { ...formData, [field]: option.value };
              setFormData(next);
              commitDraft(next);
            }}
          >
            <span
              className={`event-style-preview event-style-preview-${variant} event-style-preview-${option.value}`}
              aria-hidden="true"
            />
          </button>
        );
      })}
    </div>
  );

  const tagCandidates = useMemo(() => {
    if (!timelineData) return [];
    const tags = new Set();
    timelineData.elements.forEach((element) => {
      if (Array.isArray(element.tags)) {
        element.tags.forEach((tag) => {
          if (tag) tags.add(tag);
        });
      }
    });
    return Array.from(tags).sort((a, b) => a.localeCompare(b));
  }, [timelineData]);

  const tagSuggestions = useMemo(() => {
    const needle = tagQuery.trim().toLowerCase();
    if (!needle) return tagCandidates;
    return tagCandidates.filter((tag) => tag.toLowerCase().includes(needle));
  }, [tagCandidates, tagQuery]);

  const setSpanParent = (spanId) => {
    if (!spanId) return;
    const { extendFrom: _e, ...base } = formData;
    const next = { ...base, parent: spanId };
    setFormData(next);
    commitDraft(next);
    setSpanParentQuery("");
    setIsSpanParentMenuOpen(false);
  };

  const setExtendFrom = (spanId) => {
    if (!spanId) return;
    const { parent: _p, ...base } = formData;
    const next = { ...base, extendFrom: spanId };
    setFormData(next);
    commitDraft(next);
    setSpanParentQuery("");
    setIsSpanParentMenuOpen(false);
  };

  const clearExtendFrom = () => {
    if (!formData.extendFrom) return;
    const { extendFrom: _e, ...rest } = formData;
    setFormData(rest);
    commitDraft(rest);
  };

  const clearSpanParent = () => {
    if (!formData.parent) return;
    const { parent: _p, ...rest } = formData;
    setFormData(rest);
    commitDraft(rest);
  };

  const handleSpanParentBlur = () => {
    if (spanParentMenuTimeoutRef.current) {
      clearTimeout(spanParentMenuTimeoutRef.current);
    }
    spanParentMenuTimeoutRef.current = setTimeout(() => {
      setIsSpanParentMenuOpen(false);
    }, 120);
  };

  const setMergeParent = (spanId) => {
    if (!spanId) return;
    setFormData((prev) => ({ ...prev, mergeParent: spanId }));
    commitDraft({ ...formData, mergeParent: spanId });
    setMergeParentQuery("");
    setIsMergeParentMenuOpen(false);
  };

  const clearMergeParent = () => {
    const { mergeParent: _m, ...rest } = formData;
    setFormData(rest);
    commitDraft(rest);
  };

  const handleMergeParentBlur = () => {
    if (mergeParentMenuTimeoutRef.current) {
      clearTimeout(mergeParentMenuTimeoutRef.current);
    }
    mergeParentMenuTimeoutRef.current = setTimeout(() => {
      setIsMergeParentMenuOpen(false);
    }, 120);
  };

  const handleParentBlur = () => {
    if (parentMenuTimeoutRef.current) {
      clearTimeout(parentMenuTimeoutRef.current);
    }
    const trimmed = parentQuery.trim();
    if (trimmed) {
      if (trimmed.length > ID_MAX_LENGTH) {
        pushValidationError(`Parent ID must be ${ID_MAX_LENGTH} characters or fewer.`);
        return;
      }
      if (!isValidIdValue(trimmed)) {
        pushValidationError("Parent ID can only include letters, numbers, hyphens, and underscores.");
        return;
      }
    }
    if (validationErrors.length) setValidationErrors([]);
    handleChange("parents", trimmed ? [trimmed] : []);
    commitDraft({ ...formData, parents: trimmed ? [trimmed] : [] });
    parentMenuTimeoutRef.current = setTimeout(() => {
      setIsParentMenuOpen(false);
    }, 120);
  };

  const handleTagBlur = () => {
    if (tagMenuTimeoutRef.current) {
      clearTimeout(tagMenuTimeoutRef.current);
    }
    tagMenuTimeoutRef.current = setTimeout(() => {
      setIsTagMenuOpen(false);
    }, 120);
  };

  const addTag = (tag) => {
    const normalized = normalizeTagValue(tag);
    if (!normalized) return;
    if (normalized.length > TAG_MAX_LENGTH) {
      pushValidationError(`Tags must be ${TAG_MAX_LENGTH} characters or fewer.`);
      return;
    }
    if (!isValidTagValue(normalized)) {
      pushValidationError("Tags can only include letters, numbers, spaces, hyphens, and underscores.");
      return;
    }
    const existing = Array.isArray(formData.tags) ? formData.tags : [];
    if (existing.includes(normalized)) return;
    const nextTags = [...existing, normalized];
    if (validationErrors.length) setValidationErrors([]);
    setFormData((prev) => ({ ...prev, tags: nextTags }));
    commitDraft({ ...formData, tags: nextTags });
    setTagQuery("");
    setIsTagMenuOpen(false);
  };

  const removeTag = (tag) => {
    const existing = Array.isArray(formData.tags) ? formData.tags : [];
    const nextTags = existing.filter((value) => value !== tag);
    setFormData((prev) => ({ ...prev, tags: nextTags }));
    commitDraft({ ...formData, tags: nextTags });
  };

  const handleSourcesChange = (nextSources, nextSourceLink) => {
    const next = { ...formData, sources: nextSources };
    if (nextSourceLink !== undefined) {
      if (nextSourceLink) next.sourceLink = nextSourceLink;
      else delete next.sourceLink;
    }
    setFormData(next);
    commitDraft(next);
  };

  const commitDraft = (draft) => {
    let effectiveDraft = draft;

    const { errors, nextData } = buildValidatedUpdate(effectiveDraft, timelineData);
    if (errors.length > 0) {
      setValidationErrors(errors);
      return false;
    }

    setValidationErrors([]);
    if (onUpdate) {
      onUpdate(nextData);
    }
    return true;
  };

  const formatDisplayYear = useCallback((value) => (
    formatYear(
      value,
      timelineData?.file?.negID,
      timelineData?.file?.posID,
      timelineData?.file?.useCalendar === true,
      timelineData?.file?.hideDecimals
    )
  ), [
    timelineData?.file?.negID,
    timelineData?.file?.posID,
    timelineData?.file?.useCalendar,
    timelineData?.file?.hideDecimals,
  ]);

  const toggleEditMode = useCallback(() => {
    setIsEditMode((prev) => {
      if (prev && formData?.noteFile) noteEditorRef.current?.save();
      return !prev;
    });
  }, [formData?.noteFile]);


  useEffect(() => {
    if (readOnly || !selectedElement) return;
    const handler = (e) => {
      if (e.key !== "e" && e.key !== "E") return;
      const target = e.target;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      e.preventDefault();
      toggleEditMode();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedElement, toggleEditMode, readOnly]);

  const handleWikiUrlChange = (newUrl) => {
    const next = { ...formData };
    if (newUrl) {
      next.wikiUrl = newUrl;
    } else {
      delete next.wikiUrl;
    }
    setFormData(next);
    commitDraft(next);
  };

  const showLegacyBreaks = timelineData?.file?.allowLegacyBreaks === true;

  if (!selectedElement || !formData) {
    return (
      <div className="right-panel">
        <div className="right-panel-header">
          <h2>No Selection</h2>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      className={`right-panel ${isMaximized ? "is-maximized" : ""}`}
    >
      <div className="right-panel-header">
        <span className="rp-type-label">{formData.type.charAt(0).toUpperCase() + formData.type.slice(1)}</span>
        <div className="right-panel-actions">
          {!readOnly && (
            <button
              className="close-button"
              type="button"
              onClick={toggleEditMode}
              title={isEditMode ? "Switch to overview" : "Edit"}
            >
              {isEditMode ? <BookOpen size={18} /> : <Pencil size={18} />}
            </button>
          )}
          {onClose ? (
            <button
              className="close-button"
              onClick={onClose}
              title="Close panel"
            >
              <X size={18} />
            </button>
          ) : (
            <button
              className="close-button"
              onClick={onToggleMaximize}
              title={isMaximized ? "Restore panel" : "Maximize panel"}
            >
              {isMaximized ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>
          )}
        </div>
      </div>

      <div className="right-panel-content">
        {!isEditMode ? (
          /* View Mode */
          <div className="view-mode">
            {/* Title */}
            <div className="view-group view-group-title">
              <label>Name</label>
              <div className="view-separator" />
              <p className="view-title-with-icon">
                {formData.icon && (() => { const Icon = ICON_MAP[formData.icon]; return Icon ? <Icon size={14} className="view-title-icon" /> : null; })()}
                {formData.title}
              </p>
            </div>

            {/* Date/Start/End based on type */}
            {formData.type === "event" ? (
                <div className="view-group">
                  <label>Date</label>
                  <div className="view-separator" />
                  <p>
                    {displayDateLabel(formData.dateLabel) ??
                      formatDisplayYear(formData.date)}
                  </p>
                </div>
            ) : (
              <div className="view-group">
                <label>Date</label>
                <div className="view-separator" />
                <p>
                  {(displayDateLabel(formData.startLabel) ?? formatDisplayYear(formData.start))}
                  {" – "}
                  {(displayDateLabel(formData.endLabel) ?? formatDisplayYear(formData.end))}
                </p>
              </div>
            )}

            {/* Color (spans and eras only) */}

            {/* Parent (events only) */}
            {formData.type === "event" && formData.parents && formData.parents.length > 0 && formData.parents[0] && (
              <div className="view-group">
                <label>Parent</label>
                <div className="view-separator" />
                <button
                  type="button"
                  className="parent-link"
                  onClick={() => onSelect(formData.parents[0])}
                >
                  {timelineData.elements.find(el => el.id === formData.parents[0])?.title || formData.parents[0]}
                </button>
              </div>
            )}

            {/* Parent span (spans only) */}
            {formData.type === "span" && formData.parent && (
              <div className="view-group">
                <label>Parent</label>
                <div className="view-separator" />
                <button
                  type="button"
                  className="parent-link"
                  onClick={() => onSelect(formData.parent)}
                >
                  {timelineData.elements.find(el => el.id === formData.parent)?.title || formData.parent}
                </button>
              </div>
            )}


            {/* Merge target (spans only) */}
            {formData.type === "span" && formData.mergeParent && (
              <div className="view-group">
                <label>Merge Into</label>
                <div className="view-separator" />
                <button
                  type="button"
                  className="parent-link"
                  onClick={() => onSelect(formData.mergeParent)}
                >
                  {timelineData.elements.find(el => el.id === formData.mergeParent)?.title || formData.mergeParent}
                </button>
              </div>
            )}

            {formData.type === "span" && formData.extendFrom && (
              <div className="view-group">
                <label>Extend From</label>
                <div className="view-separator" />
                <button
                  type="button"
                  className="parent-link"
                  onClick={() => onSelect(formData.extendFrom)}
                >
                  {timelineData.elements.find(el => el.id === formData.extendFrom)?.title || formData.extendFrom}
                </button>
              </div>
            )}

            {/* Tags */}
            {Array.isArray(formData.tags) && formData.tags.length > 0 && (
              <div className="view-group view-group-chips">
                <label>Tags</label>
                <div className="view-separator" />
                <div className="tag-chip-list">
                  {formData.tags.map((tag) => {
                    const isSelected = activeTags.includes(tag);
                    const tagColor = tagColors[tag];
                    return (
                      <button
                        key={tag}
                        type="button"
                        className={`tag-chip tag-chip-link${isSelected ? " is-selected" : ""}`}
                        onClick={() => {
                          if (onToggleTag) {
                            onToggleTag(tag);
                          } else {
                            onFilterByTag?.(tag);
                          }
                        }}
                      >
                        <span className="tag-chip-dot" style={{ background: tagColor || "var(--ui-muted)" }} />
                        {tag}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Group (events and spans only, view mode) */}
            {(formData.type === "event" || formData.type === "span") && (() => {
              const groups = timelineData?.file?.groups || [];
              const group = groups.find((g) => g.id === formData.groupId);
              return group ? (
                <div className="view-group">
                  <label>Group</label>
                  <div className="view-separator" />
                  <p>{group.title || group.id}</p>
                </div>
              ) : null;
            })()}

            {timelineData?.file?.useMaps && (formData.lat != null || formData.lng != null) && (
              <div className="view-group">
                <label>Coordinates</label>
                <div className="view-separator" />
                <p>{[formData.lat, formData.lng].filter((v) => v !== "" && v != null).join(", ")}</p>
              </div>
            )}

            {formData.noteFile && (
              <>
                <div className="note-divider" />
                <button type="button" className="rp-note-header sources-collapse-btn" onClick={() => setIsNoteCollapsed(v => !v)}>
                  <span className="rp-note-label rp-note-label-note">Note</span>
                  <span className="sources-collapse-right">
                    {noteWordCount > 0 && <span className="rp-note-meta">markdown · {noteWordCount} words</span>}
                    <ChevronDown size={14} style={{transform: isNoteCollapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.15s ease', color: 'var(--ui-muted)'}} />
                  </span>
                </button>
                {!isNoteCollapsed && (
                  <div
                    className="note-render"
                    ref={noteViewCallbackRef}
                    onClick={(e) => {
                      if (e.target.tagName !== "INPUT" || e.target.type !== "checkbox") return;
                      e.preventDefault();
                      const idx = parseInt(e.target.getAttribute("data-idx"), 10);
                      if (!isNaN(idx) && !readOnly) handleTaskToggle(idx);
                    }}
                  />
                )}
              </>
            )}

            <WikiSection
              key={`wiki-${selectedElement?.id}`}
              wikiUrl={formData.wikiUrl}
              useWiki={timelineData?.file?.useWiki}
              isEditMode={false}
              onUrlChange={handleWikiUrlChange}
            />

            <SourcesSection
              key={`sources-${selectedElement?.id}`}
              sources={formData.sources}
              sourceLink={formData.sourceLink}
              isEditMode={false}
              onSourcesChange={handleSourcesChange}
            />
          </div>
        ) : (
          /* Edit Mode */
          <form
            id="right-panel-edit-form"
            className="edit-form"
            onSubmit={(e) => e.preventDefault()}
          >
            {/* Validation Errors */}
            {validationErrors.length > 0 && (
              <div className="validation-errors">
                {validationErrors.map((error, idx) => (
                  <div key={idx} className="validation-error">
                    {error}
                  </div>
                ))}
              </div>
            )}

            <SectionHeader
              title="Details"
              isOpen={isDetailsOpen}
              onToggle={() => setIsDetailsOpen(v => !v)}
              summary={formData.title || ""}
            />

            {isDetailsOpen && <>

            {/* Title */}
            <div className="form-group">
              <div className="edit-row edit-row-title">
                <label htmlFor="title">Name</label>
                <div className="edit-separator" />
                <textarea
                  ref={titleTextareaRef}
                  id="title"
                  value={formData.title}
                  onChange={(e) => handleChange("title", e.target.value)}
                  onBlur={(e) => commitDraft({ ...formData, title: e.target.value })}
                  className="edit-input edit-input-multiline"
                  maxLength={200}
                  rows={1}
                />
              </div>
            </div>

            {formData.type === "span" && (
              <div className="form-group">
                <div className="edit-row">
                  <label htmlFor="description">Description</label>
                  <div className="edit-separator" />
                  <input
                    id="description"
                    type="text"
                    value={formData.description || ""}
                    onChange={(e) => handleChange("description", e.target.value)}
                    onBlur={(e) => commitDraft({ ...formData, description: e.target.value })}
                    className="edit-input"
                    maxLength={200}
                    placeholder="Short description..."
                  />
                </div>
              </div>
            )}

            {/* Date/Start/End based on type */}
            {formData.type === "event" ? (
              <div className="form-group">
                <div className="edit-row">
                  <label htmlFor="date">Date</label>
                  <div className="edit-separator" />
                  <div className={`edit-input-shell${showCalendarInputIcon ? " has-left-icon has-dynamic-icon" : ""}`}>
                    {showCalendarInputIcon && (
                      <>
                        <button
                          type="button"
                          className="edit-input-icon-button"
                          aria-label="Open calendar"
                          onClick={() => openCalendarPicker("date")}
                        >
                          <Calendar size={14} className="edit-input-icon" aria-hidden="true" />
                        </button>
                        <input
                          ref={(node) => {
                            if (node) datePickerRefs.current.date = node;
                            else delete datePickerRefs.current.date;
                          }}
                          type="date"
                          tabIndex={-1}
                          aria-hidden="true"
                          className="edit-input-native-date"
                          value={getPickerIsoValue(formData.dateInput, selectedElement?.date)}
                          min={calendarMinIso || undefined}
                          max={calendarMaxIso || undefined}
                          onChange={(e) => handleCalendarPick("dateInput", e.target.value)}
                        />
                      </>
                    )}
                    <input
                      id="date"
                      type="text"
                      inputMode="numeric"
                      value={formData.dateInput ?? ""}
                      onChange={(e) => {
                        handleChange("dateInput", e.target.value);
                      }}
                      onBlur={(e) => commitDraft({ ...formData, dateInput: e.target.value })}
                      className="edit-input"
                      maxLength={20}
                    />
                    {showCalendarInputIcon && renderDynamicDateButton("dateInput")}
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="form-group">
                  <div className="edit-row">
                    <label htmlFor="start">Start Date</label>
                    <div className="edit-separator" />
                  <div className={`edit-input-shell${showCalendarInputIcon ? " has-left-icon has-dynamic-icon" : ""}`}>
                    {showCalendarInputIcon && (
                      <>
                        <button
                          type="button"
                          className="edit-input-icon-button"
                          aria-label="Open calendar"
                          onClick={() => openCalendarPicker("start")}
                        >
                          <Calendar size={14} className="edit-input-icon" aria-hidden="true" />
                        </button>
                        <input
                          ref={(node) => {
                            if (node) datePickerRefs.current.start = node;
                            else delete datePickerRefs.current.start;
                          }}
                          type="date"
                          tabIndex={-1}
                          aria-hidden="true"
                          className="edit-input-native-date"
                          value={getPickerIsoValue(formData.startInput, selectedElement?.start)}
                          min={calendarMinIso || undefined}
                          max={calendarMaxIso || undefined}
                          onChange={(e) => handleCalendarPick("startInput", e.target.value)}
                        />
                      </>
                    )}
                    <input
                      id="start"
                      type="text"
                      inputMode="numeric"
                      value={formData.startInput ?? ""}
                      onChange={(e) => {
                        handleChange("startInput", e.target.value);
                      }}
                      onBlur={(e) => commitDraft({ ...formData, startInput: e.target.value })}
                      className="edit-input"
                      maxLength={20}
                    />
                    {showCalendarInputIcon && renderDynamicDateButton("startInput")}
                  </div>
                  </div>
                </div>
                <div className="form-group">
                  <div className="edit-row">
                    <label htmlFor="end">End Date</label>
                    <div className="edit-separator" />
                  <div className={`edit-input-shell${showCalendarInputIcon ? " has-left-icon has-dynamic-icon" : ""}`}>
                    {showCalendarInputIcon && (
                      <>
                        <button
                          type="button"
                          className="edit-input-icon-button"
                          aria-label="Open calendar"
                          onClick={() => openCalendarPicker("end")}
                        >
                          <Calendar size={14} className="edit-input-icon" aria-hidden="true" />
                        </button>
                        <input
                          ref={(node) => {
                            if (node) datePickerRefs.current.end = node;
                            else delete datePickerRefs.current.end;
                          }}
                          type="date"
                          tabIndex={-1}
                          aria-hidden="true"
                          className="edit-input-native-date"
                          value={getPickerIsoValue(formData.endInput, selectedElement?.end)}
                          min={calendarMinIso || undefined}
                          max={calendarMaxIso || undefined}
                          onChange={(e) => handleCalendarPick("endInput", e.target.value)}
                        />
                      </>
                    )}
                    <input
                      id="end"
                      type="text"
                      inputMode="numeric"
                      value={formData.endInput ?? ""}
                      onChange={(e) => {
                        handleChange("endInput", e.target.value);
                      }}
                      onBlur={(e) => commitDraft({ ...formData, endInput: e.target.value })}
                      className="edit-input"
                      maxLength={20}
                    />
                    {showCalendarInputIcon && renderDynamicDateButton("endInput")}
                  </div>
                  </div>
                </div>
              </>
            )}

            {/* Relations */}
            {(formData.type === "event" || formData.type === "span") && (
              <>
            {/* Parent (events only) */}
            {formData.type === "event" && (
              <div className="form-group">
                <div className="edit-row">
                  <label htmlFor="parents">Parent</label>
                  <div className="edit-separator" />
                  <div className="span-relation-wrap">
                    {formData.parents?.[0] ? (
                      <div className="relation-selected-list">
                        <div className="relation-selected-item">
                          <button type="button" className="relation-selected-link" onClick={() => onSelect(formData.parents[0])}>
                            {timelineData.elements.find((el) => el.id === formData.parents[0])?.title || formData.parents[0]}
                          </button>
                          <button type="button" className="relation-selected-remove" onClick={() => { const next = { ...formData, parents: [] }; setFormData(next); commitDraft(next); setParentQuery(""); }}>×</button>
                        </div>
                      </div>
                    ) : (
                      <div className="branch-picker">
                        <input
                          id="parents" type="text" value={parentQuery}
                          onChange={(e) => { setParentQuery(e.target.value); setIsParentMenuOpen(true); }}
                          onFocus={() => setIsParentMenuOpen(true)}
                          onBlur={handleParentBlur}
                          placeholder="Search span..." className="edit-input branch-input"
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const choice = parentSuggestions[0]; if (choice) { const next = { ...formData, parents: [choice.id], groupId: choice.groupId ?? formData.groupId }; setFormData(next); commitDraft(next); setParentQuery(""); setIsParentMenuOpen(false); } } }}
                        />
                        {isParentMenuOpen && (
                          <div className="branch-suggestions">
                            {parentSuggestions.length > 0 ? parentSuggestions.map((span) => (
                              <button key={span.id} type="button" className="branch-suggestion-item" onMouseDown={(e) => { e.preventDefault(); const next = { ...formData, parents: [span.id], groupId: span.groupId ?? formData.groupId }; setFormData(next); commitDraft(next); setParentQuery(""); setIsParentMenuOpen(false); }}>
                                <span className="branch-suggestion-title">{span.title || span.id}</span>
                              </button>
                            )) : <div className="branch-suggestion-empty">No matching spans</div>}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Parent span (spans only) */}
            {formData.type === "span" && (
              <div className="form-group">
                <div className="edit-row">
                  <label htmlFor="spanParent">Parent</label>
                  <div className="edit-separator" />
                  <div className="span-relation-wrap">
                    <div className="span-relation-dropdown">
                      <button
                        type="button"
                        className="span-relation-dropdown-btn"
                        onClick={() => setIsSpanRelationOpen((v) => !v)}
                      >
                        {spanRelationType === "branch" ? "Branch from" : "Extend from"}
                        <ChevronDown size={10} />
                      </button>
                      {isSpanRelationOpen && (
                        <div className="span-relation-dropdown-menu">
                          <button
                            type="button"
                            className={`span-relation-dropdown-item${spanRelationType === "branch" ? " active" : ""}`}
                            onMouseDown={() => {
                              if (spanRelationType === "extend" && formData.extendFrom) {
                                const { extendFrom: _e, ...base } = formData;
                                const next = { ...base, parent: formData.extendFrom };
                                setFormData(next);
                                commitDraft(next);
                              }
                              setSpanRelationType("branch");
                              setIsSpanRelationOpen(false);
                              setSpanParentQuery("");
                            }}
                          >Branch from</button>
                          <button
                            type="button"
                            className={`span-relation-dropdown-item${spanRelationType === "extend" ? " active" : ""}${!extendEnabled ? " disabled" : ""}`}
                            disabled={!extendEnabled}
                            onMouseDown={() => {
                              if (!extendEnabled) return;
                              if (spanRelationType === "branch" && formData.parent) {
                                const { parent: _p, ...base } = formData;
                                const next = { ...base, extendFrom: formData.parent };
                                setFormData(next);
                                commitDraft(next);
                              }
                              setSpanRelationType("extend");
                              setIsSpanRelationOpen(false);
                              setSpanParentQuery("");
                            }}
                          >Extend from</button>
                        </div>
                      )}
                    </div>
                    {(formData.parent || formData.extendFrom) ? (
                      <div className="relation-selected-list">
                        <div className="relation-selected-item">
                          <button type="button" className="relation-selected-link" onClick={() => onSelect(formData.parent || formData.extendFrom)}>
                            {(() => { const id = formData.parent || formData.extendFrom; return timelineData.elements.find((el) => el.id === id)?.title || id; })()}
                          </button>
                          <button type="button" className="relation-selected-remove" onClick={() => { clearSpanParent(); clearExtendFrom(); }}>×</button>
                        </div>
                      </div>
                    ) : (
                      <div className="branch-picker">
                        <input
                          id="spanParent" type="text" value={spanParentQuery}
                          onChange={(e) => { setSpanParentQuery(e.target.value); setIsSpanParentMenuOpen(true); }}
                          onFocus={() => setIsSpanParentMenuOpen(true)}
                          onBlur={handleSpanParentBlur}
                          placeholder="Search span..." className="edit-input branch-input" maxLength={ID_MAX_LENGTH}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const suggestions = spanRelationType === "branch" ? spanParentSuggestions : extendFromSuggestions; if (suggestions.length > 0) { if (spanRelationType === "branch") setSpanParent(suggestions[0].id); else setExtendFrom(suggestions[0].id); } } }}
                        />
                        {isSpanParentMenuOpen && spanParentQuery.trim().length > 0 && (() => {
                          const suggestions = spanRelationType === "branch" ? spanParentSuggestions : extendFromSuggestions;
                          const emptyMsg = spanRelationType === "branch" ? "No matching spans" : "No contiguous spans";
                          return (
                            <div className="branch-suggestions">
                              {suggestions.length > 0 ? suggestions.map((span) => (
                                <button key={span.id} type="button" className="branch-suggestion-item" onMouseDown={(e) => { e.preventDefault(); if (spanRelationType === "branch") setSpanParent(span.id); else setExtendFrom(span.id); }}>
                                  <span className="branch-suggestion-title">{span.title || span.id}</span>
                                </button>
                              )) : <div className="branch-suggestion-empty">{emptyMsg}</div>}
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {formData.type === "span" && (
              <div className="form-group">
                <div className="edit-row">
                  <label htmlFor="mergeParent">Merge Into</label>
                  <div className="edit-separator" />
                  <div className="span-relation-wrap"><div className="branch-picker">
                    {formData.mergeParent ? (
                      <div className="relation-selected-list">
                        <div className="relation-selected-item">
                          <button type="button" className="relation-selected-link" onClick={() => onSelect(formData.mergeParent)}>
                            {timelineData.elements.find((el) => el.id === formData.mergeParent)?.title || formData.mergeParent}
                          </button>
                          <button type="button" className="relation-selected-remove" onClick={clearMergeParent}>×</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <input
                          id="mergeParent" type="text" value={mergeParentQuery}
                          onChange={(e) => { setMergeParentQuery(e.target.value); setIsMergeParentMenuOpen(true); }}
                          onFocus={() => setIsMergeParentMenuOpen(true)}
                          onBlur={handleMergeParentBlur}
                          placeholder="Search span..." className="edit-input branch-input" maxLength={ID_MAX_LENGTH}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (mergeParentSuggestions.length > 0) setMergeParent(mergeParentSuggestions[0].id); } }}
                        />
                        {isMergeParentMenuOpen && mergeParentQuery.trim().length > 0 && (
                          <div className="branch-suggestions">
                            {mergeParentSuggestions.length > 0 ? mergeParentSuggestions.map((span) => (
                              <button key={span.id} type="button" className="branch-suggestion-item" onMouseDown={(e) => { e.preventDefault(); setMergeParent(span.id); }}>
                                <span className="branch-suggestion-title">{span.title || span.id}</span>
                              </button>
                            )) : <div className="branch-suggestion-empty">No matching spans</div>}
                          </div>
                        )}
                      </>
                    )}
                  </div></div>
                </div>
              </div>
            )}

            </>)}

            {/* Tags */}
            <div className="form-group">
              <div className="edit-row edit-row-tags">
                <label htmlFor="tags">Tags</label>
                <div className="tag-edit-flow">
                  {Array.isArray(formData.tags) && formData.tags.map((tag) => (
                    <div key={tag} className="tag-edit-chip">
                      <span>{tag}</span>
                      <button
                        type="button"
                        className="tag-edit-remove"
                        onClick={() => removeTag(tag)}
                        aria-label={`Remove ${tag}`}
                      >×</button>
                    </div>
                  ))}
                  <div className="branch-picker tag-picker tag-edit-picker">
                    {!isTagMenuOpen && (
                      <button type="button" className="tag-add-chip" onClick={() => { setIsTagMenuOpen(true); document.getElementById('tags')?.focus(); }}>
                        + Add tag
                      </button>
                    )}
                    <input
                      id="tags"
                      type="text"
                      value={tagQuery}
                      onChange={(e) => {
                        setTagQuery(e.target.value);
                        setIsTagMenuOpen(true);
                        if (validationErrors.length) setValidationErrors([]);
                      }}
                      onFocus={() => { clearTimeout(tagMenuTimeoutRef.current); setIsTagMenuOpen(true); }}
                      onBlur={handleTagBlur}
                      placeholder="add tag..."
                      className="tag-edit-input"
                      style={{display: isTagMenuOpen ? 'block' : 'none'}}
                      maxLength={TAG_MAX_LENGTH}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          const trimmed = tagQuery.trim();
                          if (trimmed) addTag(trimmed);
                        }
                      }}
                    />
                    {isTagMenuOpen && tagSuggestions.length > 0 && (
                      <div className="branch-suggestions">
                        {tagSuggestions.map((tag) => (
                          <button
                            key={tag}
                            type="button"
                            className="branch-suggestion-item"
                            onMouseDown={(e) => {
                              e.preventDefault();
                              addTag(tag);
                            }}
                          >
                            <span className="branch-suggestion-title">{tag}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Group (events and spans only) */}
            {(formData.type === "event" || formData.type === "span") && (() => {
              const groups = timelineData?.file?.groups || [];
              return (
                <div className="form-group">
                  <div className="edit-row">
                    <label htmlFor="groupId">Group</label>
                    <div className="edit-separator" />
                    <div className="edit-select-wrap">
                      <select
                        id="groupId"
                        className="edit-select"
                        value={formData.groupId ?? ""}
                        onChange={(e) => {
                          const val = e.target.value || null;
                          const next = { ...formData, groupId: val };
                          setFormData(next);
                          commitDraft(next);
                        }}
                      >
                        <option value="">Inherit</option>
                        {groups.map((g) => (
                          <option key={g.id} value={g.id}>{g.title || g.id}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Map */}
            {timelineData?.file?.useMaps && (
              <div className="form-group">
                <div className="edit-row">
                  <label>Coordinates</label>
                  <div className="edit-separator" />
                  <div className="coord-inputs">
                    <input
                      id="lat"
                      type="number"
                      className="edit-input"
                      value={formData.lat ?? ""}
                      onChange={(e) => handleChange("lat", e.target.value === "" ? null : Number(e.target.value))}
                      onBlur={(e) => commitDraft({ ...formData, lat: e.target.value === "" ? null : Number(e.target.value) })}
                      placeholder="lat"
                      step="any"
                    />
                    <span className="coord-sep">,</span>
                    <input
                      id="lng"
                      type="number"
                      className="edit-input"
                      value={formData.lng ?? ""}
                      onChange={(e) => handleChange("lng", e.target.value === "" ? null : Number(e.target.value))}
                      onBlur={(e) => commitDraft({ ...formData, lng: e.target.value === "" ? null : Number(e.target.value) })}
                      placeholder="lng"
                      step="any"
                    />
                  </div>
                </div>
              </div>
            )}

            </>}

            <SectionHeader
              title="Display"
              isOpen={isDisplayOpen}
              onToggle={() => setIsDisplayOpen(v => !v)}
              summary={[
                formData.thumbnail && "Image",
                formData.icon && "Icon",
                (formData.color || formData.spanSize || formData.eraSize || formData.eventLineStyle || formData.eventBorderStyle || formData.hideYears || formData.hideDetails || formData.fuzzyStart || formData.fuzzyEnd) && "Styles",
              ].filter(Boolean).join(" · ") || "No display set"}
            />

            {isDisplayOpen && <>

            {/* Color (events) — default / inherited from parent span / custom override */}
            {formData.type === "event" && (() => {
              const inheritedColor = eventParentSpan?.color;
              const isCustom = !!formData.color;
              const effectiveBase = inheritedColor || resolvedDefaultBorderColor;
              const swatchColor = formData.color || effectiveBase;
              return (
                <div className="form-group">
                  <div className="edit-row">
                    <label>color</label>
                    <div className="edit-separator" />
                    <div className="event-color-wrap">
                      {isCustom ? (
                        <button
                          type="button"
                          className="event-color-revert"
                          title="Revert to inherited"
                          onClick={() => {
                            const next = { ...formData };
                            delete next.color;
                            setFormData(next);
                            commitDraft(next);
                          }}
                        ><RotateCcw size={11} /></button>
                      ) : (
                        <Link size={11} className="event-color-chain" />
                      )}
                      <ColorPicker
                        className="edit-color-picker"
                        value={swatchColor}
                        ariaLabel="Pick event color"
                        onChange={(hex) => {
                          if (hex === effectiveBase) return;
                          const next = { ...formData, color: hex };
                          setFormData(next);
                          commitDraft(next);
                        }}
                      />
                      {isCustom ? (
                        <span className="event-color-text">
                          <span className="event-color-status">Custom</span>
                          <span className="event-color-hex">{formData.color}</span>
                        </span>
                      ) : inheritedColor ? (
                        <span className="event-color-text">
                          <span className="event-color-status">Inherited</span>
                        </span>
                      ) : (
                        <span className="event-color-text">
                          <span className="event-color-status">Default</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Color (spans and eras only) */}
            {formData.type !== "event" && (
              <div className="form-group">
                <div className="edit-row">
                  <label htmlFor="color">Color</label>
                  <div className="edit-separator" />
                  <div className="edit-color-wrap">
                    <ColorPicker
                      id="color"
                      value={formData.color}
                      onChange={(hex) => {
                        handleChange("color", hex);
                        commitDraft({ ...formData, color: hex });
                      }}
                      className="edit-color-picker"
                      ariaLabel="Pick color"
                    />
                    <input
                      type="text"
                      value={formData.color}
                      onChange={(e) => handleChange("color", e.target.value)}
                      onBlur={(e) => {
                        const normalized = normalizeColor(e.target.value);
                        handleChange("color", normalized);
                        commitDraft({ ...formData, color: normalized });
                      }}
                      className="edit-color-text"
                      maxLength={7}
                      placeholder="#000000"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Size (spans only) */}
            {formData.type === "span" && (
              <div className="form-group">
                <div className="edit-row">
                  <label htmlFor="spanSize">Size</label>
                  <div className="edit-separator" />
                  <div className="edit-select-wrap">
                    <select
                      id="spanSize"
                      className="edit-select"
                      value={formData.spanSize || "normal"}
                      onChange={(e) => {
                        const val = e.target.value === "normal" ? undefined : e.target.value;
                        const next = { ...formData };
                        if (val) {
                          next.spanSize = val;
                        } else {
                          delete next.spanSize;
                        }
                        setFormData(next);
                        commitDraft(next);
                      }}
                    >
                      <option value="thin">Thin</option>
                      <option value="normal">Normal</option>
                      <option value="thick">Thick</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {formData.type === "span" && (
              <>
                <div className="form-group">
                  <div className="edit-row">
                    <label htmlFor="hideSpanDetails">Hide Details</label>
                    <div className="edit-separator" />
                    <label className="settings-toggle" style={{gridColumn: 2, justifySelf: 'end'}}>
                      <input
                        id="hideSpanDetails"
                        type="checkbox"
                        checked={formData.hideDetails === true || (formData.hideName === true && formData.hideYears === true)}
                        onChange={(e) => {
                          const next = { ...formData, hideDetails: e.target.checked };
                          delete next.hideName;
                          delete next.hideYears;
                          setFormData(next);
                          commitDraft(next);
                        }}
                      />
                      <span className="settings-toggle-slider" />
                    </label>
                  </div>
                </div>
                <div className="form-group">
                  <div className="edit-row">
                    <label htmlFor="hideSpanYears">Hide Date</label>
                    <div className="edit-separator" />
                    <label className="settings-toggle" style={{gridColumn: 2, justifySelf: 'end'}}>
                      <input
                        id="hideSpanYears"
                        type="checkbox"
                        checked={formData.hideYears === true}
                        onChange={(e) => {
                          const next = { ...formData };
                          if (e.target.checked) { next.hideYears = true; } else { delete next.hideYears; }
                          setFormData(next);
                          commitDraft(next);
                        }}
                      />
                      <span className="settings-toggle-slider" />
                    </label>
                  </div>
                </div>
              </>
            )}

            {formData.type === "era" && (
              <>
                <div className="form-group">
                  <div className="edit-row">
                    <label htmlFor="eraSize">Size</label>
                    <div className="edit-separator" />
                    <div className="edit-select-wrap">
                      <select
                        id="eraSize"
                        className="edit-select"
                        value={formData.eraSize || "normal"}
                        onChange={(e) => {
                          const val = e.target.value === "normal" ? undefined : e.target.value;
                          const next = { ...formData };
                          if (val) {
                            next.eraSize = val;
                          } else {
                            delete next.eraSize;
                          }
                          setFormData(next);
                          commitDraft(next);
                        }}
                      >
                        <option value="normal">Normal</option>
                        <option value="thick">Thick</option>
                        <option value="extra-thick">Extra Thick</option>
                      </select>
                    </div>
                  </div>
                </div>
                <div className="form-group">
                  <div className="edit-row">
                    <label htmlFor="hideEraDetails">Hide Details</label>
                    <div className="edit-separator" />
                    <label className="settings-toggle" style={{gridColumn: 2, justifySelf: 'end'}}>
                      <input
                        id="hideEraDetails"
                        type="checkbox"
                        checked={formData.hideDetails === true}
                        onChange={(e) => {
                          const next = { ...formData };
                          if (e.target.checked) { next.hideDetails = true; } else { delete next.hideDetails; }
                          setFormData(next);
                          commitDraft(next);
                        }}
                      />
                      <span className="settings-toggle-slider" />
                    </label>
                  </div>
                </div>
                <div className="form-group">
                  <div className="edit-row">
                    <label htmlFor="fuzzyStart">Fuzzy Start</label>
                    <div className="edit-separator" />
                    <label className="settings-toggle" style={{gridColumn: 2, justifySelf: 'end'}}>
                      <input
                        id="fuzzyStart"
                        type="checkbox"
                        checked={formData.fuzzyStart === true}
                        onChange={(e) => {
                          const next = { ...formData };
                          if (e.target.checked) { next.fuzzyStart = true; } else { delete next.fuzzyStart; }
                          setFormData(next);
                          commitDraft(next);
                        }}
                      />
                      <span className="settings-toggle-slider" />
                    </label>
                  </div>
                </div>
                <div className="form-group">
                  <div className="edit-row">
                    <label htmlFor="fuzzyEnd">Fuzzy End</label>
                    <div className="edit-separator" />
                    <label className="settings-toggle" style={{gridColumn: 2, justifySelf: 'end'}}>
                      <input
                        id="fuzzyEnd"
                        type="checkbox"
                        checked={formData.fuzzyEnd === true}
                        onChange={(e) => {
                          const next = { ...formData };
                          if (e.target.checked) { next.fuzzyEnd = true; } else { delete next.fuzzyEnd; }
                          setFormData(next);
                          commitDraft(next);
                        }}
                      />
                      <span className="settings-toggle-slider" />
                    </label>
                  </div>
                </div>
              </>
            )}

            {formData.type === "event" && (
              <>
              <div className="thumbnail-full-header">
                <span className="thumbnail-full-label">thumbnail</span>
                {formData.thumbnail && <span className="thumbnail-full-meta">
                  {(() => {
                    try {
                      const decoded = decodeURIComponent(formData.thumbnail);
                      const parts = decoded.split(/[/\\]/);
                      return parts[parts.length - 1] || 'image';
                    } catch {
                      return formData.thumbnail.split('/').pop()?.split('?')[0] ?? 'image';
                    }
                  })()}
                  {thumbnailMeta && ` · ${thumbnailMeta.width}×${thumbnailMeta.height}`}
                </span>}
              </div>
              {formData.thumbnail && <div className="thumbnail-full-card">
                <img
                  key={formData.thumbnail}
                  className="thumbnail-full-img"
                  src={formData.thumbnail}
                  alt=""
                  onLoad={(e) => {
                    let ext = '';
                    try {
                      const decoded = decodeURIComponent(formData.thumbnail);
                      ext = decoded.split(/[/\\]/).pop()?.split('.').pop()?.toLowerCase() ?? '';
                    } catch {
                      ext = formData.thumbnail.split('.').pop()?.split('?')[0]?.toLowerCase() ?? '';
                    }
                    setThumbnailMeta({ width: e.target.naturalWidth, height: e.target.naturalHeight, ext });
                  }}
                />
                <div className="thumbnail-full-topbar">
                  <div className="thumbnail-full-actions">
                    <button
                      type="button"
                      className="thumbnail-full-action-btn"
                      title="Replace"
                      onClick={async () => {
                        const url = await handlePickThumbnail();
                        if (!url) return;
                        const next = { ...formData, thumbnail: url };
                        setFormData(next);
                        commitDraft(next);
                      }}
                    ><ImagePlus size={13} /></button>
                    <button
                      type="button"
                      className="thumbnail-full-action-btn"
                      title="Remove"
                      onClick={() => {
                        const next = { ...formData };
                        delete next.thumbnail;
                        setFormData(next);
                        commitDraft(next);
                      }}
                    ><Trash2 size={13} /></button>
                  </div>
                </div>
                <div className="thumbnail-full-bottombar">
                  <div className="thumbnail-style-btn">
                    <span className="thumbnail-style-label">
                      {formData.thumbnailStyle === 'banner' ? 'Top banner' :
                       formData.thumbnailStyle === 'square-fill' ? 'Square fill' :
                       formData.thumbnailStyle === 'circle-fill' ? 'Circle fill' : 'Left strip'}
                    </span>
                    <ChevronDown size={9} />
                    <select
                      className="thumbnail-style-select"
                      value={formData.thumbnailStyle ?? "strip"}
                      onChange={(e) => {
                        const next = { ...formData, thumbnailStyle: e.target.value };
                        setFormData(next);
                        commitDraft(next);
                      }}
                    >
                      <option value="strip">Left strip</option>
                      <option value="banner">Top banner</option>
                      <option value="square-fill">Square fill</option>
                      <option value="circle-fill">Circle fill</option>
                    </select>
                  </div>
                  <div className="thumbnail-fit-seg" role="group" aria-label="Thumbnail fit">
                    {[{ value: "cover", label: "Fill" }, { value: "contain", label: "Fit" }].map(({ value, label }) => (
                      <button
                        key={value}
                        type="button"
                        className={`thumbnail-fit-seg-btn${(formData.thumbnailFit ?? "cover") === value ? " is-active" : ""}`}
                        onClick={() => { const next = { ...formData, thumbnailFit: value }; setFormData(next); commitDraft(next); }}
                      >{label}</button>
                    ))}
                  </div>
                </div>
              </div>}
              {!formData.thumbnail && (
                <div className="thumbnail-dropzone-wrap">
                  <button
                    type="button"
                    className={`thumbnail-dropzone${isDragOver ? " is-drag-over" : ""}`}
                    onClick={async () => {
                      setIsThumbnailUrlMode(false);
                      setThumbnailUrlInput("");
                      const url = await handlePickThumbnail();
                      if (!url) return;
                      const next = { ...formData, thumbnail: url };
                      setFormData(next);
                      commitDraft(next);
                    }}
                    onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                    onDragLeave={() => setIsDragOver(false)}
                    onDrop={async (e) => {
                      e.preventDefault();
                      setIsDragOver(false);
                      const file = e.dataTransfer.files[0];
                      if (!file) return;
                      const ext = file.name.split('.').pop().toLowerCase();
                      if (!['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'].includes(ext)) return;
                      const filePath = window.electron?.getPathForFile?.(file) ?? file.path;
                      const url = await handleDropThumbnail(filePath);
                      if (!url) return;
                      const next = { ...formData, thumbnail: url };
                      setFormData(next);
                      commitDraft(next);
                    }}
                  >
                    <ImagePlus size={28} strokeWidth={1.5} className="thumbnail-dropzone-icon" />
                    <span className="thumbnail-dropzone-title">Drop image or click to upload</span>
                    <span className="thumbnail-dropzone-subtitle">PNG · JPG · SVG · up to 10 MB</span>
                  </button>
                  <button
                    type="button"
                    className={`thumbnail-url-icon-btn${isThumbnailUrlMode ? " is-active" : ""}`}
                    title="Paste image URL"
                    onClick={() => { setIsThumbnailUrlMode(v => !v); setThumbnailUrlInput(""); }}
                  >
                    <Link size={12} />
                  </button>
                  {isThumbnailUrlMode && (
                    <div className="thumbnail-url-row">
                      <input
                        type="url"
                        className="thumbnail-url-input"
                        placeholder="https://..."
                        value={thumbnailUrlInput}
                        autoFocus
                        onChange={(e) => setThumbnailUrlInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') { setIsThumbnailUrlMode(false); setThumbnailUrlInput(""); return; }
                          if (e.key === 'Enter') {
                            const trimmed = thumbnailUrlInput.trim();
                            if (!trimmed.startsWith('https://')) return;
                            const next = { ...formData, thumbnail: trimmed };
                            setFormData(next);
                            commitDraft(next);
                            setIsThumbnailUrlMode(false);
                            setThumbnailUrlInput("");
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="thumbnail-url-add"
                        onClick={() => {
                          const trimmed = thumbnailUrlInput.trim();
                          if (!trimmed.startsWith('https://')) return;
                          const next = { ...formData, thumbnail: trimmed };
                          setFormData(next);
                          commitDraft(next);
                          setIsThumbnailUrlMode(false);
                          setThumbnailUrlInput("");
                        }}
                      >Add</button>
                    </div>
                  )}
                </div>
              )}
              </>
            )}

            {/* Icon */}
            <div className="form-group">
              <div className="edit-row">
                <label>Icon</label>
                <div className="edit-separator" />
                <IconPicker
                  key={`icon-${selectedElement?.id}`}
                  value={formData.icon ?? null}
                  onChange={(name) => {
                    const next = { ...formData };
                    if (name) next.icon = name;
                    else delete next.icon;
                    setFormData(next);
                    commitDraft(next);
                  }}
                />
              </div>
            </div>

            {/* Event styling (events only) */}
            {formData.type === "event" && (
              <>
                <div className="form-group">
                  <div className="edit-row">
                    <label>Line Style</label>
                    <div className="edit-separator" />
                    {renderEventStrokeStyleControl("eventLineStyle", formData.eventLineStyle, "Event line style", "line")}
                  </div>
                </div>
                <div className="form-group">
                  <div className="edit-row">
                    <label>Border Style</label>
                    <div className="edit-separator" />
                    {renderEventStrokeStyleControl("eventBorderStyle", formData.eventBorderStyle, "Event border style", "border")}
                  </div>
                </div>
                <div className="form-group">
                  <div className="edit-row">
                    <label htmlFor="hideEventYears">Hide Date</label>
                    <div className="edit-separator" />
                    <label className="settings-toggle" style={{gridColumn: 2, justifySelf: 'end'}}>
                      <input
                        id="hideEventYears"
                        type="checkbox"
                        checked={formData.hideYears === true}
                        onChange={(e) => {
                          const next = { ...formData };
                          if (e.target.checked) { next.hideYears = true; } else { delete next.hideYears; }
                          setFormData(next);
                          commitDraft(next);
                        }}
                      />
                      <span className="settings-toggle-slider" />
                    </label>
                  </div>
                </div>
              </>
            )}

            {/* Breaks */}

            {showLegacyBreaks && formData.type === "span" && (
                <div className="breaks-list">
                  {Array.isArray(formData.breaks) && formData.breaks.length > 0 && (
                    formData.breaks
                      .map((brk, idx) => ({ ...brk, _idx: idx }))
                      .sort((a, b) => (a.year ?? 0) - (b.year ?? 0))
                      .map((brk) => {
                        const idx = brk._idx;
                        return (
                          <div key={idx} className="break-item">
                            <div className="break-item-header">
                              <span className="break-item-label">Break {formData.breaks
                                .map((b, i) => ({ ...b, _i: i }))
                                .sort((a, b) => (a.year ?? 0) - (b.year ?? 0))
                                .findIndex((b) => b._i === idx) + 1}</span>
                              <button
                                type="button"
                                className="break-remove"
                                onClick={() => {
                                  const nextBreaks = formData.breaks.filter((_, i) => i !== idx);
                                  handleChange("breaks", nextBreaks);
                                  commitDraft({ ...formData, breaks: nextBreaks });
                                }}
                                aria-label="Remove break"
                              >
                                ×
                              </button>
                            </div>
                            <div className="break-field">
                              <label>date</label>
                              <input
                                type="text"
                                inputMode="numeric"
                                value={brk.yearInput ?? String(brk.year ?? "")}
                                onChange={(e) => {
                                  const nextBreaks = [...formData.breaks];
                                  nextBreaks[idx] = { ...nextBreaks[idx], yearInput: e.target.value };
                                  handleChange("breaks", nextBreaks);
                                }}
                                onBlur={(e) => {
                                  const parsed = parseTimelineInput(e.target.value);
                                  if (parsed.value !== null) {
                                    const nextBreaks = [...formData.breaks];
                                    nextBreaks[idx] = { ...nextBreaks[idx], year: parsed.value, yearInput: undefined };
                                    handleChange("breaks", nextBreaks);
                                    commitDraft({ ...formData, breaks: nextBreaks });
                                  }
                                }}
                                maxLength={20}
                              />
                            </div>
                            <div className="break-field">
                              <label>label</label>
                              <input
                                type="text"
                                value={brk.label ?? ""}
                                onChange={(e) => {
                                  const nextBreaks = [...formData.breaks];
                                  nextBreaks[idx] = { ...nextBreaks[idx], label: e.target.value };
                                  handleChange("breaks", nextBreaks);
                                }}
                                onBlur={() => commitDraft(formData)}
                                maxLength={200}
                              />
                            </div>
                            <div className="break-field">
                              <label>color</label>
                              <div className="break-color-wrap">
                                <ColorPicker
                                  value={brk.color || formData.color || "#808080"}
                                  ariaLabel="Pick break color"
                                  onChange={(hex) => {
                                    const nextBreaks = [...formData.breaks];
                                    nextBreaks[idx] = { ...nextBreaks[idx], color: hex };
                                    handleChange("breaks", nextBreaks);
                                    commitDraft({ ...formData, breaks: nextBreaks.map((b, i) => i === idx ? { ...b, color: hex } : b) });
                                  }}
                                  className="edit-color-picker"
                                />
                                <input
                                  type="text"
                                  value={brk.color || ""}
                                  onChange={(e) => {
                                    const nextBreaks = [...formData.breaks];
                                    nextBreaks[idx] = { ...nextBreaks[idx], color: e.target.value };
                                    handleChange("breaks", nextBreaks);
                                  }}
                                  onBlur={(e) => {
                                    const normalized = normalizeColor(e.target.value);
                                    const nextBreaks = [...formData.breaks];
                                    nextBreaks[idx] = { ...nextBreaks[idx], color: normalized };
                                    handleChange("breaks", nextBreaks);
                                    commitDraft({ ...formData, breaks: nextBreaks.map((b, i) => i === idx ? { ...b, color: normalized } : b) });
                                  }}
                                  className="edit-color-text"
                                  maxLength={7}
                                  placeholder="#000000"
                                />
                              </div>
                            </div>
                            <div className="break-field">
                              <label>size</label>
                              <select
                                className="edit-select"
                                style={{ fontSize: "var(--text-xs)", padding: "3px 20px 3px 6px", minWidth: 0 }}
                                value={brk.size || ""}
                                onChange={(e) => {
                                  const nextBreaks = [...formData.breaks];
                                  const val = e.target.value;
                                  if (val) {
                                    nextBreaks[idx] = { ...nextBreaks[idx], size: val };
                                  } else {
                                    const { size: _, ...rest } = nextBreaks[idx];
                                    nextBreaks[idx] = rest;
                                  }
                                  handleChange("breaks", nextBreaks);
                                  commitDraft({ ...formData, breaks: nextBreaks });
                                }}
                              >
                                <option value="">Inherit</option>
                                <option value="thin">Thin</option>
                                <option value="normal">Normal</option>
                                <option value="thick">Thick</option>
                              </select>
                            </div>
                          </div>
                        );
                      })
                  )}
                  <button
                    type="button"
                    className="btn-add-break"
                    onClick={() => {
                      const existingBreaks = Array.isArray(formData.breaks) ? formData.breaks : [];
                      const allYears = [formData.start, ...existingBreaks.map((b) => b.year).filter((y) => y != null), formData.end];
                      allYears.sort((a, b) => a - b);
                      // Find the largest gap to place the new break
                      let maxGap = 0;
                      let gapStart = formData.start;
                      let gapEnd = formData.end;
                      for (let i = 0; i < allYears.length - 1; i++) {
                        const gap = allYears[i + 1] - allYears[i];
                        if (gap > maxGap) {
                          maxGap = gap;
                          gapStart = allYears[i];
                          gapEnd = allYears[i + 1];
                        }
                      }
                      const newYear = Math.round((gapStart + gapEnd) / 2);
                      const nextBreaks = [...existingBreaks, { year: newYear, label: "", color: formData.color || "#808080" }];
                      handleChange("breaks", nextBreaks);
                      commitDraft({ ...formData, breaks: nextBreaks });
                    }}
                  >
                    + Add Break
                  </button>
                </div>
            )}

            </>}

            <SectionHeader
              title="Notes & Sources"
              isOpen={isNotesOpen}
              onToggle={() => setIsNotesOpen(v => !v)}
              summary={(() => {
                const sourceCount = Array.isArray(formData.sources) ? formData.sources.length : 0;
                const parts = [
                  formData.noteFile && "Note",
                  formData.wikiUrl && "Wiki",
                  sourceCount > 0 && `${sourceCount} ${sourceCount === 1 ? "source" : "sources"}`,
                ].filter(Boolean);
                return parts.length > 0 ? parts.join(" · ") : "No note";
              })()}
            />

            {isNotesOpen && <div className="form-group note-form-group">
              {!formData.noteFile ? (
                <div className="note-add-actions">
                  <div className="note-add-dropdown-wrap">
                    <button type="button" className="note-create-card" onClick={() => setIsNoteAddOpen(v => !v)}>
                      <div className="note-create-card-icon"><FileText size={18} /></div>
                      <div className="note-create-card-text">
                        <span className="note-create-card-title">Add note</span>
                        <span className="note-create-card-subtitle">Attach a note to this event</span>
                      </div>
                    </button>
                    {isNoteAddOpen && (
                      <>
                        <div className="note-add-dropdown-backdrop" onClick={() => setIsNoteAddOpen(false)} />
                        <div className="note-add-dropdown">
                          <button type="button" className="note-add-dropdown-item" onClick={() => { setIsNoteAddOpen(false); handleAddNote(); }}>
                            Create Note
                          </button>
                          <button type="button" className="note-add-dropdown-item" onClick={() => { setIsNoteAddOpen(false); handleAddExistingNote(); }}>
                            Add Existing Note
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <div className="note-editor-card">
                  <div className="rp-note-header">
                    <span className="rp-note-label rp-note-label-note">Note</span>
                    {noteWordCount > 0 && (
                      <span className="rp-note-meta">markdown · {noteWordCount} words</span>
                    )}
                  </div>
                  <NoteEditor
                    ref={noteEditorRef}
                    key={`${selectedElement?.id}-${formData?.noteFile}`}
                    initialContent={noteInitialContent}
                    isNoteLoading={isNoteLoading}
                    noteExists={noteExists}
                    onSave={handleNoteSave}
                    onUnlink={handleUnlinkNote}
                    onDelete={handleDeleteNote}
                    onPickLocalImage={handlePickLocalImage}
                  />
                </div>
              )}
              <WikiSection
                key={`wiki-${selectedElement?.id}`}
                wikiUrl={formData.wikiUrl}
                useWiki={timelineData?.file?.useWiki}
                isEditMode={true}
                onUrlChange={handleWikiUrlChange}
              />
              <SourcesSection
                key={`sources-${selectedElement?.id}`}
                sources={formData.sources}
                sourceLink={formData.sourceLink}
                isEditMode={true}
                onSourcesChange={handleSourcesChange}
              />
            </div>}

          </form>
        )}
      </div>

      <div className="rp-action-bar">
          <div className="rp-action-group">
            <button
              className="rp-action-nav"
              type="button"
              disabled={!prevElement}
              onClick={onSelectPrevious}
              title={prevElement ? `Previous: ${prevElement.title}` : "No previous element"}
            >
              <ChevronLeft size={15} />
            </button>
            <button
              className="rp-action-nav"
              type="button"
              disabled={!nextElement}
              onClick={onSelectNext}
              title={nextElement ? `Next: ${nextElement.title}` : "No next element"}
            >
              <ChevronRight size={15} />
            </button>
          </div>
          {!readOnly && (
            <div className="rp-action-group">
              <button
                className="rp-action-edit"
                type="button"
                onClick={toggleEditMode}
              >
                <span>{isEditMode ? "Exit" : "Edit"}</span>
                <span className="rp-action-key">E</span>
              </button>
              <button
                className="rp-action-delete"
                type="button"
                onClick={() => onRequestDelete?.(formData.id)}
                title="Delete"
              >
                <Trash2 size={15} />
              </button>
            </div>
          )}
        </div>
    </div>
  );
}
