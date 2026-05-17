const KEY = 'talkie:contacts';
const MAX = 32;

export type Contact = {
  id: string;
  name: string;
  email: string;
  initials: string;
  lastActiveAt: number | null;
  savedAt: number;
};

export type ContactInput = Omit<Contact, 'savedAt'>;

export function getContacts(): Contact[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Contact[];
    return parsed
      .filter((c) => c && typeof c.id === 'string' && typeof c.name === 'string')
      .sort((a, b) => b.savedAt - a.savedAt)
      .slice(0, MAX);
  } catch {
    return [];
  }
}

export function saveContact(input: ContactInput): Contact[] {
  if (typeof window === 'undefined') return [];
  const current = getContacts().filter((c) => c.id !== input.id);
  current.unshift({ ...input, savedAt: Date.now() });
  const next = current.slice(0, MAX);
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function forgetContact(id: string): Contact[] {
  if (typeof window === 'undefined') return [];
  const next = getContacts().filter((c) => c.id !== id);
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
