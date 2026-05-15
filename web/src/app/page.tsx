'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { Logo } from '@/components/Logo';
import { IOSInstallHint } from '@/components/IOSInstallHint';
import {
  forgetChannel,
  getRecentChannels,
  type RecentChannel,
} from '@/lib/recent-channels';
import { setChannelPin } from '@/lib/channel-pin';

export default function HomePage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [channel, setChannel] = useState('general');
  const [pin, setPin] = useState('');
  const [recent, setRecent] = useState<RecentChannel[]>([]);
  const [pinPrompt, setPinPrompt] = useState<{
    channel: string;
    value: string;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    const storedName = localStorage.getItem('talkie:name');
    if (storedName) setName(storedName);
    setRecent(getRecentChannels());
  }, []);

  function go(targetChannel: string, displayName: string, pinValue: string) {
    const cleanName = displayName.trim();
    const slug = targetChannel.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    if (!cleanName || !slug) return;
    localStorage.setItem('talkie:name', cleanName);
    const cleanPin = pinValue.trim();
    if (cleanPin) {
      setChannelPin(slug, cleanPin);
      router.push(
        `/channel/${slug}?name=${encodeURIComponent(cleanName)}&private=1`,
      );
    } else {
      router.push(`/channel/${slug}?name=${encodeURIComponent(cleanName)}`);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    go(channel, name, pin);
  }

  function clickRecent(c: RecentChannel) {
    if (!name.trim()) return;
    if (c.private) {
      setPinPrompt({ channel: c.name, value: '', error: null });
    } else {
      go(c.name, name, '');
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
    go(target, name, value);
  }

  function dropRecent(target: string) {
    forgetChannel(target);
    setRecent(getRecentChannels());
  }

  return (
    <main className="min-h-dvh flex items-center justify-center bg-neutral-950 text-neutral-100 px-6 py-10">
      <div className="w-full max-w-sm space-y-6">
        <header className="flex items-center gap-3">
          <Logo size={44} />
          <div>
            <h1 className="text-2xl font-semibold leading-tight">Talkie</h1>
            <p className="text-xs text-neutral-400">
              Push-to-talk for teams
            </p>
          </div>
          <Link
            href="/settings"
            className="ml-auto text-xs text-neutral-400 hover:text-neutral-100 underline-offset-2 hover:underline"
          >
            Settings
          </Link>
        </header>

        <IOSInstallHint />

        <form
          onSubmit={onSubmit}
          className="space-y-5 bg-neutral-900 rounded-2xl p-6 border border-neutral-800"
        >
          <label className="block space-y-2">
            <span className="text-sm text-neutral-300">Your name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sam"
              className="w-full rounded-lg bg-neutral-800 border border-neutral-700 px-3 py-2 text-base outline-none focus:border-neutral-500"
              autoFocus
              required
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm text-neutral-300">Channel</span>
            <input
              type="text"
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              placeholder="general"
              className="w-full rounded-lg bg-neutral-800 border border-neutral-700 px-3 py-2 text-base outline-none focus:border-neutral-500"
              required
            />
          </label>

          <label className="block space-y-2">
            <span className="text-sm text-neutral-300 flex items-center gap-2">
              PIN <span className="text-neutral-500 text-xs">(optional)</span>
              {pin.trim() && <LockIcon className="w-3 h-3 text-emerald-400" />}
            </span>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="Leave blank for public"
              className="w-full rounded-lg bg-neutral-800 border border-neutral-700 px-3 py-2 text-base outline-none focus:border-neutral-500"
            />
            <p className="text-[11px] text-neutral-500">
              Set a PIN to make this channel private — only people with the same
              PIN can join.
            </p>
          </label>

          <button
            type="submit"
            className="w-full rounded-lg bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 transition text-neutral-950 font-semibold py-3"
          >
            {pin.trim() ? 'Join private channel' : 'Connect'}
          </button>
        </form>

        {recent.length > 0 && (
          <section>
            <div className="text-xs uppercase tracking-wider text-neutral-500 mb-2 px-1">
              Recent channels
            </div>
            <ul className="space-y-1">
              {recent.map((c) => (
                <li
                  key={c.name}
                  className="flex items-center gap-2 rounded-lg bg-neutral-900 border border-neutral-800 px-3 py-2"
                >
                  <button
                    onClick={() => clickRecent(c)}
                    disabled={!name.trim()}
                    className="flex-1 text-left text-sm hover:text-emerald-300 disabled:text-neutral-500 flex items-center gap-2"
                  >
                    {c.private && (
                      <LockIcon className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                    )}
                    <span className="truncate">#{c.name}</span>
                  </button>
                  <span className="text-xs text-neutral-500">
                    {relativeTime(c.lastJoinedAt)}
                  </span>
                  <button
                    onClick={() => dropRecent(c.name)}
                    className="text-neutral-600 hover:text-neutral-300 text-xs px-1"
                    aria-label={`Forget channel ${c.name}`}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {pinPrompt && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center px-6 z-50">
          <form
            onSubmit={submitPinPrompt}
            className="w-full max-w-xs bg-neutral-900 border border-neutral-800 rounded-2xl p-6 space-y-4"
          >
            <div className="flex items-center gap-2">
              <LockIcon className="w-4 h-4 text-emerald-400" />
              <h2 className="text-base font-semibold">
                #{pinPrompt.channel}
              </h2>
            </div>
            <p className="text-xs text-neutral-400">
              This channel is private. Enter the PIN to join.
            </p>
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
              className="w-full rounded-lg bg-neutral-800 border border-neutral-700 px-3 py-2 text-base outline-none focus:border-neutral-500"
            />
            {pinPrompt.error && (
              <div className="text-xs text-red-400">{pinPrompt.error}</div>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPinPrompt(null)}
                className="flex-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-sm py-2"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-semibold text-sm py-2"
              >
                Join
              </button>
            </div>
          </form>
        </div>
      )}
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
