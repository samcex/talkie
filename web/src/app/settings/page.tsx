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
    <main className="min-h-dvh talkie-shell flex justify-center text-zinc-950">
      <div className="talkie-phone relative min-h-dvh w-full max-w-[430px] overflow-hidden bg-white px-4 py-10">
        <div className="talkie-noise" />
        <header className="relative z-10 flex items-center gap-3 rounded-[2rem] bg-white/95 p-4 inset-border">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 inset-border">
            <Logo size={34} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-red-500">
              Talkie
            </div>
            <h1 className="text-xl font-black tracking-tight text-zinc-950">
              Settings
            </h1>
          </div>
          <Link
            href="/"
            className="rounded-full bg-zinc-100 px-4 py-2 text-xs font-bold uppercase tracking-wider text-zinc-700 inset-border hover:text-zinc-950"
          >
            Back
          </Link>
        </header>

        <section className="machined-panel relative z-10 mt-5 rounded-[2rem] p-5">
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label htmlFor="vol" className="text-sm font-bold text-zinc-950">
                Output volume
              </label>
              <span className="font-mono text-xs text-zinc-500 tabular-nums">
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
              className="w-full accent-red-600"
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

        <section className="relative z-10 mt-5 rounded-[2rem] bg-white/90 p-5 text-xs leading-relaxed text-zinc-500 inset-border">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-red-500">
            About
          </div>
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
      className={`flex items-start gap-3 rounded-2xl bg-white/85 p-3 inset-border ${disabled ? 'opacity-50' : 'cursor-pointer'}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 accent-red-600"
      />
      <div className="flex-1">
        <div className="text-sm font-bold text-zinc-950">{label}</div>
        {description && (
          <div className="text-xs text-zinc-500">{description}</div>
        )}
      </div>
    </label>
  );
}
