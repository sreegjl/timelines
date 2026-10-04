import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import { useTranslation } from "react-i18next";
import { Heading1, Heading2, Heading3, Bold, Italic, Strikethrough, Underline, Highlighter, Link2, Trash2, Unlink, ImagePlay, Paperclip } from "lucide-react";

const NoteEditor = forwardRef(function NoteEditor(
  { initialContent, isNoteLoading, noteExists, onSave, onUnlink, onDelete, onPickLocalImage },
  ref
) {
  const { t } = useTranslation("timeline");
  const [noteContent, setNoteContent] = useState(initialContent ?? "");
  const noteContentRef = useRef(noteContent);
  const textareaRef = useRef(null);
  noteContentRef.current = noteContent;
  const savedContentRef = useRef(initialContent ?? "");
  const saveTimerRef = useRef(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const flushSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (noteContentRef.current === savedContentRef.current) return;
    savedContentRef.current = noteContentRef.current;
    onSaveRef.current(noteContentRef.current);
  }, []);

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
  }, [initialContent]);

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

  const wrapSelection = (prefix, suffix = prefix) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    const before = noteContentRef.current.slice(0, start);
    const selected = noteContentRef.current.slice(start, end);
    const after = noteContentRef.current.slice(end);
    const next = `${before}${prefix}${selected || ''}${suffix}${after}`;
    setNoteContent(next);
    const cursorStart = start + prefix.length;
    const cursorEnd = cursorStart + (selected || '').length;
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(cursorStart, cursorEnd);
    });
  };

  const insertHeading = (level) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    const content = noteContentRef.current;
    const lineStart = content.lastIndexOf('\n', start - 1) + 1;
    const lineEnd = content.indexOf('\n', end);
    const actualLineEnd = lineEnd === -1 ? content.length : lineEnd;
    const line = content.slice(lineStart, actualLineEnd);
    const cleaned = line.replace(/^#{1,6}\s+/, '');
    const prefix = `${'#'.repeat(level)} `;
    const nextLine = `${prefix}${cleaned}`;
    const next = `${content.slice(0, lineStart)}${nextLine}${content.slice(actualLineEnd)}`;
    setNoteContent(next);
    const cursor = lineStart + prefix.length + (start - lineStart);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(cursor, cursor);
    });
  };

  const insertLink = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    const content = noteContentRef.current;
    const before = content.slice(0, start);
    const selected = content.slice(start, end) || 'link text';
    const after = content.slice(end);
    const token = `[${selected}](https://)`;
    const next = `${before}${token}${after}`;
    setNoteContent(next);
    const urlStart = before.length + token.indexOf('https://');
    const urlEnd = urlStart + 'https://'.length;
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(urlStart, urlEnd);
    });
  };

  const insertLocalImage = async () => {
    if (!onPickLocalImage) return;
    const relativePath = await onPickLocalImage();
    if (!relativePath) return;
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? noteContentRef.current.length;
    const content = noteContentRef.current;
    const before = content.slice(0, start);
    const after = content.slice(start);
    const token = `![](${relativePath})`;
    setNoteContent(`${before}${token}${after}`);
    const cursor = before.length + token.length;
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(cursor, cursor);
    });
  };

  const insertImage = () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart ?? 0;
    const content = noteContentRef.current;
    const before = content.slice(0, start);
    const after = content.slice(start);
    const token = `![](https://)`;
    setNoteContent(`${before}${token}${after}`);
    const urlStart = before.length + 4;
    const urlEnd = urlStart + 8;
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(urlStart, urlEnd);
    });
  };

  return (
    <div className="note-editor">
      <div className="note-toolbar">
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
      <textarea
        ref={textareaRef}
        className="note-textarea"
        value={noteContent}
        onChange={(e) => setNoteContent(e.target.value)}
        onBlur={flushSave}
        placeholder={isNoteLoading ? t("noteEditor.loading", "Loading note...") : t("noteEditor.placeholder", "Write your note...")}
        rows={8}
      />
    </div>
  );
});

export default NoteEditor;
