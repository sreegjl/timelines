import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { renderNoteMarkdown, resolveNoteImageSrc } from "../utils/noteUtils";
import { createNote, addExistingNote, readNote, writeNote, deleteNote, getNotesBaseDir, getAssetsBaseDir, pickAndImportImage, importImageFromPath } from "../utils/electronApi";
import { isSafeNoteRef } from "../utils/validation";
import { getStorageId } from "../utils/idUtils";
import { resolvePackageAssetSrc } from "../utils/viewerPackageStore";
import { toNotePath } from "../utils/wikilinks";

export function useNoteManagement({ selectedElement, timelineData, formData, setFormData, onUpdate, resolveNote, timelineDir }) {
  const { t } = useTranslation("timeline");
  const timelineId = getStorageId(timelineData?.file);
  const [noteInitialContent, setNoteInitialContent] = useState("");
  const [isNoteLoading, setIsNoteLoading] = useState(false);
  const [noteExists, setNoteExists] = useState(false);
  // Bumped to re-read the note after it was edited elsewhere, like the full-height note page
  const [noteReloadKey, setNoteReloadKey] = useState(0);
  const reloadNote = useCallback(() => setNoteReloadKey((k) => k + 1), []);
  const [isNoteAddOpen, setIsNoteAddOpen] = useState(false);
  const [notesBaseUrl, setNotesBaseUrl] = useState("");
  const [notesBasePath, setNotesBasePath] = useState("");
  const [assetsBasePath, setAssetsBasePath] = useState("");
  const noteEditorRef = useRef(null);
  const noteRenderRef = useRef(null);

  useEffect(() => {
    if (window.electron === undefined) return;

    let isMounted = true;
    Promise.all([getNotesBaseDir(), getAssetsBaseDir()]).then(([notesResult, assetsResult]) => {
      if (!isMounted) return;
      if (notesResult?.success && notesResult.fileUrl) {
        const normalized = notesResult.fileUrl.endsWith("/") ? notesResult.fileUrl : `${notesResult.fileUrl}/`;
        setNotesBaseUrl(normalized);
      }
      if (notesResult?.success && notesResult.path) setNotesBasePath(notesResult.path);
      if (assetsResult?.success && assetsResult.path) setAssetsBasePath(assetsResult.path);
    });
    return () => { isMounted = false; };
  }, []);

  useEffect(() => {
    let isMounted = true;
    const loadNote = async () => {
      if (!selectedElement?.noteFile) {
        setNoteInitialContent("");
        setNoteExists(false);
        setIsNoteAddOpen(false);
        return;
      }
      const timelineId = getStorageId(timelineData?.file);
      if (!timelineId) return;
      setIsNoteLoading(true);
      const result = await readNote({ timelineId, filename: selectedElement.noteFile });
      if (!isMounted) return;
      setIsNoteLoading(false);
      if (result?.success) {
        setNoteInitialContent(result.content ?? "");
        setNoteExists(true);
      } else {
        if (result?.error === "NOT_FOUND") {
          const next = { ...selectedElement };
          delete next.noteFile;
          setFormData(next);
          onUpdate?.(next);
        }
        setNoteInitialContent("");
        setNoteExists(false);
      }
    };
    loadNote();
    return () => { isMounted = false; };
  }, [selectedElement?.id, selectedElement?.noteFile, timelineData?.file?.id, noteReloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hide broken images and videos in rendered note
  useEffect(() => {
    if (!noteRenderRef.current) return;
    const imgs = noteRenderRef.current.querySelectorAll("img");
    imgs.forEach((img) => {
      if (img.complete && img.naturalWidth === 0) {
        img.style.display = "none";
      } else {
        img.addEventListener("error", function () {
          this.style.display = "none";
          this.style.minHeight = "0";
        }, { once: true });
      }
    });
    const videos = noteRenderRef.current.querySelectorAll("video");
    videos.forEach((video) => {
      video.addEventListener("error", function () {
        this.style.display = "none";
        this.style.minHeight = "0";
      }, { once: true });
    });
  }, [noteInitialContent]);

  const noteWordCount = useMemo(() => {
    if (!noteInitialContent) return 0;
    return noteInitialContent.trim().split(/\s+/).filter(Boolean).length;
  }, [noteInitialContent]);

  const noteFileBaseUrl = notesBaseUrl && (timelineDir || timelineId)
    ? `${notesBaseUrl}${timelineDir || timelineId}/`
    : notesBaseUrl;

  const assetsTimelineDir = assetsBasePath && timelineId
    ? `${assetsBasePath.replace(/[/\\]$/, "")}/${timelineId}/`
    : "";

  const elementNotePath = toNotePath(selectedElement?.noteFile, timelineDir);

  // Shared by the rendered note and the live preview editor so both resolve links and images alike
  const resolveElementWikilink = useCallback(
    (target) => (resolveNote ? resolveNote(target, elementNotePath) : null),
    [resolveNote, elementNotePath]
  );
  const resolveElementImageSrc = useCallback(
    (src) => resolveNoteImageSrc(src, noteFileBaseUrl, notesBasePath, assetsBasePath, assetsTimelineDir, resolvePackageAssetSrc),
    [noteFileBaseUrl, notesBasePath, assetsBasePath, assetsTimelineDir]
  );

  const renderedNoteHtml = useMemo(
    // resolvePackageAssetSrc serves images bundled in a packaged .timeline (web viewer); it is a no-op on desktop
    () => renderNoteMarkdown(noteInitialContent, isNoteLoading, noteFileBaseUrl, notesBasePath, assetsBasePath, assetsTimelineDir, resolvePackageAssetSrc, {
      resolveWikilink: resolveElementWikilink,
    }),
    [noteInitialContent, isNoteLoading, noteFileBaseUrl, notesBasePath, assetsBasePath, assetsTimelineDir, resolveElementWikilink]
  );

  const noteViewCallbackRef = useCallback((node) => {
    noteRenderRef.current = node;
    if (node) node.innerHTML = renderedNoteHtml;
  }, [renderedNoteHtml]);

  const handleNoteSave = useCallback(async (content) => {
    if (!formData?.noteFile || !isSafeNoteRef(formData.noteFile)) return;
    const timelineId = getStorageId(timelineData?.file);
    if (!timelineId) return;
    await writeNote({ timelineId, filename: formData.noteFile, content });
    setNoteInitialContent(content);
  }, [formData?.noteFile, timelineData?.file?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTaskToggle = useCallback((idx) => {
    let count = 0;
    const newContent = noteInitialContent.replace(
      /^(\s*[-*+] \[)([ x])(\])/gm,
      (match, pre, state, post) => {
        if (count++ === idx) return `${pre}${state === " " ? "x" : " "}${post}`;
        return match;
      }
    );
    setNoteInitialContent(newContent);
    handleNoteSave(newContent);
  }, [noteInitialContent, handleNoteSave]);

  const handleAddNote = useCallback(async () => {
    const timelineId = getStorageId(timelineData?.file);
    if (!timelineId) return;
    const result = await createNote({ timelineId, title: formData.title, elementId: formData.id });
    if (!result?.success) { console.error("Failed to create note:", result?.error); return; }
    const next = { ...formData, noteFile: result.filename || `${formData.id}.md` };
    setFormData(next);
    onUpdate?.(next);
    setNoteInitialContent(result?.content ?? `# ${formData.title}\n\n`);
  }, [formData, timelineData?.file?.id, onUpdate, setFormData]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAddExistingNote = useCallback(async () => {
    const timelineId = getStorageId(timelineData?.file);
    if (!timelineId) return;
    const result = await addExistingNote({ timelineId });
    if (!result?.success) {
      if (result?.error === "OUTSIDE_NOTES_DIR") {
        window.alert("That note is outside your Notes Folder. Choose a note inside the Notes Folder or change the Notes Folder in App Settings.");
      } else if (!result?.cancelled) {
        console.error("Failed to add existing note:", result?.error);
      }
      return;
    }
    const next = { ...formData, noteFile: result.filename };
    setFormData(next);
    onUpdate?.(next);
    setNoteInitialContent(result?.content ?? "");
    setNoteExists(true);
  }, [formData, timelineData?.file?.id, onUpdate, setFormData]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDeleteNote = useCallback(async () => {
    if (!formData?.noteFile || !isSafeNoteRef(formData.noteFile)) return;
    const confirmed = window.confirm(t("noteEditor.confirmDelete", "Delete this note? This cannot be undone."));
    if (!confirmed) return;
    const timelineId = getStorageId(timelineData?.file);
    if (!timelineId) return;
    const result = await deleteNote({ timelineId, filename: formData.noteFile });
    if (!result?.success) { console.error("Failed to delete note:", result?.error); return; }
    const next = { ...formData };
    delete next.noteFile;
    setFormData(next);
    setNoteInitialContent("");
    onUpdate?.(next);
  }, [formData, timelineData?.file?.id, onUpdate, setFormData]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleUnlinkNote = useCallback(() => {
    if (!formData?.noteFile) return;
    const next = { ...formData };
    delete next.noteFile;
    setFormData(next);
    setNoteInitialContent("");
    setNoteExists(false);
    onUpdate?.(next);
  }, [formData, onUpdate, setFormData]);

  const handlePickLocalImage = useCallback(async () => {
    if (!timelineId) return null;
    const result = await pickAndImportImage({ timelineId });
    if (result?.cancelled || !result?.success) return null;
    // Root-relative paths don't resolve inside notes, use the full asset URL instead
    if (result.relativePath && /[\\/]/.test(result.relativePath)) return result.assetUrl;
    return result.relativePath;
  }, [timelineId]);

  const handlePickThumbnail = useCallback(async () => {
    if (!timelineId) return null;
    const result = await pickAndImportImage({ timelineId });
    if (result?.cancelled || !result?.success) return null;
    return result.assetUrl;
  }, [timelineId]);

  const handleDropThumbnail = useCallback(async (filePath) => {
    if (!timelineId || !filePath) return null;
    const result = await importImageFromPath({ timelineId, filePath });
    if (!result?.success) return null;
    return result.assetUrl;
  }, [timelineId]);

  return {
    noteInitialContent,
    setNoteInitialContent,
    isNoteLoading,
    noteExists,
    isNoteAddOpen,
    setIsNoteAddOpen,
    notesBaseUrl,
    notesBasePath,
    assetsBasePath,
    assetsTimelineDir,
    noteEditorRef,
    reloadNote,
    resolveElementWikilink,
    resolveElementImageSrc,
    noteWordCount,
    renderedNoteHtml,
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
  };
}
