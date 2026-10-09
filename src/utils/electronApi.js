import { getPackageNote } from './viewerPackageStore';

// Check if running in Electron
const isElectron = () => {
  return window.electron !== undefined;
};

export async function saveTimelineToFile(timelineData, filename = 'ancient-greece', options = {}) {
  if (!isElectron()) {
    console.warn('Not running in Electron, skipping file save');
    return { success: false, error: 'Not in Electron environment' };
  }

  try {
    const result = await window.electron.saveTimeline(timelineData, filename, options);
    return result;
  } catch (error) {
    console.error('Error saving timeline:', error);
    return { success: false, error: error.message };
  }
}

export async function listTimelines() {
  if (!isElectron()) {
    console.warn('Not running in Electron, returning empty list');
    return { success: true, files: [] };
  }

  try {
    const result = await window.electron.listTimelines();
    return result;
  } catch (error) {
    console.error('Error listing timelines:', error);
    return { success: false, files: [], error: error.message };
  }
}

export async function loadTimeline(filename) {
  if (!isElectron()) {
    console.warn('Not running in Electron');
    return { success: false, error: 'Not in Electron environment' };
  }

  try {
    const result = await window.electron.loadTimeline(filename);
    return result;
  } catch (error) {
    console.error('Error loading timeline:', error);
    return { success: false, error: error.message };
  }
}

