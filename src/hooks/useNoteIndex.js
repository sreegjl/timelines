import { useCallback, useEffect, useMemo, useState } from "react";
import { getTimelineNotesDir, listNotes } from "../utils/electronApi";
import { getStorageId } from "../utils/idUtils";
import { buildNoteIndex, resolveWikilink, timelineNotesDir, toNotePath, toNoteRef } from "../utils/wikilinks";

// Notes the open timeline can link to: the whole notes folder on desktop, element notes in the viewer
export function useNoteIndex(timelineData) {
  const storageId = getStorageId(timelineData?.file);
  const [vaultPaths, setVaultPaths] = useState([]);
  // Main knows the real folder (subfolder setting, older root-level folders); the viewer computes it
  const [notesDirFromMain, setNotesDirFromMain] = useState(null);
  const timelineDir = notesDirFromMain ?? timelineNotesDir(storageId);

  useEffect(() => {
    let isMounted = true;
    setNotesDirFromMain(null);
    if (!storageId) return undefined;
    getTimelineNotesDir({ timelineId: storageId }).then((result) => {
      if (isMounted && result?.success && result.relativePath) setNotesDirFromMain(result.relativePath);
    });
    return () => { isMounted = false; };
  }, [storageId]);

  const refreshNotes = useCallback(async () => {
    const result = await listNotes();
    if (result?.success && Array.isArray(result.notes)) setVaultPaths(result.notes);
  }, []);

  // Refocusing the window picks up notes created or renamed in Obsidian meanwhile
  useEffect(() => {
    refreshNotes();
    window.addEventListener("focus", refreshNotes);
    return () => window.removeEventListener("focus", refreshNotes);
  }, [refreshNotes, storageId]);

  // Lowercased note path -> { ref, elements } for every element with a note
  const elementNotes = useMemo(() => {
    const map = new Map();
    for (const el of timelineData?.elements || []) {
      if (!el.noteFile) continue;
      const notePath = toNotePath(el.noteFile, timelineDir);
      if (!notePath) continue;
      const key = notePath.toLowerCase();
      const entry = map.get(key) || { notePath, ref: el.noteFile, elements: [] };
      entry.elements.push(el);
      map.set(key, entry);
    }
    return map;
  }, [timelineData?.elements, timelineDir]);

  const index = useMemo(
    () => buildNoteIndex([...vaultPaths, ...[...elementNotes.values()].map((entry) => entry.notePath)]),
    [vaultPaths, elementNotes]
  );

  const resolveNote = useCallback(
    (target, fromPath) => resolveWikilink(target, index, { timelineDir, fromPath }),
    [index, timelineDir]
  );

  // Element refs read through the viewer's package store too, so prefer them over a root path
  const noteRefFor = useCallback(
    (notePath) => elementNotes.get(String(notePath).toLowerCase())?.ref ?? toNoteRef(notePath),
    [elementNotes]
  );

  const linkedElementsFor = useCallback(
    (notePath) => elementNotes.get(String(notePath).toLowerCase())?.elements ?? [],
    [elementNotes]
  );

  return { storageId, timelineDir, resolveNote, noteRefFor, linkedElementsFor, refreshNotes };
}
