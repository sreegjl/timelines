const STORAGE_KEY = "timelines-app-settings";

export async function getAppSettings() {
  if (window.electron?.getAppSettings) {
    try {
      return await window.electron.getAppSettings();
    } catch (error) {
      console.error("Failed to load app settings:", error);
      return {};
    }
  }

  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error("Failed to parse app settings:", error);
    return {};
  }
}

export async function saveAppSettings(settings) {
  if (window.electron?.setAppSettings) {
    try {
      await window.electron.setAppSettings(settings);
      return;
    } catch (error) {
      console.error("Failed to save app settings:", error);
      return;
    }
  }

  const existing = await getAppSettings();
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...existing, ...settings }));
}
