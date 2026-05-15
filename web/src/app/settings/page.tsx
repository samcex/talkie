'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Logo } from '@/components/Logo';
import {
  defaultSettings,
  loadSettings,
  saveSettings,
  type Settings,
} from '@/lib/settings';

export default function SettingsPage() {
  const [s, setS] = useState<Settings>(defaultSettings);
  const [notifPerm, setNotifPerm] = useState<NotificationPermission | 'unsupported'>(
    'unsupported',
  );

  useEffect(() => {
    setS(loadSettings());
    if (typeof Notification !== 'undefined') {
      setNotifPerm(Notification.permission);
    }
  }, []);

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    const next = { ...s, [key]: value };
    setS(next);
    saveSettings(next);
  }

  async function requestNotificationPermission() {
    if (typeof Notification === 'undefined') return;
    const result = await Notification.requestPermission();
    setNotifPerm(result);
    if (result === 'granted') update('notifications', true);
  }

  return (
    <main className="min-h-dvh bg-neutral-950 text-neutral-100 px-6 py-10">
      <div className="w-full max-w-sm mx-auto space-y-6">
        <header className="flex items-center gap-3">
          <Logo size={36} />
          <h1 className="text-xl font-semibold flex-1">Settings</h1>
          <Link
            href="/"
            className="text-xs text-neutral-400 hover:text-neutral-100"
          >
            Back
          </Link>
        </header>

        <section className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 space-y-5">
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label htmlFor="vol" className="text-sm">
                Output volume
              </label>
              <span className="text-xs text-neutral-400 tabular-nums">
                {Math.round(s.outputVolume * 100)}%
              </span>
            </div>
            <input
              id="vol"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={s.outputVolume}
              onChange={(e) => update('outputVolume', Number(e.target.value))}
              className="w-full accent-emerald-500"
            />
          </div>

          <Toggle
            label="Beep on incoming"
            description="Short tone when someone starts talking"
            checked={s.beepOnIncoming}
            onChange={(v) => update('beepOnIncoming', v)}
          />

          <Toggle
            label="Vibrate on incoming"
            description="Phone-only; ignored if the device has no vibrator"
            checked={s.vibrate}
            onChange={(v) => update('vibrate', v)}
          />

          <div className="space-y-2">
            <Toggle
              label="Browser notifications"
              description={
                notifPerm === 'unsupported'
                  ? 'Not supported in this browser'
                  : notifPerm === 'denied'
                    ? 'Blocked in browser permissions'
                    : 'Show a notification when someone speaks in a backgrounded tab'
              }
              checked={s.notifications && notifPerm === 'granted'}
              disabled={notifPerm === 'denied' || notifPerm === 'unsupported'}
              onChange={(v) => {
                if (v && notifPerm === 'default') {
                  requestNotificationPermission();
                } else {
                  update('notifications', v);
                }
              }}
            />
          </div>
        </section>

        <section className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 space-y-3 text-xs text-neutral-400">
          <div className="font-semibold text-neutral-300">About</div>
          <div>
            Talkie is a push-to-talk app. Audio is routed through LiveKit; nothing
            is recorded server-side. Voice message replays are stored only in your
            browser and disappear when you leave the channel.
          </div>
        </section>
      </div>
    </main>
  );
}

function Toggle({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      className={`flex items-start gap-3 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 accent-emerald-500"
      />
      <div className="flex-1">
        <div className="text-sm">{label}</div>
        {description && (
          <div className="text-xs text-neutral-500">{description}</div>
        )}
      </div>
    </label>
  );
}