export async function exportTimeline(timelineData, suggestedName) {
  if (!isElectron()) {
    console.warn('Not running in Electron, using browser download');
    // Fallback to browser download
    const dataStr = JSON.stringify(timelineData, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = suggestedName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return { success: true };
  }

  try {
    const result = await window.electron.exportTimeline(timelineData, suggestedName);
    return result;
  } catch (error) {
    console.error('Error exporting timeline:', error);
    return { success: false, error: error.message };
  }
}

export async function exportTimelinePackage(timelineData, suggestedName) {
  if (!isElectron()) {
    console.warn('Not running in Electron');
    return { success: false, error: 'Not in Electron environment' };
  }

  try {
    return await window.electron.exportTimelinePackage(timelineData, suggestedName);
  } catch (error) {
    console.error('Error exporting timeline package:', error);
    return { success: false, error: error.message };
  }
}

export async function importTimeline(payload) {
  if (!isElectron()) {
    console.warn('Not running in Electron');
    return { success: false, error: 'Not in Electron environment' };
  }

  try {
    const result = await window.electron.importTimeline(payload);
    return result;
  } catch (error) {
    console.error('Error importing timeline:', error);
    return { success: false, error: error.message };
  }
}

export async function createNote({ timelineId, title, elementId, name }) {
  if (!isElectron()) {
    console.warn('Not running in Electron');
    return { success: false, error: 'Not in Electron environment' };
  }

  try {
    return await window.electron.createNote({ timelineId, title, elementId, name });
  } catch (error) {
    console.error('Error creating note:', error);
    return { success: false, error: error.message };
  }
}

// The timeline's notes folder relative to the notes root, which honors the vault subfolder setting
export async function getTimelineNotesDir({ timelineId }) {
  if (!isElectron() || !window.electron.getTimelineNotesDir) return { success: false };
  try {
    return await window.electron.getTimelineNotesDir({ timelineId });
  } catch (error) {
    console.error('Error getting timeline notes folder:', error);
    return { success: false };
  }
}

// Root-relative paths of every note in the notes folder; the web viewer has no folder to list
export async function listNotes() {
  if (!isElectron() || !window.electron.listNotes) return { success: false, notes: [] };
  try {
    return await window.electron.listNotes();
  } catch (error) {
    console.error('Error listing notes:', error);
    return { success: false, notes: [] };
  }
}

export async function addExistingNote({ timelineId }) {
  if (!isElectron()) {
    console.warn('Not running in Electron');
    return { success: false, error: 'Not in Electron environment' };
  }

  try {
    return await window.electron.addExistingNote({ timelineId });
  } catch (error) {
    console.error('Error adding existing note:', error);
    return { success: false, error: error.message };
  }
}

export async function readNote({ timelineId, filename }) {
  if (!isElectron()) {
    // The web viewer serves notes bundled in a packaged .timeline from memory
    const packaged = getPackageNote(filename);
    if (packaged !== null) return { success: true, content: packaged };
    console.warn('Not running in Electron');
    return { success: false, error: 'Not in Electron environment' };
  }

  try {
    return await window.electron.readNote({ timelineId, filename });
  } catch (error) {
    console.error('Error reading note:', error);
    return { success: false, error: error.message };
  }
}

export async function writeNote({ timelineId, filename, content }) {
  if (!isElectron()) {
    console.warn('Not running in Electron');
    return { success: false, error: 'Not in Electron environment' };
  }

  try {
    return await window.electron.writeNote({ timelineId, filename, content });
  } catch (error) {
    console.error('Error writing note:', error);
    return { success: false, error: error.message };
  }
}

export async function deleteNote({ timelineId, filename }) {
  if (!isElectron()) {
    console.warn('Not running in Electron');
    return { success: false, error: 'Not in Electron environment' };
  }

  try {
    return await window.electron.deleteNote({ timelineId, filename });
  } catch (error) {
    console.error('Error deleting note:', error);
    return { success: false, error: error.message };
  }
}


export async function renameTimeline({ oldId, newId }) {
  if (!isElectron()) {
    console.warn('Not running in Electron');
    return { success: false, error: 'Not in Electron environment' };
  }

  try {
    return await window.electron.renameTimeline({ oldId, newId });
  } catch (error) {
    console.error('Error renaming timeline:', error);
    return { success: false, error: error.message };
  }
}

export async function chooseAssetsDir() {
  if (!isElectron()) return { success: false };
  try { return await window.electron.chooseAssetsDir(); } catch (e) { return { success: false, error: e.message }; }
}

export async function openAssetsFolder() {
  if (!isElectron()) return { success: false };
  try { return await window.electron.openAssetsFolder(); } catch (e) { return { success: false, error: e.message }; }
}

export async function getAssetsBaseDir() {
  if (!isElectron()) return { success: false, error: 'Not in Electron environment' };
  try {
    return await window.electron.getAssetsBaseDir();
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function pickAndImportImage({ timelineId }) {
  if (!isElectron()) return { success: false, error: 'Not in Electron environment' };
  try {
    return await window.electron.pickAndImportImage({ timelineId });
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function importImageFromPath({ timelineId, filePath }) {
  if (!isElectron()) return { success: false, error: 'Not in Electron environment' };
  try {
    return await window.electron.importImageFromPath({ timelineId, filePath });
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function copyTimelineStorage({ sourceId, targetId }) {
  if (!isElectron()) return { success: false, error: 'Not in Electron environment' };
  try {
    return await window.electron.copyTimelineStorage({ sourceId, targetId });
  } catch (error) {
    console.error('Error copying timeline storage:', error);
    return { success: false, error: error.message };
  }
}

export async function deleteAsset({ timelineId, filename }) {
  if (!isElectron()) return { success: false, error: 'Not in Electron environment' };
  try {
    return await window.electron.deleteAsset({ timelineId, filename });
  } catch (error) {
    console.error('Error deleting asset:', error);
    return { success: false, error: error.message };
  }
}

export async function getNotesBaseDir() {
  if (!isElectron()) {
    console.warn('Not running in Electron');
    return { success: false, error: 'Not in Electron environment' };
  }

  try {
    return await window.electron.getNotesBaseDir();
  } catch (error) {
    console.error('Error resolving notes base directory:', error);
    return { success: false, error: error.message };
  }
}

export async function fetchWikipedia({ url }) {
  if (!isElectron()) {
    console.warn('Not running in Electron');
    return { success: false, error: 'Not in Electron environment' };
  }

  try {
    return await window.electron.fetchWikipedia({ url });
  } catch (error) {
    console.error('Error fetching Wikipedia:', error);
    return { success: false, error: error.message };
  }
}

export async function chooseTimelinesDir() {
  if (!isElectron()) {
    console.warn('Not running in Electron');
    return { success: false, error: 'Not in Electron environment' };
  }

  try {
    return await window.electron.chooseTimelinesDir();
  } catch (error) {
    console.error('Error choosing timelines directory:', error);
    return { success: false, error: error.message };
  }
}

export async function chooseNotesDir() {
  if (!isElectron()) {
    console.warn('Not running in Electron');
    return { success: false, error: 'Not in Electron environment' };
  }

  try {
    return await window.electron.chooseNotesDir();
  } catch (error) {
    console.error('Error choosing notes directory:', error);
    return { success: false, error: error.message };
  }
}


export async function openTimelinesFolder() {
  if (!isElectron()) return { success: false, error: 'Not in Electron environment' };
  try {
    return await window.electron.openTimelinesFolder();
  } catch (error) {
    console.error('Error opening timelines folder:', error);
    return { success: false, error: error.message };
  }
}

export async function openNotesFolder() {
  if (!isElectron()) return { success: false, error: 'Not in Electron environment' };
  try {
    return await window.electron.openNotesFolder();
  } catch (error) {
    console.error('Error opening notes folder:', error);
    return { success: false, error: error.message };
  }
}

export async function openFontsFolder() {
  if (!isElectron()) {
    console.warn('Not running in Electron');
    return { success: false, error: 'Not in Electron environment' };
  }

  try {
    return await window.electron.openFontsFolder();
  } catch (error) {
    console.error('Error opening fonts folder:', error);
    return { success: false, error: error.message };
  }
}

export async function listFonts() {
  if (!isElectron()) {
    console.warn('Not running in Electron');
    return { success: false, fonts: [] };
  }

  try {
    const fonts = await window.electron.listFonts();
    return { success: true, fonts: Array.isArray(fonts) ? fonts : [] };
  } catch (error) {
    console.error('Error listing fonts:', error);
    return { success: false, fonts: [], error: error.message };
  }
}

export async function saveUserTheme({ id, content }) {
  if (!isElectron()) {
    console.warn('Not running in Electron');
    return { success: false, error: 'Not in Electron environment' };
  }

  try {
    return await window.electron.saveUserTheme({ id, content });
  } catch (error) {
    console.error('Error saving user theme:', error);
    return { success: false, error: error.message };
  }
}

export async function deleteUserTheme({ id }) {
  if (!isElectron()) {
    console.warn('Not running in Electron');
    return { success: false, error: 'Not in Electron environment' };
  }

  try {
    return await window.electron.deleteUserTheme({ id });
  } catch (error) {
    console.error('Error deleting user theme:', error);
    return { success: false, error: error.message };
  }
}

export async function createFolder(folderName, parentFolder) {
  if (!window.electron?.createFolder) return { success: false };
  return window.electron.createFolder({ folderName, parentFolder });
}

export async function listFolders() {
  if (!window.electron?.listFolders) return [];
  return window.electron.listFolders();
}

export async function moveTimeline(id, targetFolder) {
  if (!window.electron?.moveTimeline) return { success: false };
  return window.electron.moveTimeline({ id, targetFolder });
}

export async function renameFolder(folderPath, newName) {
  if (!window.electron?.renameFolder) return { success: false };
  return window.electron.renameFolder({ folderPath, newName });
}

export async function updateTimelineTitle(id, title) {
  if (!window.electron?.updateTimelineTitle) return { success: false };
  return window.electron.updateTimelineTitle({ id, title });
}

export async function deleteFolder(folderPath) {
  if (!window.electron?.deleteFolder) return { success: false };
  return window.electron.deleteFolder({ folderPath });
}

export async function moveFolder(folderPath, targetFolder) {
  if (!window.electron?.moveFolder) return { success: false };
  return window.electron.moveFolder({ folderPath, targetFolder });
}
