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

type DirectUser = {
  id: string;
  name: string;
  email: string;
  initials: string;
};

export default function HomePage() {
  const router = useRouter();
  const { user, isLoaded } = useUser();
  const [channel, setChannel] = useState('general');
  const [pin, setPin] = useState('');
  const [recent, setRecent] = useState<RecentChannel[]>([]);
  const [pinPrompt, setPinPrompt] = useState<{
    channel: string;
    value: string;
    error: string | null;
  } | null>(null);
  const [directQuery, setDirectQuery] = useState('');
  const [directUsers, setDirectUsers] = useState<DirectUser[]>([]);
  const [directLoading, setDirectLoading] = useState(false);
  const [directError, setDirectError] = useState<string | null>(null);

  useEffect(() => {
    setRecent(getRecentChannels());
  }, []);

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

  function startDirectCall(target: DirectUser) {
    router.push(
      `/channel/direct?peer=${encodeURIComponent(target.id)}&title=${encodeURIComponent(
        target.name,
      )}`,
    );
  }

  const greetingName =
    user?.firstName || user?.username || user?.emailAddresses[0]?.emailAddress;

  return (
    <main className="min-h-dvh talkie-shell flex justify-center text-zinc-100">
      <div className="talkie-phone relative flex min-h-dvh w-full max-w-[430px] flex-col overflow-hidden bg-zinc-950">
        <div className="talkie-noise" />
        <header className="glass-panel relative z-10 flex items-center justify-between rounded-b-[2rem] px-5 pb-4 pt-10">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-900 inset-border">
              <Logo size={34} />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500">
                Callsign
              </div>
              <h1 className="truncate text-xl font-black tracking-tight text-white">
                {isLoaded && greetingName ? greetingName : 'Talkie'}
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <Link
                href="/admin"
                className="rounded-full bg-emerald-500/10 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-emerald-300 inset-border"
              >
                Admin
              </Link>
            )}
            <Link
              href="/settings"
              aria-label="Settings"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-900 text-zinc-400 transition active:scale-95 inset-border hover:text-white"
            >
              <SettingsIcon className="h-4 w-4" />
            </Link>
            <UserButton appearance={{ elements: { avatarBox: 'w-9 h-9' } }} />
          </div>
        </header>

        <div className="relative z-10 flex-1 overflow-y-auto no-scrollbar px-4 pb-8 pt-5">
          <IOSInstallHint />

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
                stroke="#10b981"
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
                  <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]" />
                  <span className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-400">
                    Secure Channel
                  </span>
                </div>
                <div className="text-3xl font-black uppercase tracking-tight text-white">
                  Join Comms
                </div>
              </div>
              <div className="rounded-xl bg-zinc-800/80 p-2 text-zinc-400 inset-border">
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
                className="w-full rounded-2xl border border-white/10 bg-zinc-950 px-4 py-4 font-mono text-lg text-white outline-none transition focus:border-emerald-500/60"
                autoFocus
                required
              />
            </label>

            <label className="relative z-10 mt-4 block space-y-2">
              <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                PIN
                <span className="text-zinc-600">Optional</span>
                {pin.trim() && <LockIcon className="h-3 w-3 text-emerald-400" />}
              </span>
              <input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Leave blank for public"
                className="w-full rounded-2xl border border-white/10 bg-zinc-950 px-4 py-4 font-mono text-lg text-white outline-none transition focus:border-emerald-500/60"
              />
            </label>

            <button
              type="submit"
              className="relative z-10 mt-6 w-full rounded-2xl bg-emerald-500 py-4 text-base font-black uppercase tracking-wider text-black shadow-[0_10px_20px_-5px_rgba(16,185,129,0.4)] transition active:scale-[0.98]"
            >
              {pin.trim() ? 'Join Private' : 'Connect'}
            </button>
          </form>

          <section className="mt-5 rounded-[2rem] bg-zinc-900/60 p-4 inset-border">
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-500">
                  Direct Call
                </h2>
                <p className="mt-1 text-xs text-zinc-500">
                  Search a teammate and open a private one-to-one channel.
                </p>
              </div>
              <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                1:1
              </span>
            </div>
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <input
                type="search"
                value={directQuery}
                onChange={(e) => setDirectQuery(e.target.value)}
                placeholder="Search by name or email"
                className="w-full rounded-2xl border border-white/10 bg-zinc-950 py-4 pl-11 pr-4 text-sm text-white outline-none transition focus:border-emerald-500/60"
              />
            </div>
            {directError && (
              <div className="mt-3 text-xs text-red-400">{directError}</div>
            )}
            <div className="mt-3 space-y-2">
              {directLoading && (
                <div className="rounded-2xl bg-zinc-950 px-3 py-3 text-xs text-zinc-500 inset-border">
                  Searching users...
                </div>
              )}
              {!directLoading &&
                directQuery.trim().length >= 2 &&
                directUsers.length === 0 &&
                !directError && (
                  <div className="rounded-2xl bg-zinc-950 px-3 py-3 text-xs text-zinc-500 inset-border">
                    No users found.
                  </div>
                )}
              {directUsers.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => startDirectCall(u)}
                  className="flex w-full items-center gap-3 rounded-2xl bg-zinc-950 px-3 py-3 text-left transition active:scale-[0.99] inset-border hover:bg-zinc-900"
                >
                  <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500 text-sm font-black text-black">
                    {u.initials}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-zinc-100">
                      {u.name}
                    </span>
                    {u.email && (
                      <span className="block truncate font-mono text-xs text-zinc-500">
                        {u.email}
                      </span>
                    )}
                  </span>
                  <span className="rounded-full bg-emerald-500 px-3 py-2 text-[10px] font-black uppercase tracking-wider text-black">
                    Call
                  </span>
                </button>
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
                    className="group flex items-center gap-3 rounded-2xl px-3 py-3 transition hover:bg-zinc-900"
                  >
                    <button
                      onClick={() => clickRecent(c)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <span
                        className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl inset-border ${
                          c.private
                            ? 'bg-red-950/30 text-red-400'
                            : 'bg-zinc-900 text-zinc-400'
                        }`}
                      >
                        {c.private ? (
                          <LockIcon className="h-4 w-4" />
                        ) : (
                          <HashIcon className="h-4 w-4" />
                        )}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold text-zinc-200">
                          {c.name}
                        </span>
                        <span className="block font-mono text-xs text-zinc-500">
                          {relativeTime(c.lastJoinedAt)}
                        </span>
                      </span>
                    </button>
                    <button
                      onClick={() => dropRecent(c.name)}
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-900 text-xs text-zinc-500 opacity-80 transition hover:text-zinc-200 sm:opacity-0 sm:group-hover:opacity-100"
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

        {pinPrompt && (
          <div className="absolute inset-0 z-50 flex flex-col justify-end">
            <button
              type="button"
              aria-label="Close PIN prompt"
              onClick={() => setPinPrompt(null)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <form
              onSubmit={submitPinPrompt}
              className="relative rounded-t-[2.5rem] border-t border-zinc-700/50 bg-zinc-900 p-6 shadow-[0_-20px_50px_rgba(0,0,0,0.5)]"
            >
              <div className="mx-auto mb-6 h-1.5 w-12 rounded-full bg-zinc-700" />
              <div className="text-center">
                <h2 className="text-2xl font-black uppercase tracking-tight text-white">
                  #{pinPrompt.channel}
                </h2>
                <p className="mt-2 font-mono text-sm text-zinc-400">
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
                className="mt-8 w-full rounded-2xl border border-white/10 bg-zinc-950 px-4 py-5 text-center font-mono text-2xl font-bold text-emerald-400 outline-none focus:border-emerald-500/60"
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
                  className="rounded-2xl bg-zinc-800 py-4 text-sm font-bold text-zinc-200 shadow-tactile-up active:shadow-tactile-down"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-2xl bg-emerald-500 py-4 text-sm font-black uppercase tracking-wider text-black shadow-[0_10px_20px_-5px_rgba(16,185,129,0.4)] active:scale-[0.98]"
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
