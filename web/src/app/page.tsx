'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { Logo } from '@/components/Logo';
import {
  forgetChannel,
  getRecentChannels,
  type RecentChannel,
} from '@/lib/recent-channels';

export default function HomePage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [channel, setChannel] = useState('general');
  const [recent, setRecent] = useState<RecentChannel[]>([]);

  useEffect(() => {
    const storedName = localStorage.getItem('talkie:name');
    if (storedName) setName(storedName);
    setRecent(getRecentChannels());
  }, []);

  function go(targetChannel: string, displayName: string) {
    const cleanName = displayName.trim();
    const slug = targetChannel.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    if (!cleanName || !slug) return;
    localStorage.setItem('talkie:name', cleanName);
    router.push(`/channel/${slug}?name=${encodeURIComponent(cleanName)}`);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    go(channel, name);
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

          <button
            type="submit"
            className="w-full rounded-lg bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 transition text-neutral-950 font-semibold py-3"
          >
            Connect
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
                    onClick={() => go(c.name, name)}
                    disabled={!name.trim()}
                    className="flex-1 text-left text-sm hover:text-emerald-300 disabled:text-neutral-500"
                  >
                    #{c.name}
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
