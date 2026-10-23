import { useEffect, useMemo, useState } from "react";
import { readNotes } from "../utils/electronApi";
import { getStorageId } from "../utils/idUtils";

const EMPTY = Object.freeze({});

// lazily slurps every linked note so search can peek inside. only runs while someone actually asks
export function useNoteContents({ timelineFile, elements, enabled, refreshKey = 0 }) {
  const [contents, setContents] = useState(EMPTY);
  const timelineId = getStorageId(timelineFile);
  const noteKey = useMemo(() => {
    if (!enabled) return "";
    const refs = new Set();
    for (const el of elements || []) if (el?.noteFile) refs.add(el.noteFile);
    return [...refs].sort().join("\n");
  }, [elements, enabled]);

  useEffect(() => {
    if (!enabled || !timelineId || !noteKey) {
      if (!enabled) setContents(EMPTY);
      return undefined;
    }
    let cancelled = false;
    readNotes({ timelineId, filenames: noteKey.split("\n") }).then((result) => {
      if (cancelled) return;
      setContents(result?.success && result.notes ? result.notes : EMPTY);
    });
    return () => { cancelled = true; };
  }, [enabled, timelineId, noteKey, refreshKey]);

  return contents;
}

export const getElementNoteContent = (noteContents, el) =>
  (el?.noteFile && noteContents?.[el.noteFile]) || null;
