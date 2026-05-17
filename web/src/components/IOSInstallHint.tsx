'use client';

import { useEffect, useState } from 'react';

const KEY = 'talkie:ios-hint-dismissed';

export function IOSInstallHint() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const ua = window.navigator.userAgent;
    const isIOS = /iPhone|iPad|iPod/.test(ua) && !/Android/.test(ua);
    if (!isIOS) return;
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone ===
        true;
    if (isStandalone) return;
    if (sessionStorage.getItem(KEY) === '1') return;
    setShow(true);
  }, []);

  if (!show) return null;

  return (
    <div className="rounded-2xl bg-neutral-900 border border-red-700/50 p-4 text-xs space-y-2 relative">
      <button
        onClick={() => {
          setShow(false);
          sessionStorage.setItem(KEY, '1');
        }}
        aria-label="Dismiss"
        className="absolute top-2 right-2 text-neutral-500 hover:text-neutral-200 text-sm"
      >
        ✕
      </button>
      <div className="flex items-center gap-2 text-red-300 font-semibold">
        <ShareIcon className="w-3.5 h-3.5" />
        Tip for iPhone
      </div>
      <div className="text-neutral-300 leading-relaxed pr-5">
        Safari asks for microphone permission on every refresh. To fix it,
        install Talkie as an app: tap the <ShareIcon className="inline w-3 h-3 mb-0.5" /> Share
        button below, then{' '}
        <span className="text-red-300 font-medium">Add to Home Screen</span>.
        Open Talkie from your home screen and the mic prompt only appears once.
      </div>
    </div>
  );
}

function ShareIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 3v12" />
      <path d="m7 8 5-5 5 5" />
      <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </svg>
  );
}
