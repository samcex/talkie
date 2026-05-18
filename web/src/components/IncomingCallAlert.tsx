'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import { useCallback, useEffect, useRef, useState } from 'react';
import { saveContact } from '@/lib/contacts';
import { defaultSettings, loadSettings, type Settings } from '@/lib/settings';

type IncomingCall = {
  id: string;
  fromUserId: string;
  fromName: string;
  fromEmail: string;
  initials: string;
  createdAt: number;
  expiresAt: number;
};

export function IncomingCallAlert() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isLoaded } = useUser();
  const [incomingCalls, setIncomingCalls] = useState<IncomingCall[]>([]);
  const settingsRef = useRef<Settings>(defaultSettings);
  const ringCtxRef = useRef<AudioContext | null>(null);
  const notifiedCallIdsRef = useRef<Set<string>>(new Set());
  const previousTitleRef = useRef<string | null>(null);

  useEffect(() => {
    settingsRef.current = loadSettings();
  }, []);

  const playIncomingCallTone = useCallback(() => {
    if (!settingsRef.current.beepOnIncoming) return;
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctx) return;
      if (!ringCtxRef.current) ringCtxRef.current = new Ctx();
      const ctx = ringCtxRef.current;
      if (ctx.state === 'suspended') void ctx.resume();

      const now = ctx.currentTime;
      [0, 0.26].forEach((offset) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 740;
        gain.gain.value = 0.001;
        osc.connect(gain).connect(ctx.destination);
        gain.gain.exponentialRampToValueAtTime(0.18, now + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.2);
        osc.start(now + offset);
        osc.stop(now + offset + 0.22);
      });
    } catch {}
  }, []);

  const vibrateForCall = useCallback(() => {
    if (!settingsRef.current.vibrate) return;
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate([160, 80, 160]);
    }
  }, []);

  const notifyIncomingCall = useCallback((call: IncomingCall) => {
    if (!settingsRef.current.notifications) return;
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'granted') return;
    try {
      const notification = new Notification('Incoming Talkie call', {
        body: `${call.fromName} is calling`,
        tag: `talkie-call-${call.id}`,
        requireInteraction: true,
      });
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
    } catch {}
  }, []);

  useEffect(() => {
    if (!isLoaded || !user) return;
    if (pathname?.startsWith('/sign-in') || pathname?.startsWith('/sign-up')) {
      return;
    }

    let cancelled = false;
    let timer: number | undefined;
    let source: EventSource | undefined;

    async function loadCalls() {
      try {
        const res = await fetch('/api/calls', { cache: 'no-store' });
        if (!res.ok) return;
        const body = (await res.json()) as { calls?: IncomingCall[] };
        if (!cancelled) setIncomingCalls(body.calls ?? []);
      } catch {}
    }

    function startPolling() {
      if (timer) return;
      loadCalls();
      timer = window.setInterval(loadCalls, 4000);
    }

    if (typeof EventSource === 'undefined') {
      startPolling();
    } else {
      source = new EventSource('/api/calls/stream');
      source.addEventListener('calls', (event) => {
        try {
          const body = JSON.parse(event.data) as { calls?: IncomingCall[] };
          if (!cancelled) setIncomingCalls(body.calls ?? []);
        } catch {}
      });
      source.onerror = () => {
        source?.close();
        source = undefined;
        startPolling();
      };
    }

    return () => {
      cancelled = true;
      source?.close();
      if (timer) window.clearInterval(timer);
    };
  }, [isLoaded, pathname, user]);

  useEffect(() => {
    const call = incomingCalls[0];
    if (!call) {
      if (previousTitleRef.current) {
        document.title = previousTitleRef.current;
        previousTitleRef.current = null;
      }
      return;
    }

    if (!previousTitleRef.current) previousTitleRef.current = document.title;

    if (!notifiedCallIdsRef.current.has(call.id)) {
      notifiedCallIdsRef.current.add(call.id);
      playIncomingCallTone();
      vibrateForCall();
      notifyIncomingCall(call);
    }

    let flash = false;
    document.title = `Incoming call from ${call.fromName}`;
    const titleTimer = window.setInterval(() => {
      flash = !flash;
      document.title = flash
        ? `Incoming call from ${call.fromName}`
        : previousTitleRef.current ?? 'Talkie';
    }, 900);
    const ringTimer = window.setInterval(playIncomingCallTone, 1800);
    const vibrateTimer = window.setInterval(vibrateForCall, 3000);

    return () => {
      window.clearInterval(titleTimer);
      window.clearInterval(ringTimer);
      window.clearInterval(vibrateTimer);
      if (previousTitleRef.current) document.title = previousTitleRef.current;
    };
  }, [incomingCalls, notifyIncomingCall, playIncomingCallTone, vibrateForCall]);

  async function acceptCall(call: IncomingCall) {
    await fetch(
      `/api/calls?id=${encodeURIComponent(call.id)}&status=accepted`,
      {
        method: 'DELETE',
      },
    ).catch(() => {});
    setIncomingCalls((prev) => prev.filter((c) => c.id !== call.id));
    saveContact({
      id: call.fromUserId,
      name: call.fromName,
      email: call.fromEmail,
      initials: call.initials,
      lastActiveAt: call.createdAt,
    });
    router.push(
      `/channel/direct?peer=${encodeURIComponent(call.fromUserId)}&title=${encodeURIComponent(
        call.fromName,
      )}`,
    );
  }

  async function declineCall(call: IncomingCall) {
    await fetch(
      `/api/calls?id=${encodeURIComponent(call.id)}&status=declined`,
      {
        method: 'DELETE',
      },
    ).catch(() => {});
    setIncomingCalls((prev) => prev.filter((c) => c.id !== call.id));
  }

  if (incomingCalls.length === 0) return null;

  const call = incomingCalls[0];

  return (
    <div className="fixed inset-0 z-[100] flex flex-col justify-end">
      <div className="incoming-call-backdrop absolute inset-0" />
      <div className="absolute left-4 right-4 top-10 rounded-3xl bg-red-600 px-4 py-3 text-center text-sm font-black uppercase tracking-[0.22em] text-white shadow-[0_18px_40px_rgba(220,38,38,0.35)]">
        Incoming Call
      </div>
      <div className="incoming-call-sheet relative mx-auto w-full max-w-[430px] rounded-t-[2.5rem] border-t border-red-200 bg-white p-6 shadow-[0_-20px_60px_rgba(24,24,27,0.22)]">
        <div className="mx-auto mb-5 h-1.5 w-12 rounded-full bg-red-200" />
        <div className="text-center">
          <div className="incoming-call-avatar mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-red-600 text-3xl font-black text-white">
            <span>{call.initials}</span>
          </div>
          <div className="mt-4 text-[10px] font-bold uppercase tracking-[0.22em] text-red-500">
            Incoming Direct Call
          </div>
          <h2 className="mt-1 truncate text-4xl font-black tracking-tight text-zinc-950">
            {call.fromName}
          </h2>
          {call.fromEmail && (
            <p className="mt-1 truncate font-mono text-xs text-zinc-500">
              {call.fromEmail}
            </p>
          )}
          {incomingCalls.length > 1 && (
            <p className="mt-3 text-xs font-bold uppercase tracking-wider text-red-500">
              +{incomingCalls.length - 1} more waiting
            </p>
          )}
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => declineCall(call)}
            className="rounded-2xl bg-zinc-200 py-5 text-base font-bold text-zinc-800 shadow-tactile-up active:shadow-tactile-down"
          >
            Decline
          </button>
          <button
            type="button"
            onClick={() => acceptCall(call)}
            className="rounded-2xl bg-red-600 py-5 text-base font-black uppercase tracking-wider text-white shadow-[0_14px_28px_-6px_rgba(220,38,38,0.5)] active:scale-[0.98]"
          >
            Answer
          </button>
        </div>
      </div>
    </div>
  );
}
