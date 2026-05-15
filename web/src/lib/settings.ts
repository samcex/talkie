const KEY = 'talkie:settings';

export type Settings = {
  outputVolume: number;
  beepOnIncoming: boolean;
  notifications: boolean;
  vibrate: boolean;
};

export const defaultSettings: Settings = {
  outputVolume: 1,
  beepOnIncoming: true,
  notifications: false,
  vibrate: true,
};

export function loadSettings(): Settings {
  if (typeof window === 'undefined') return defaultSettings;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSettings;
    const parsed = JSON.parse(raw);
    return { ...defaultSettings, ...parsed };
  } catch {
    return defaultSettings;
  }
}

export function saveSettings(next: Settings) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEY, JSON.stringify(next));
}
