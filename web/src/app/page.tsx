'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { UserButton, useUser } from '@clerk/nextjs';
import { Logo } from '@/components/Logo';
import { IOSInstallHint } from '@/components/IOSInstallHint';
import {
  forgetChannel,
  getRecentChannels,
  type RecentChannel,
} from '@/lib/recent-channels';
import { setChannelPin } from '@/lib/channel-pin';
import {
  forgetContact,
  getContacts,
  saveContact,
  type Contact,
} from '@/lib/contacts';

type DirectUser = {
  id: string;
  name: string;
  email: string;
  initials: string;
  lastActiveAt: number | null;
};

type IncomingCall = {
  id: string;
  fromUserId: string;
  fromName: string;
  fromEmail: string;
  initials: string;
  createdAt: number;
  expiresAt: number;
};

export default function HomePage() {
  const router = useRouter();
  const { user, isLoaded } = useUser();
  const [channel, setChannel] = useState('general');
  const [pin, setPin] = useState('');
  const [recent, setRecent] = useState<RecentChannel[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [pinPrompt, setPinPrompt] = useState<{
    channel: string;
    value: string;
    error: string | null;
  } | null>(null);
  const [directQuery, setDirectQuery] = useState('');
  const [directUsers, setDirectUsers] = useState<DirectUser[]>([]);
  const [directLoading, setDirectLoading] = useState(false);
  const [directError, setDirectError] = useState<string | null>(null);
  const [incomingCalls, setIncomingCalls] = useState<IncomingCall[]>([]);

  useEffect(() => {
    setRecent(getRecentChannels());
    setContacts(getContacts());
  }, []);

  useEffect(() => {
    if (!isLoaded || !user) return;
    let cancelled = false;

    async function loadCalls() {
      try {
        const res = await fetch('/api/calls', { cache: 'no-store' });
        if (!res.ok) return;
        const body = (await res.json()) as { calls?: IncomingCall[] };
        if (!cancelled) setIncomingCalls(body.calls ?? []);
      } catch {}
    }

    loadCalls();
    const timer = window.setInterval(loadCalls, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isLoaded, user]);

  useEffect(() => {
    const q = directQuery.trim();
    if (q.length < 2) {
      setDirectUsers([]);
      setDirectLoading(false);
      setDirectError(null);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setDirectLoading(true);
      setDirectError(null);
      try {
        const res = await fetch(
          `/api/users/search?q=${encodeURIComponent(q)}`,
          { signal: controller.signal },
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? 'User search failed');
        }
        const body = (await res.json()) as { users?: DirectUser[] };
        setDirectUsers(body.users ?? []);
      } catch (err) {
        if (controller.signal.aborted) return;
        setDirectUsers([]);
        setDirectError(err instanceof Error ? err.message : 'User search failed');
      } finally {
        if (!controller.signal.aborted) setDirectLoading(false);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [directQuery]);

  const isAdmin =
    (user?.publicMetadata as { role?: string } | undefined)?.role === 'admin';

  function go(targetChannel: string, pinValue: string) {
    const slug = targetChannel.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    if (!slug) return;
    const cleanPin = pinValue.trim();
    if (cleanPin) {
      setChannelPin(slug, cleanPin);
      router.push(`/channel/${slug}?private=1`);
    } else {
      router.push(`/channel/${slug}`);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    go(channel, pin);
  }

  function clickRecent(c: RecentChannel) {
    if (c.private) {
      setPinPrompt({ channel: c.name, value: '', error: null });
    } else {
      go(c.name, '');
    }
  }

  function submitPinPrompt(e: FormEvent) {
    e.preventDefault();
    if (!pinPrompt) return;
    if (!pinPrompt.value.trim()) {
      setPinPrompt({ ...pinPrompt, error: 'Enter the PIN' });
      return;
    }
    const target = pinPrompt.channel;
    const value = pinPrompt.value;
    setPinPrompt(null);
    go(target, value);
  }

  function dropRecent(target: string) {
    forgetChannel(target);
    setRecent(getRecentChannels());
  }

  async function startDirectCall(target: DirectUser | Contact) {
    setContacts(
      saveContact({
        id: target.id,
        name: target.name,
        email: target.email,
        initials: target.initials,
        lastActiveAt: target.lastActiveAt,
      }),
    );
    await fetch('/api/calls', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetUserId: target.id }),
    }).catch(() => {});
    router.push(
      `/channel/direct?peer=${encodeURIComponent(target.id)}&ring=1&title=${encodeURIComponent(
        target.name,
      )}`,
    );
  }

  function addContact(target: DirectUser) {
    setContacts(saveContact(target));
  }

  function removeContact(id: string) {
    setContacts(forgetContact(id));
  }

  async function acceptCall(call: IncomingCall) {
    await fetch(`/api/calls?id=${encodeURIComponent(call.id)}`, {
      method: 'DELETE',
    }).catch(() => {});
    setIncomingCalls((prev) => prev.filter((c) => c.id !== call.id));
    setContacts(
      saveContact({
        id: call.fromUserId,
        name: call.fromName,
        email: call.fromEmail,
        initials: call.initials,
        lastActiveAt: call.createdAt,
      }),
    );
    router.push(
      `/channel/direct?peer=${encodeURIComponent(call.fromUserId)}&title=${encodeURIComponent(
        call.fromName,
      )}`,
    );
  }

  async function declineCall(call: IncomingCall) {
    await fetch(`/api/calls?id=${encodeURIComponent(call.id)}`, {
      method: 'DELETE',
    }).catch(() => {});
    setIncomingCalls((prev) => prev.filter((c) => c.id !== call.id));
  }

  const greetingName =
    user?.firstName || user?.username || user?.emailAddresses[0]?.emailAddress;

  return (
    <main className="min-h-dvh talkie-shell flex justify-center text-zinc-950">
      <div className="talkie-phone relative flex min-h-dvh w-full max-w-[430px] flex-col overflow-hidden bg-white">
        <div className="talkie-noise" />
        <header className="glass-panel relative z-10 grid grid-cols-[84px_1fr_84px] items-center gap-2 rounded-b-[2rem] px-5 pb-4 pt-10">
          <div className="flex min-w-0 items-center justify-start">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 inset-border">
              <Logo size={34} />
            </div>
          </div>
          <div className="min-w-0 text-center">
            <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500">
              Callsign
            </div>
            <h1 className="truncate text-xl font-black tracking-tight text-zinc-950">
              {isLoaded && greetingName ? greetingName : 'Talkie'}
            </h1>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Link
              href="/settings"
              aria-label="Settings"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-100 text-zinc-600 transition active:scale-95 inset-border hover:text-zinc-950"
            >
              <SettingsIcon className="h-4 w-4" />
            </Link>
            <UserButton appearance={{ elements: { avatarBox: 'w-9 h-9' } }} />
          </div>
        </header>

        <div className="relative z-10 flex-1 overflow-y-auto no-scrollbar px-4 pb-8 pt-5">
          <IOSInstallHint />

          {isAdmin && (
            <div className="mb-3 flex justify-end">
              <Link
                href="/admin"
                className="rounded-full bg-red-600/10 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-red-700 inset-border"
              >
                Admin
              </Link>
            </div>
          )}

          <form
            onSubmit={onSubmit}
            className="machined-panel relative mt-4 overflow-hidden rounded-[2rem] p-6"
          >
            <svg
              className="pointer-events-none absolute inset-0 h-full w-full opacity-10"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <path
                d="M-10,50 Q40,20 100,50 T300,50"
                fill="none"
                stroke="#dc2626"
                strokeWidth="0.5"
              />
              <path
                d="M-10,92 Q60,132 150,92 T350,92"
                fill="none"
                stroke="#71717a"
                strokeWidth="0.5"
              />
            </svg>
            <div className="relative z-10 mb-6 flex items-start justify-between gap-4">
              <div>
                <div className="mb-1 flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-red-600 shadow-[0_0_10px_rgba(220,38,38,0.8)]" />
                  <span className="text-xs font-bold uppercase tracking-[0.2em] text-red-500">
                    Secure Channel
                  </span>
                </div>
                <div className="text-3xl font-black uppercase tracking-tight text-zinc-950">
                  Join Comms
                </div>
              </div>
              <div className="rounded-xl bg-zinc-100 p-2 text-zinc-600 inset-border">
                <LockIcon className="h-5 w-5" />
              </div>
            </div>

            <label className="relative z-10 block space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                Channel ID
              </span>
              <input
                type="text"
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                placeholder="general"
                className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-4 font-mono text-lg text-zinc-950 outline-none transition focus:border-red-600/60"
                autoFocus
                required
              />
            </label>

            <label className="relative z-10 mt-4 block space-y-2">
              <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                PIN
                <span className="text-zinc-600">Optional</span>
                {pin.trim() && <LockIcon className="h-3 w-3 text-red-500" />}
              </span>
              <input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Leave blank for public"
                className="w-full rounded-2xl border border-zinc-200 bg-white px-4 py-4 font-mono text-lg text-zinc-950 outline-none transition focus:border-red-600/60"
              />
            </label>

            <button
              type="submit"
              className="relative z-10 mt-6 w-full rounded-2xl bg-red-600 py-4 text-base font-black uppercase tracking-wider text-white shadow-[0_10px_20px_-5px_rgba(220,38,38,0.4)] transition active:scale-[0.98]"
            >
              {pin.trim() ? 'Join Private' : 'Connect'}
            </button>
          </form>

          <section className="mt-5 rounded-[2rem] bg-white/90 p-4 inset-border">
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
                  Contacts
                </h2>
                <p className="mt-1 text-xs text-zinc-500">
                  Save teammates for fast one-to-one calls.
                </p>
              </div>
              <span className="rounded-full bg-red-600/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-red-700">
                1:1
              </span>
            </div>
            {contacts.length > 0 && (
              <ul className="mb-4 space-y-2">
                {contacts.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center gap-3 rounded-2xl bg-white px-3 py-3 inset-border"
                  >
                    <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-red-600 text-sm font-black text-white">
                      {c.initials}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-zinc-950">
                        {c.name}
                      </span>
                      <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase text-zinc-500">
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${activityClass(
                            c.lastActiveAt,
                          )}`}
                        />
                        {activityLabel(c.lastActiveAt)}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => startDirectCall(c)}
                      className="rounded-full bg-red-600 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-white"
                    >
                      Call
                    </button>
                    <button
                      type="button"
                      onClick={() => removeContact(c.id)}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-100 text-xs text-zinc-500 transition hover:text-zinc-950"
                      aria-label={`Remove ${c.name}`}
                    >
                      x
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                type="search"
                value={directQuery}
                onChange={(e) => setDirectQuery(e.target.value)}
                placeholder="Search users to call or save"
                className="w-full rounded-2xl border border-zinc-200 bg-white py-4 pl-11 pr-4 text-sm text-zinc-950 outline-none transition focus:border-red-600/60"
              />
            </div>
            {directError && (
              <div className="mt-3 text-xs text-red-400">{directError}</div>
            )}
            <div className="mt-3 space-y-2">
              {directLoading && (
                <div className="rounded-2xl bg-white px-3 py-3 text-xs text-zinc-500 inset-border">
                  Searching users...
                </div>
              )}
              {!directLoading &&
                directQuery.trim().length >= 2 &&
                directUsers.length === 0 &&
                !directError && (
                  <div className="rounded-2xl bg-white px-3 py-3 text-xs text-zinc-500 inset-border">
                    No users found.
                  </div>
                )}
              {directUsers.map((u) => (
                <div
                  key={u.id}
                  className="flex w-full items-center gap-3 rounded-2xl bg-white px-3 py-3 text-left inset-border"
                >
                  <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-red-600 text-sm font-black text-white">
                    {u.initials}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-zinc-950">
                      {u.name}
                    </span>
                    {u.email && (
                      <span className="block truncate font-mono text-xs text-zinc-500">
                        {u.email}
                      </span>
                    )}
                    <span className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] uppercase text-zinc-500">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${activityClass(
                          u.lastActiveAt,
                        )}`}
                      />
                      {activityLabel(u.lastActiveAt)}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => addContact(u)}
                    className="rounded-full bg-zinc-100 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-zinc-700"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => startDirectCall(u)}
                    className="rounded-full bg-red-600 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-white"
                  >
                    Call
                  </button>
                </div>
              ))}
            </div>
          </section>

          {recent.length > 0 && (
            <section className="mt-7">
              <div className="mb-3 flex items-end justify-between px-2">
                <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
                  Recent Frequencies
                </h2>
                <span className="font-mono text-xs text-zinc-600">
                  {recent.length}
                </span>
              </div>
              <ul className="space-y-2">
                {recent.map((c) => (
                  <li
                    key={c.name}
                    className="group flex items-center gap-3 rounded-2xl px-3 py-3 transition hover:bg-zinc-100"
                  >
                    <button
                      onClick={() => clickRecent(c)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <span
                        className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl inset-border ${
                          c.private
                            ? 'bg-red-950/30 text-red-400'
                            : 'bg-zinc-100 text-zinc-600'
                        }`}
                      >
                        {c.private ? (
                          <LockIcon className="h-4 w-4" />
                        ) : (
                          <HashIcon className="h-4 w-4" />
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold text-zinc-800">
                          {c.name}
                        </span>
                        <span className="block font-mono text-xs text-zinc-500">
                          {relativeTime(c.lastJoinedAt)}
                        </span>
                      </span>
                    </button>
                    <button
                      onClick={() => dropRecent(c.name)}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-100 text-xs text-zinc-500 opacity-80 transition hover:text-zinc-800 sm:opacity-0 sm:group-hover:opacity-100"
                      aria-label={`Forget channel ${c.name}`}
                    >
                      x
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {incomingCalls.length > 0 && (
          <div className="absolute inset-0 z-50 flex flex-col justify-end">
            <div className="absolute inset-0 bg-zinc-950/35 backdrop-blur-sm" />
            <div className="relative rounded-t-[2.5rem] border-t border-red-200 bg-white p-6 shadow-[0_-20px_50px_rgba(24,24,27,0.16)]">
              <div className="mx-auto mb-5 h-1.5 w-12 rounded-full bg-zinc-300" />
              <div className="text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-600 text-xl font-black text-white">
                  {incomingCalls[0].initials}
                </div>
                <div className="mt-4 text-[10px] font-bold uppercase tracking-[0.22em] text-red-500">
                  Incoming Direct Call
                </div>
                <h2 className="mt-1 truncate text-2xl font-black tracking-tight text-zinc-950">
                  {incomingCalls[0].fromName}
                </h2>
                {incomingCalls[0].fromEmail && (
                  <p className="mt-1 truncate font-mono text-xs text-zinc-500">
                    {incomingCalls[0].fromEmail}
                  </p>
                )}
              </div>
              <div className="mt-6 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => declineCall(incomingCalls[0])}
                  className="rounded-2xl bg-zinc-200 py-4 text-sm font-bold text-zinc-800 shadow-tactile-up active:shadow-tactile-down"
                >
                  Decline
                </button>
                <button
                  type="button"
                  onClick={() => acceptCall(incomingCalls[0])}
                  className="rounded-2xl bg-red-600 py-4 text-sm font-black uppercase tracking-wider text-white shadow-[0_10px_20px_-5px_rgba(220,38,38,0.4)] active:scale-[0.98]"
                >
                  Answer
                </button>
              </div>
            </div>
          </div>
        )}

        {pinPrompt && (
          <div className="absolute inset-0 z-50 flex flex-col justify-end">
            <button
              type="button"
              aria-label="Close PIN prompt"
              onClick={() => setPinPrompt(null)}
              className="absolute inset-0 bg-zinc-950/35 backdrop-blur-sm"
            />
            <form
              onSubmit={submitPinPrompt}
              className="relative rounded-t-[2.5rem] border-t border-zinc-300/50 bg-white p-6 shadow-[0_-20px_50px_rgba(24,24,27,0.16)]"
            >
              <div className="mx-auto mb-6 h-1.5 w-12 rounded-full bg-zinc-300" />
              <div className="text-center">
                <h2 className="text-2xl font-black uppercase tracking-tight text-zinc-950">
                  #{pinPrompt.channel}
                </h2>
                <p className="mt-2 font-mono text-sm text-zinc-600">
                  Enter private channel PIN
                </p>
              </div>
              <input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                autoFocus
                value={pinPrompt.value}
                onChange={(e) =>
                  setPinPrompt({
                    ...pinPrompt,
                    value: e.target.value,
                    error: null,
                  })
                }
                placeholder="PIN"
                className="mt-8 w-full rounded-2xl border border-zinc-200 bg-white px-4 py-5 text-center font-mono text-2xl font-bold text-red-500 outline-none focus:border-red-600/60"
              />
              {pinPrompt.error && (
                <div className="mt-3 text-center text-xs text-red-400">
                  {pinPrompt.error}
                </div>
              )}
              <div className="mt-6 grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setPinPrompt(null)}
                  className="rounded-2xl bg-zinc-200 py-4 text-sm font-bold text-zinc-800 shadow-tactile-up active:shadow-tactile-down"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-2xl bg-red-600 py-4 text-sm font-black uppercase tracking-wider text-white shadow-[0_10px_20px_-5px_rgba(220,38,38,0.4)] active:scale-[0.98]"
                >
                  Join
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </main>
  );
}

function relativeTime(ts: number) {
  const diff = Date.now() - ts;
  const m = Math.round(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function activityLabel(ts: number | null) {
  if (!ts) return 'no activity';
  return relativeTime(ts);
}

function activityClass(ts: number | null) {
  if (!ts) return 'bg-zinc-300';
  const diff = Date.now() - ts;
  if (diff < 15 * 60_000) return 'bg-red-600';
  if (diff < 24 * 60 * 60_000) return 'bg-amber-400';
  return 'bg-zinc-300';
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 1 1 8 0v3" />
    </svg>
  );
}

function SettingsIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1A2 2 0 1 1 4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1A2 2 0 1 1 7.1 4.2l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 1 1 20 7.1l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.6 1h.1a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.8.8Z" />
    </svg>
  );
}

function HashIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4 9h16" />
      <path d="M4 15h16" />
      <path d="M10 3 8 21" />
      <path d="m16 3-2 18" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
