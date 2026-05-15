function key(channel: string) {
  return `talkie:pin:${channel}`;
}

export function setChannelPin(channel: string, pin: string) {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(key(channel), pin);
}

export function getChannelPin(channel: string): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(key(channel));
}

export function clearChannelPin(channel: string) {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(key(channel));
}
