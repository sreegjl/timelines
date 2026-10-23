import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import { useTranslation } from "react-i18next";
import { Heading1, Heading2, Heading3, Bold, Italic, Strikethrough, Underline, Highlighter, Link2, Trash2, Unlink, ImagePlay, Paperclip } from "lucide-react";
import { getAppSettings, saveAppSettings } from "../utils/appSettings";

const openLink = (url) => {
  if (window.electron?.openExternal) window.electron.openExternal({ url });
  else window.open(url, "_blank", "noopener,noreferrer");
};

const NoteEditor = forwardRef(function NoteEditor(
  { initialContent, isNoteLoading, noteExists, onSave, onUnlink, onDelete, onPickLocalImage, resolveImageSrc, label, meta, subheader },
  ref
) {
  const { t } = useTranslation("timeline");
  const hostRef = useRef(null);
  const editorRef = useRef(null);
  const [mode, setMode] = useState(null); // "live" | "source", once the editor has loaded

  const contentRef = useRef(initialContent ?? "");
  const savedContentRef = useRef(initialContent ?? "");
  const saveTimerRef = useRef(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const resolveImageSrcRef = useRef(resolveImageSrc);
  resolveImageSrcRef.current = resolveImageSrc;

  const flushSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (contentRef.current === savedContentRef.current) return Promise.resolve();
    savedContentRef.current = contentRef.current;
    // hand back the promise so a rename can wait for the ink to dry
    return Promise.resolve(onSaveRef.current(contentRef.current));
  }, []);

  const placeholderText = isNoteLoading
    ? t("noteEditor.loading", "Loading note...")
    : t("noteEditor.placeholder", "Write your note...");
  const placeholderRef = useRef(placeholderText);
  placeholderRef.current = placeholderText;

  useEffect(() => {
    let cancelled = false;
    let editor = null;
    Promise.all([import("./noteEditor/createNoteEditor"), getAppSettings().catch(() => ({}))]).then(([module, settings]) => {
      if (cancelled || !hostRef.current) return;
      const initialMode = settings?.noteEditorMode === "source" ? "source" : "live";
      editor = module.createNoteEditor({
        parent: hostRef.current,
        doc: contentRef.current,
        mode: initialMode,
        placeholder: placeholderRef.current,
        // Debounced autosave for every edit path (typing and toolbar insertions)
        onChange: (text) => {
          contentRef.current = text;
          if (text === savedContentRef.current) return;
          if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
          saveTimerRef.current = setTimeout(flushSave, 2000);
        },
        onBlur: flushSave,
        resolveImageSrc: (src) => resolveImageSrcRef.current?.(src) ?? null,
        openLink,
      });
      editorRef.current = editor;
      setMode(initialMode);
    });
    return () => {
      cancelled = true;
      editor?.destroy();
      editorRef.current = null;
    };
  }, [flushSave]);

  useEffect(() => {
    editorRef.current?.setPlaceholder(placeholderText);
  }, [placeholderText, mode]);

  useEffect(() => {
    const next = initialContent ?? "";
    // A save echoes back through this prop; resetting on it would clobber keystrokes typed meanwhile
    if (next === savedContentRef.current) return;
    savedContentRef.current = next;
    contentRef.current = next;
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    editorRef.current?.setDoc(next);
  }, [initialContent]);

  useEffect(() => {
    window.addEventListener("beforeunload", flushSave);
    return () => {
      window.removeEventListener("beforeunload", flushSave);
      flushSave();
    };
  }, [flushSave]);

  useImperativeHandle(ref, () => ({
    save: flushSave,
  }), [flushSave]);

  const switchMode = (next) => {
    if (next === mode || !editorRef.current) return;
    editorRef.current.setMode(next);
    setMode(next);
    saveAppSettings({ noteEditorMode: next });
  };

  const run = (fn) => () => {
    if (editorRef.current) fn(editorRef.current);
  };

  const insertLink = run((editor) => {
    const label = editor.selectedText() || "link text";
    const token = `[${label}](https://)`;
    const urlStart = token.indexOf("https://");
    editor.insert(token, urlStart, urlStart + "https://".length);
  });

  const insertImage = run((editor) => {
    editor.insert("![](https://)", 4, 12);
  });

  const insertLocalImage = async () => {
    if (!onPickLocalImage) return;
    const relativePath = await onPickLocalImage();
    if (!relativePath || !editorRef.current) return;
    editorRef.current.insert(`![](${relativePath})`);
  };

  return (
    <div className="note-editor">
      <div className="rp-note-header">
        {label}
        <span className="note-editor-header-right">
          {meta && <span className="rp-note-meta">{meta}</span>}
            <div className="note-mode-toggle" role="group" aria-label={t("noteEditor.mode.label", "Editor mode")}>
              <button
                type="button"
                className={`note-mode-btn${mode === "live" ? " is-active" : ""}`}
                aria-pressed={mode === "live"}
                title={t("noteEditor.mode.liveHint", "Formatting shown as it renders; markdown appears where you're editing")}
                onClick={() => switchMode("live")}
              >{t("noteEditor.mode.live", "Live")}</button>
              <button
                type="button"
                className={`note-mode-btn${mode === "source" ? " is-active" : ""}`}
                aria-pressed={mode === "source"}
                title={t("noteEditor.mode.sourceHint", "Plain markdown")}
                onClick={() => switchMode("source")}
              >{t("noteEditor.mode.source", "Source")}</button>
            </div>
        </span>
      </div>
      {subheader}
      {/* mousedown would move focus off the editor and briefly re-hide the line being edited */}
      <div className="note-toolbar" onMouseDown={(e) => e.preventDefault()}>
        <div className="note-toolbar-format">
          <button type="button" onClick={run((e) => e.heading(1))} title={t("noteEditor.heading1", "Heading 1")}><Heading1 size={14} /></button>
          <button type="button" onClick={run((e) => e.heading(2))} title={t("noteEditor.heading2", "Heading 2")}><Heading2 size={14} /></button>
          <button type="button" onClick={run((e) => e.heading(3))} title={t("noteEditor.heading3", "Heading 3")}><Heading3 size={14} /></button>
          <div className="note-toolbar-divider" />
          <button type="button" onClick={run((e) => e.toggleWrap("**"))} title={t("noteEditor.bold", "Bold")}><Bold size={14} /></button>
          <button type="button" onClick={run((e) => e.toggleWrap("*"))} title={t("noteEditor.italic", "Italic")}><Italic size={14} /></button>
          <button type="button" onClick={run((e) => e.toggleWrap("~~"))} title={t("noteEditor.strikethrough", "Strikethrough")}><Strikethrough size={14} /></button>
          <button type="button" onClick={run((e) => e.toggleWrap("__"))} title={t("noteEditor.underline", "Underline")}><Underline size={14} /></button>
          <button type="button" onClick={run((e) => e.toggleWrap("=="))} title={t("noteEditor.highlight", "Highlight")}><Highlighter size={14} /></button>
          <div className="note-toolbar-divider" />
          <button type="button" onClick={insertLink} title={t("noteEditor.link", "Link")}><Link2 size={14} /></button>
          <button type="button" onClick={insertImage} title={t("noteEditor.embed", "Embed image or video")}><ImagePlay size={14} /></button>
          {onPickLocalImage && (
            <button type="button" onClick={insertLocalImage} title={t("noteEditor.insertLocalImage", "Insert local image")}><Paperclip size={14} /></button>
          )}
        </div>
        {noteExists && (
          <div className="note-toolbar-actions">
            <div className="note-toolbar-divider" />
            <button type="button" onClick={onUnlink} title={t("noteEditor.unlink", "Unlink Note")}><Unlink size={14} /></button>
            <button type="button" onClick={onDelete} title={t("noteEditor.delete", "Delete Note")}><Trash2 size={14} /></button>
          </div>
        )}
      </div>
      <div ref={hostRef} className={`note-cm${mode ? "" : " is-loading"}`} />
    </div>
  );
});

export default NoteEditor;
