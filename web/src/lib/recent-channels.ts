const KEY = 'talkie:recent-channels';
const MAX = 8;

export type RecentChannel = {
  name: string;
  lastJoinedAt: number;
};

export function getRecentChannels(): RecentChannel[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentChannel[];
    return parsed
      .filter((c) => c && typeof c.name === 'string')
      .sort((a, b) => b.lastJoinedAt - a.lastJoinedAt)
      .slice(0, MAX);
  } catch {
    return [];
  }
}

export function rememberChannel(name: string) {
  if (typeof window === 'undefined') return;
  const current = getRecentChannels().filter((c) => c.name !== name);
  current.unshift({ name, lastJoinedAt: Date.now() });
  localStorage.setItem(KEY, JSON.stringify(current.slice(0, MAX)));
}

export function forgetChannel(name: string) {
  if (typeof window === 'undefined') return;
  const remaining = getRecentChannels().filter((c) => c.name !== name);
  localStorage.setItem(KEY, JSON.stringify(remaining));
}
