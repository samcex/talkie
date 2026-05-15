'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';

export default function HomePage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [channel, setChannel] = useState('general');

  useEffect(() => {
    const stored = localStorage.getItem('talkie:name');
    if (stored) setName(stored);
  }, []);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !channel.trim()) return;
    localStorage.setItem('talkie:name', name.trim());
    const slug = channel.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
    router.push(`/channel/${slug}?name=${encodeURIComponent(name.trim())}`);
  }

  return (
    <main className="min-h-dvh flex items-center justify-center bg-neutral-950 text-neutral-100 px-6">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-6 bg-neutral-900 rounded-2xl p-8 border border-neutral-800"
      >
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Talkie</h1>
          <p className="text-sm text-neutral-400">
            Push-to-talk for teams. Hold the button to speak.
          </p>
        </div>

        <label className="block space-y-2">
          <span className="text-sm text-neutral-300">Your name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Samir"
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
    </main>
  );
}
