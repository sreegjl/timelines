import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, BookOpen, FilePlus, Pencil } from "lucide-react";
// Lazy so the read-only web viewer never downloads the CodeMirror editor
const NoteEditor = lazy(() => import("./NoteEditor"));
import { readNote, writeNote, createNote } from "../utils/electronApi";
import { renderNoteMarkdown, resolveNoteImageSrc, splitFrontmatter } from "../utils/noteUtils";
import { resolvePackageAssetSrc } from "../utils/viewerPackageStore";
import { noteName } from "../utils/wikilinks";

// A note opened from a [[wikilink]], independent of any one element
export default function NotePage({
  entry,
  timelineId,
  noteRefFor,
  resolveNote,
  linkedElementsFor,
  onOpenNote,
  onReplaceEntry,
  onBack,
  onSelectElement,
  onNotesChanged,
  notesBaseUrl,
  notesBasePath,
  assetsBasePath,
  assetsTimelineDir,
  onPickLocalImage,
  headerActions,
  isMaximized = false,
  readOnly = false,
}) {
  const { t } = useTranslation("timeline");
  const notePath = entry.notePath || null;
  const title = notePath ? noteName(notePath) : entry.target;
  const noteRef = notePath ? noteRefFor(notePath) : null;
  const [content, setContent] = useState("");
  const [isLoading, setIsLoading] = useState(Boolean(notePath));
  const [exists, setExists] = useState(false);
  const [isEditing, setIsEditing] = useState(entry.edit === true);
  const [isCreating, setIsCreating] = useState(false);
  const editorRef = useRef(null);

  useEffect(() => {
    let isMounted = true;
    if (!noteRef) {
      setIsLoading(false);
      setExists(false);
      return undefined;
    }
    setIsLoading(true);
    readNote({ timelineId, filename: noteRef }).then((result) => {
      if (!isMounted) return;
      setIsLoading(false);
      setExists(Boolean(result?.success));
      setContent(result?.success ? result.content ?? "" : "");
    });
    return () => { isMounted = false; };
  }, [noteRef, timelineId]);

  const handleSave = useCallback(async (next) => {
    if (!noteRef || noteRef.includes("..")) return;
    const result = await writeNote({ timelineId, filename: noteRef, content: next });
    if (result?.success) setContent(next);
  }, [noteRef, timelineId]);

  const handleCreate = async () => {
    if (!entry.target || isCreating) return;
    setIsCreating(true);
    const result = await createNote({ timelineId, title: entry.target, name: entry.target });
    setIsCreating(false);
    if (!result?.success || !result.notePath) {
      console.error("Failed to create note:", result?.error);
      return;
    }
    await onNotesChanged?.();
    onReplaceEntry({ notePath: result.notePath });
    setIsEditing(true);
  };

  const toggleEditing = async () => {
    if (isEditing) await editorRef.current?.save();
    setIsEditing((v) => !v);
  };

  // Waits for the write so the element's inline editor re-reads the latest text
  const handleBack = async () => {
    await editorRef.current?.save();
    onBack();
  };

  const { rows: propertyRows } = useMemo(() => splitFrontmatter(content), [content]);
  const wordCount = useMemo(() => (content.trim() ? content.trim().split(/\s+/).length : 0), [content]);
  const linkedElements = notePath ? linkedElementsFor(notePath) : [];

  // Relative images resolve against the note's own folder
  const noteDir = notePath && notePath.includes("/") ? `${notePath.slice(0, notePath.lastIndexOf("/"))}/` : "";
  const baseUrl = notesBaseUrl ? `${notesBaseUrl}${noteDir}` : "";

  const resolveLink = useCallback((target) => resolveNote(target, notePath), [resolveNote, notePath]);
  const resolveImageSrc = useCallback(
    (src) => resolveNoteImageSrc(src, baseUrl, notesBasePath, assetsBasePath, assetsTimelineDir, resolvePackageAssetSrc),
    [baseUrl, notesBasePath, assetsBasePath, assetsTimelineDir]
  );

  const renderedHtml = useMemo(
    () => renderNoteMarkdown(content, isLoading, baseUrl, notesBasePath, assetsBasePath, assetsTimelineDir, resolvePackageAssetSrc, {
      resolveWikilink: resolveLink,
      omitFrontmatter: true,
    }),
    [content, isLoading, baseUrl, notesBasePath, assetsBasePath, assetsTimelineDir, resolveLink]
  );

  const renderCallbackRef = useCallback((node) => {
    if (node) node.innerHTML = renderedHtml;
  }, [renderedHtml]);

  const handleRenderClick = (e) => {
    const link = e.target.closest?.(".wikilink");
    if (link) {
      e.preventDefault();
      const path = link.getAttribute("data-note-path");
      onOpenNote(path ? { notePath: path } : { target: link.getAttribute("data-note-target") });
      return;
    }
    if (e.target.tagName !== "INPUT" || e.target.type !== "checkbox" || readOnly) return;
    e.preventDefault();
    const idx = parseInt(e.target.getAttribute("data-idx"), 10);
    if (Number.isNaN(idx)) return;
    let count = 0;
    const next = content.replace(/^(\s*[-*+] \[)([ x])(\])/gm, (match, pre, state, post) => (
      count++ === idx ? `${pre}${state === " " ? "x" : " "}${post}` : match
    ));
    setContent(next);
    handleSave(next);
  };

  return (
    <div className={`right-panel note-page${isMaximized ? " is-maximized" : ""}`}>
      <div className="right-panel-header">
        <button type="button" className="close-button" onClick={handleBack} title={t("notePage.back", "Back")}>
          <ArrowLeft size={18} />
        </button>
        <span className="rp-type-label note-page-name" title={title}>{title}</span>
        <div className="right-panel-actions">
          {!readOnly && exists && (
            <button
              type="button"
              className="close-button"
              onClick={toggleEditing}
              title={isEditing ? t("notePage.view", "View note") : t("notePage.edit", "Edit note")}
            >
              {isEditing ? <BookOpen size={18} /> : <Pencil size={18} />}
            </button>
          )}
          {headerActions}
        </div>
      </div>

      {isEditing ? (
        <div className="right-panel-content note-page-edit">
          {/* The whole panel is the note, so no card: toolbar on top, textarea filling the rest */}
          <Suspense fallback={<div className="note-textarea note-lp" />}>
            <NoteEditor
              ref={editorRef}
              key={notePath}
              initialContent={content}
              isNoteLoading={isLoading}
              noteExists={false}
              onSave={handleSave}
              onPickLocalImage={onPickLocalImage}
              resolveWikilink={resolveLink}
              resolveImageSrc={resolveImageSrc}
              onOpenWikilink={async ({ notePath: path, target }) => {
                await editorRef.current?.save();
                onOpenNote(path ? { notePath: path } : { target });
              }}
            />
          </Suspense>
        </div>
      ) : (
        <div className="right-panel-content">
          <div className="view-mode">
            <div className="view-group view-group-title">
              <label>{t("fields.name", "Name")}</label>
              <div className="view-separator" />
              <p>{title}</p>
            </div>

            {linkedElements.length > 0 && (
              <div className="view-group view-group-chips">
                <label>{t("notePage.linkedElements", "Linked elements")}</label>
                <div className="view-separator" />
                <div className="note-page-links">
                  {linkedElements.map((el) => (
                    <button key={el.id} type="button" className="parent-link" onClick={() => onSelectElement(el.id)}>
                      {el.title || el.id}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {propertyRows.map(([key, value]) => (
              <div key={key} className="view-group">
                <label>{key}</label>
                <div className="view-separator" />
                <p>{value}</p>
              </div>
            ))}

            <div className="note-divider" />
            {!isLoading && !exists ? (
              <div className="note-page-missing">
                <p>
                  {notePath
                    ? t("notePage.notFound", "This note couldn't be found. It may have been moved or deleted.")
                    : t("notePage.doesNotExist", "This note doesn't exist yet.")}
                </p>
                {!notePath && !readOnly && (
                  <button type="button" className="note-page-create" onClick={handleCreate} disabled={isCreating}>
                    <FilePlus size={14} />
                    <span>{t("notePage.create", "Create note")}</span>
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="rp-note-header">
                  <span className="rp-note-label rp-note-label-note">{t("noteEditor.label", "Note")}</span>
                  {wordCount > 0 && <span className="rp-note-meta">markdown · {wordCount} words</span>}
                </div>
                <div className="note-render" ref={renderCallbackRef} onClick={handleRenderClick} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
