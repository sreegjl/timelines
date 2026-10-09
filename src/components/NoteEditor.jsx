import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import { useTranslation } from "react-i18next";
import { Heading1, Heading2, Heading3, Bold, Italic, Strikethrough, Underline, Highlighter, Link2, Trash2, Unlink, ImagePlay, Paperclip } from "lucide-react";
import { EditorState, EditorSelection, Transaction } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { livePreview, refreshLivePreview } from "./noteLivePreview";

// Markdown note editor with Obsidian-style live preview; the saved file is always the plain text
const NoteEditor = forwardRef(function NoteEditor(
  { initialContent, isNoteLoading, noteExists, onSave, onUnlink, onDelete, onPickLocalImage, resolveWikilink, resolveImageSrc, onOpenWikilink },
  ref
) {
  const { t } = useTranslation("timeline");
  const [noteContent, setNoteContent] = useState(initialContent ?? "");
  const noteContentRef = useRef(noteContent);
  noteContentRef.current = noteContent;
  const savedContentRef = useRef(initialContent ?? "");
  const saveTimerRef = useRef(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const hostRef = useRef(null);
  const viewRef = useRef(null);
  const previewOptionsRef = useRef({});
  previewOptionsRef.current = { resolveWikilink, resolveImageSrc, onOpenWikilink };

  const flushSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (noteContentRef.current === savedContentRef.current) return Promise.resolve();
    savedContentRef.current = noteContentRef.current;
    // Returned so callers can wait for the write, e.g. before another view reads the file
    return Promise.resolve(onSaveRef.current(noteContentRef.current));
  }, []);

  const wrapSelection = useCallback((prefix, suffix = prefix) => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch(view.state.changeByRange((range) => ({
      changes: [{ from: range.from, insert: prefix }, { from: range.to, insert: suffix }],
      range: EditorSelection.range(range.from + prefix.length, range.to + prefix.length),
    })));
    view.focus();
  }, []);

  // Mounted once; content from outside is pushed in by the effect below
  useEffect(() => {
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: noteContentRef.current,
        extensions: [
          history(),
          keymap.of([
            { key: "Mod-b", run: () => { wrapSelection("**"); return true; } },
            { key: "Mod-i", run: () => { wrapSelection("*"); return true; } },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.lineWrapping,
          placeholder(t("noteEditor.placeholder", "Write your note...")),
          livePreview(previewOptionsRef),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) setNoteContent(update.state.doc.toString());
          }),
          EditorView.domEventHandlers({
            blur: () => { flushSave(); return false; },
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const next = initialContent ?? "";
    // A save echoes back through this prop; resetting on it would clobber keystrokes typed meanwhile
    if (next === savedContentRef.current) return;
    savedContentRef.current = next;
    setNoteContent(next);
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const view = viewRef.current;
    if (view && view.state.doc.toString() !== next) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: next },
        annotations: Transaction.addToHistory.of(false),
      });
    }
  }, [initialContent]);

  // Links and images re-render when the note index or folders change
  useEffect(() => {
    viewRef.current?.dispatch({ effects: refreshLivePreview.of(null) });
  }, [resolveWikilink, resolveImageSrc]);

  // Debounced autosave for every edit path (typing and toolbar insertions)
  useEffect(() => {
    if (noteContent === savedContentRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(flushSave, 2000);
  }, [noteContent, flushSave]);

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

  // Replaces the selection with text and selects [selectFrom, selectTo) inside it
  const insertText = (text, selectFrom = text.length, selectTo = selectFrom) => {
    const view = viewRef.current;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: text },
      selection: EditorSelection.range(from + selectFrom, from + selectTo),
    });
    view.focus();
  };

  const selectedText = () => {
    const view = viewRef.current;
    if (!view) return "";
    const { from, to } = view.state.selection.main;
    return view.state.sliceDoc(from, to);
  };

  const insertHeading = (level) => {
    const view = viewRef.current;
    if (!view) return;
    const { head } = view.state.selection.main;
    const line = view.state.doc.lineAt(head);
    const existing = /^#{1,6}\s+/.exec(line.text)?.[0].length ?? 0;
    const prefix = `${"#".repeat(level)} `;
    const cursor = Math.max(line.from + prefix.length, head - existing + prefix.length);
    view.dispatch({
      changes: { from: line.from, to: line.from + existing, insert: prefix },
      selection: { anchor: cursor },
    });
    view.focus();
  };

  const insertLink = () => {
    const label = selectedText() || "link text";
    const token = `[${label}](https://)`;
    const urlStart = token.indexOf("https://");
    insertText(token, urlStart, urlStart + "https://".length);
  };

  const insertImage = () => {
    insertText("![](https://)", 4, 12);
  };

  const insertLocalImage = async () => {
    if (!onPickLocalImage) return;
    const relativePath = await onPickLocalImage();
    if (!relativePath) return;
    insertText(`![](${relativePath})`);
  };

  return (
    <div className="note-editor">
      {/* mousedown default would blur the editor and drop its selection before the click */}
      <div className="note-toolbar" onMouseDown={(e) => { if (e.target.closest("button")) e.preventDefault(); }}>
        <div className="note-toolbar-format">
          <button type="button" onClick={() => insertHeading(1)} title={t("noteEditor.heading1", "Heading 1")}><Heading1 size={14} /></button>
          <button type="button" onClick={() => insertHeading(2)} title={t("noteEditor.heading2", "Heading 2")}><Heading2 size={14} /></button>
          <button type="button" onClick={() => insertHeading(3)} title={t("noteEditor.heading3", "Heading 3")}><Heading3 size={14} /></button>
          <div className="note-toolbar-divider" />
          <button type="button" onClick={() => wrapSelection('**')} title={t("noteEditor.bold", "Bold")}><Bold size={14} /></button>
          <button type="button" onClick={() => wrapSelection('*')} title={t("noteEditor.italic", "Italic")}><Italic size={14} /></button>
          <button type="button" onClick={() => wrapSelection('~~')} title={t("noteEditor.strikethrough", "Strikethrough")}><Strikethrough size={14} /></button>
          <button type="button" onClick={() => wrapSelection('__')} title={t("noteEditor.underline", "Underline")}><Underline size={14} /></button>
          <button type="button" onClick={() => wrapSelection('==')} title={t("noteEditor.highlight", "Highlight")}><Highlighter size={14} /></button>
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
      <div
        ref={hostRef}
        className={`note-textarea note-lp${isNoteLoading ? " is-loading" : ""}`}
        aria-busy={isNoteLoading || undefined}
      />
    </div>
  );
});

export default NoteEditor;
