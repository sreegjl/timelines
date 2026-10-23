import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Check, X } from "lucide-react";
import { getNoteDisplayName } from "../utils/noteRefs";

// shows the note's file name and lets u rename it in place. files deserve better names than "event-8f3a"
export default function NoteFileName({ noteFile, onRename, readOnly = false }) {
  const { t } = useTranslation("timeline");
  // spelled out so the parser finds every message
  const errorMessages = {
    LOCKED: t("noteFile.errors.locked", "This note can't be renamed from here."),
    INVALID_NAME: t("noteFile.errors.invalidName", "That name won't work as a file name."),
    NO_TIMELINE: t("noteFile.errors.noTimeline", "No timeline open."),
    EXISTS: t("noteFile.errors.exists", "A note with that name already exists."),
    FAILED: t("noteFile.errors.failed", "Rename failed."),
  };
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    setIsEditing(false);
    setError("");
  }, [noteFile]);

  useEffect(() => {
    if (!isEditing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [isEditing]);

  if (!noteFile) return null;
  const displayName = getNoteDisplayName(noteFile);
  const folder = noteFile.includes("/") ? noteFile.slice(0, noteFile.lastIndexOf("/") + 1) : "";

  const start = () => {
    setDraft(displayName);
    setError("");
    setIsEditing(true);
  };

  const cancel = () => {
    setIsEditing(false);
    setError("");
  };

  const commit = async () => {
    if (isBusy) return;
    if (!draft.trim() || draft.trim() === displayName) {
      cancel();
      return;
    }
    setIsBusy(true);
    const result = await onRename?.(draft);
    setIsBusy(false);
    if (result?.success) {
      setIsEditing(false);
      setError("");
    } else {
      setError(result?.error || "FAILED");
    }
  };

  if (!isEditing) {
    return (
      <span className="note-file-name" title={noteFile}>
        <span className="note-file-name-text">{folder && <span className="note-file-name-folder">{folder}</span>}{displayName}.md</span>
        {!readOnly && onRename && (
          <button type="button" className="note-file-name-button" onClick={start} title={t("noteFile.rename", "Rename note file")} aria-label={t("noteFile.rename", "Rename note file")}>
            <Pencil size={11} />
          </button>
        )}
      </span>
    );
  }

  return (
    <span className="note-file-name is-editing">
      <input
        ref={inputRef}
        className="note-file-name-input"
        value={draft}
        disabled={isBusy}
        maxLength={120}
        spellCheck={false}
        aria-label={t("noteFile.newName", "New note file name")}
        aria-invalid={Boolean(error)}
        onChange={(e) => { setDraft(e.target.value); setError(""); }}
        onKeyDown={(e) => {
          // escape needs to stay local or the whole panel runs away with it
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancel(); }
        }}
      />
      <span className="note-file-name-ext">.md</span>
      <button type="button" className="note-file-name-button" onClick={commit} disabled={isBusy} title={t("noteFile.save", "Save name")} aria-label={t("noteFile.save", "Save name")}>
        <Check size={12} />
      </button>
      <button type="button" className="note-file-name-button" onClick={cancel} disabled={isBusy} title={t("common:actions.cancel", "Cancel")} aria-label={t("common:actions.cancel", "Cancel")}>
        <X size={12} />
      </button>
      {error && <span className="note-file-name-error" role="alert">{errorMessages[error] ?? errorMessages.FAILED}</span>}
    </span>
  );
}
