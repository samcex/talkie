'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ConnectionState,
  LocalAudioTrack,
  Room,
  RoomEvent,
  RemoteAudioTrack,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  Track,
  createLocalAudioTrack,
} from 'livekit-client';
import { useUser } from '@clerk/nextjs';
import { Logo } from '@/components/Logo';
import { rememberChannel } from '@/lib/recent-channels';
import { defaultSettings, loadSettings, type Settings } from '@/lib/settings';
import { getChannelPin } from '@/lib/channel-pin';

type ParticipantUi = {
  identity: string;
  isLocal: boolean;
  isSpeaking: boolean;
  volume: number;
  muted: boolean;
};

type ChatMessage = {
  id: string;
  from: string;
  text: string;
  ts: number;
};

type Replay = {
  id: string;
  from: string;
  ts: number;
  durationMs: number;
  url: string;
};

type DataPayload = { type: 'chat'; text: string; from: string; ts: number };

const MAX_REPLAYS = 30;
const MAX_REPLAY_MS = 60_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export default function ChannelPage() {
  const params = useParams<{ name: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { user, isLoaded } = useUser();
  const channelName = params?.name ?? 'general';
  const userName =
    user?.fullName ||
    user?.username ||
    user?.firstName ||
    user?.emailAddresses[0]?.emailAddress ||
    '';
  const userId = user?.id ?? '';
  const isPrivate = search.get('private') === '1';

  const roomRef = useRef<Room | null>(null);
  const localTrackRef = useRef<LocalAudioTrack | null>(null);
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const remoteTracksRef = useRef<Map<string, RemoteAudioTrack>>(new Map());
  const recordersRef = useRef<
    Map<
      string,
      {
        recorder: MediaRecorder;
        chunks: BlobPart[];
        startedAt: number;
        mimeType: string;
      }
    >
  >(new Map());
  const settingsRef = useRef<Settings>(defaultSettings);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const beepCtxRef = useRef<AudioContext | null>(null);

  const [state, setState] = useState<ConnectionState>(
    ConnectionState.Disconnected,
  );
  const [participants, setParticipants] = useState<ParticipantUi[]>([]);
  const [transmitting, setTransmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'people' | 'chat' | 'replays'>('people');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [replays, setReplays] = useState<Replay[]>([]);
  const [draft, setDraft] = useState('');
  const [unreadChat, setUnreadChat] = useState(0);
  const [unreadReplays, setUnreadReplays] = useState(0);

  const refreshParticipants = useCallback((room: Room) => {
    const list: ParticipantUi[] = [];
    list.push({
      identity: room.localParticipant.identity,
      isLocal: true,
      isSpeaking: room.localParticipant.isSpeaking,
      volume: 1,
      muted: false,
    });
    room.remoteParticipants.forEach((p) => {
      const existing = participantStateRef.current.get(p.identity);
      list.push({
        identity: p.identity,
        isLocal: false,
        isSpeaking: p.isSpeaking,
        volume: existing?.volume ?? settingsRef.current.outputVolume,
        muted: existing?.muted ?? false,
      });
    });
    setParticipants(list);
  }, []);

  const participantStateRef = useRef<
    Map<string, { volume: number; muted: boolean }>
  >(new Map());

  const beep = useCallback(() => {
    if (!settingsRef.current.beepOnIncoming) return;
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctx) return;
      if (!beepCtxRef.current) beepCtxRef.current = new Ctx();
      const ctx = beepCtxRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.value = 0.001;
      osc.connect(gain).connect(ctx.destination);
      const now = ctx.currentTime;
      gain.gain.exponentialRampToValueAtTime(0.15, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.start(now);
      osc.stop(now + 0.2);
    } catch {}
  }, []);

  const vibrate = useCallback(() => {
    if (!settingsRef.current.vibrate) return;
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(40);
    }
  }, []);

  const maybeNotify = useCallback((from: string) => {
    if (!settingsRef.current.notifications) return;
    if (typeof document === 'undefined') return;
    if (!document.hidden) return;
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'granted') return;
    try {
      new Notification('Talkie', { body: `${from} is speaking`, silent: true });
    } catch {}
  }, []);

  const handleSpeakingChange = useCallback(
    (identity: string, isSpeaking: boolean) => {
      const room = roomRef.current;
      if (!room) return;

      if (isSpeaking) {
        const track = remoteTracksRef.current.get(identity);
        if (track && !recordersRef.current.has(identity)) {
          startRecording(identity, track);
        }
        beep();
        vibrate();
        maybeNotify(identity);
      } else {
        finishRecording(identity);
      }
      refreshParticipants(room);
    },
    [beep, vibrate, maybeNotify, refreshParticipants],
  );

  const startRecording = useCallback(
    (identity: string, track: RemoteAudioTrack) => {
      const msTrack = track.mediaStreamTrack;
      if (!msTrack) return;
      const stream = new MediaStream([msTrack]);
      const mimeType =
        MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : MediaRecorder.isTypeSupported('audio/webm')
            ? 'audio/webm'
            : '';
      let recorder: MediaRecorder;
      try {
        recorder = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);
      } catch {
        return;
      }
      const entry = {
        recorder,
        chunks: [] as BlobPart[],
        startedAt: Date.now(),
        mimeType: recorder.mimeType || mimeType || 'audio/webm',
      };
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) entry.chunks.push(e.data);
      };
      recorder.onstop = () => {
        const durationMs = Date.now() - entry.startedAt;
        if (durationMs < 350) return;
        const blob = new Blob(entry.chunks, { type: entry.mimeType });
        const url = URL.createObjectURL(blob);
        setReplays((prev) => {
          const next: Replay[] = [
            { id: cryptoRandom(), from: identity, ts: entry.startedAt, durationMs, url },
            ...prev,
          ];
          while (next.length > MAX_REPLAYS) {
            const dropped = next.pop();
            if (dropped) URL.revokeObjectURL(dropped.url);
          }
          return next;
        });
        setTab((t) => {
          if (t !== 'replays') setUnreadReplays((u) => u + 1);
          return t;
        });
      };
      recordersRef.current.set(identity, entry);
      recorder.start();
      window.setTimeout(() => {
        const live = recordersRef.current.get(identity);
        if (live && live === entry && recorder.state === 'recording') {
          recorder.stop();
          recordersRef.current.delete(identity);
        }
      }, MAX_REPLAY_MS);
    },
    [],
  );

  const finishRecording = useCallback((identity: string) => {
    const entry = recordersRef.current.get(identity);
    if (!entry) return;
    recordersRef.current.delete(identity);
    if (entry.recorder.state !== 'inactive') {
      try {
        entry.recorder.stop();
      } catch {}
    }
  }, []);

  useEffect(() => {
    settingsRef.current = loadSettings();
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    if (!userId) {
      router.replace('/sign-in');
      return;
    }

    let cancelled = false;
    const room = new Room({ adaptiveStream: true, dynacast: true });
    roomRef.current = room;

    room
      .on(RoomEvent.ConnectionStateChanged, (s) => {
        setState(s);
        if (s === ConnectionState.Connected) {
          rememberChannel(channelName, isPrivate);
        }
      })
      .on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => {
        p.on('isSpeakingChanged', (speaking) =>
          handleSpeakingChange(p.identity, speaking),
        );
        refreshParticipants(room);
      })
      .on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
        finishRecording(p.identity);
        participantStateRef.current.delete(p.identity);
        refreshParticipants(room);
      })
      .on(
        RoomEvent.TrackSubscribed,
        (
          track: RemoteTrack,
          _pub: RemoteTrackPublication,
          participant: RemoteParticipant,
        ) => {
          if (track.kind === Track.Kind.Audio) {
            const el = track.attach() as HTMLAudioElement;
            el.autoplay = true;
            el.style.display = 'none';
            document.body.appendChild(el);
            audioElementsRef.current.set(participant.identity, el);
            remoteTracksRef.current.set(
              participant.identity,
              track as RemoteAudioTrack,
            );
            const stateEntry = participantStateRef.current.get(
              participant.identity,
            ) ?? {
              volume: settingsRef.current.outputVolume,
              muted: false,
            };
            participantStateRef.current.set(participant.identity, stateEntry);
            applyVolume(
              track as RemoteAudioTrack,
              stateEntry.muted ? 0 : stateEntry.volume,
            );
          }
        },
      )
      .on(
        RoomEvent.TrackUnsubscribed,
        (
          track: RemoteTrack,
          _pub: RemoteTrackPublication,
          participant: RemoteParticipant,
        ) => {
          if (track.kind === Track.Kind.Audio) {
            track.detach().forEach((el) => el.remove());
            audioElementsRef.current.delete(participant.identity);
            remoteTracksRef.current.delete(participant.identity);
            finishRecording(participant.identity);
          }
        },
      )
      .on(
        RoomEvent.DataReceived,
        (payload: Uint8Array, participant?: RemoteParticipant) => {
          try {
            const parsed = JSON.parse(decoder.decode(payload)) as DataPayload;
            if (parsed.type === 'chat' && typeof parsed.text === 'string') {
              const from = participant?.identity ?? parsed.from ?? '(unknown)';
              if (from === userId) {
                // echo of our own message (we add locally on send); skip
                return;
              }
              setMessages((prev) => [
                ...prev,
                {
                  id: cryptoRandom(),
                  from: parsed.from || from,
                  text: parsed.text,
                  ts: parsed.ts ?? Date.now(),
                },
              ]);
              setTab((t) => {
                if (t !== 'chat') setUnreadChat((u) => u + 1);
                return t;
              });
            }
          } catch {}
        },
      );

    (async () => {
      try {
        const pin = isPrivate ? getChannelPin(channelName) ?? '' : '';
        const res = await fetch('/api/token', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            identity: userName,
            room: channelName,
            pin,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `token request failed: ${res.status}`);
        }
        const { token, wsUrl } = await res.json();
        if (cancelled) return;

        await room.connect(wsUrl, token);

        const audioTrack = await createLocalAudioTrack({
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        });
        localTrackRef.current = audioTrack;
        await room.localParticipant.publishTrack(audioTrack, {
          source: Track.Source.Microphone,
        });
        await audioTrack.mute();

        room.remoteParticipants.forEach((p) => {
          p.on('isSpeakingChanged', (speaking) =>
            handleSpeakingChange(p.identity, speaking),
          );
        });

        refreshParticipants(room);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
      }
    })();

    return () => {
      cancelled = true;
      localTrackRef.current?.stop();
      audioElementsRef.current.forEach((el) => el.remove());
      audioElementsRef.current.clear();
      remoteTracksRef.current.clear();
      recordersRef.current.forEach((entry) => {
        if (entry.recorder.state !== 'inactive') {
          try {
            entry.recorder.stop();
          } catch {}
        }
      });
      recordersRef.current.clear();
      room.disconnect();
      roomRef.current = null;
    };
  }, [
    channelName,
    userId,
    isLoaded,
    isPrivate,
    router,
    refreshParticipants,
    handleSpeakingChange,
    finishRecording,
  ]);

  const startTalking = useCallback(async () => {
    const track = localTrackRef.current;
    if (!track || state !== ConnectionState.Connected) return;
    await track.unmute();
    setTransmitting(true);
  }, [state]);

  const stopTalking = useCallback(async () => {
    const track = localTrackRef.current;
    if (!track) return;
    await track.mute();
    setTransmitting(false);
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === 'Space' && !e.repeat) {
        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
        ) {
          return;
        }
        e.preventDefault();
        startTalking();
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code === 'Space') {
        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
        ) {
          return;
        }
        e.preventDefault();
        stopTalking();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [startTalking, stopTalking]);

  useEffect(() => {
    if (tab === 'chat' && chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [messages, tab]);

  function sendMessage() {
    const text = draft.trim();
    if (!text) return;
    const room = roomRef.current;
    if (!room || state !== ConnectionState.Connected) return;
    const msg: DataPayload = {
      type: 'chat',
      text,
      from: userName || userId,
      ts: Date.now(),
    };
    const payload = encoder.encode(JSON.stringify(msg));
    room.localParticipant.publishData(payload, { reliable: true });
    setMessages((prev) => [
      ...prev,
      { id: cryptoRandom(), from: userName || userId, text, ts: msg.ts },
    ]);
    setDraft('');
  }

  function setParticipantVolume(identity: string, volume: number) {
    const entry = participantStateRef.current.get(identity) ?? {
      volume: 1,
      muted: false,
    };
    entry.volume = volume;
    participantStateRef.current.set(identity, entry);
    const track = remoteTracksRef.current.get(identity);
    if (track) applyVolume(track, entry.muted ? 0 : volume);
    setParticipants((prev) =>
      prev.map((p) => (p.identity === identity ? { ...p, volume } : p)),
    );
  }

  function toggleMute(identity: string) {
    const entry = participantStateRef.current.get(identity) ?? {
      volume: 1,
      muted: false,
    };
    entry.muted = !entry.muted;
    participantStateRef.current.set(identity, entry);
    const track = remoteTracksRef.current.get(identity);
    if (track) applyVolume(track, entry.muted ? 0 : entry.volume);
    setParticipants((prev) =>
      prev.map((p) =>
        p.identity === identity ? { ...p, muted: entry.muted } : p,
      ),
    );
  }

  function selectTab(next: 'people' | 'chat' | 'replays') {
    setTab(next);
    if (next === 'chat') setUnreadChat(0);
    if (next === 'replays') setUnreadReplays(0);
  }

  const connected = state === ConnectionState.Connected;

  return (
    <main className="min-h-dvh flex flex-col bg-neutral-950 text-neutral-100">
      <header className="border-b border-neutral-800 px-4 py-3 flex items-center gap-3">
        <Logo size={28} />
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-neutral-500">
            Channel{isPrivate && ' · private'}
          </div>
          <div className="text-base font-semibold truncate flex items-center gap-1.5">
            {isPrivate && (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0"
              >
                <rect x="4" y="11" width="16" height="10" rx="2" />
                <path d="M8 11V8a4 4 0 1 1 8 0v3" />
              </svg>
            )}
            #{channelName}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <StatusDot state={state} />
          <Link
            href="/settings"
            className="text-xs text-neutral-400 hover:text-neutral-100"
          >
            Settings
          </Link>
          <button
            onClick={() => router.push('/')}
            className="text-xs text-neutral-400 hover:text-neutral-100"
          >
            Leave
          </button>
        </div>
      </header>

      {error && (
        <div className="bg-red-950 border-b border-red-800 text-red-200 px-4 py-3 text-sm">
          {error}
        </div>
      )}

      <nav className="border-b border-neutral-800 flex">
        <TabButton
          active={tab === 'people'}
          onClick={() => selectTab('people')}
        >
          People <Count value={participants.length} />
        </TabButton>
        <TabButton active={tab === 'chat'} onClick={() => selectTab('chat')}>
          Chat
          {unreadChat > 0 && (
            <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-emerald-500 text-neutral-950 text-[10px] font-bold px-1">
              {unreadChat}
            </span>
          )}
        </TabButton>
        <TabButton
          active={tab === 'replays'}
          onClick={() => selectTab('replays')}
        >
          Replays
          {unreadReplays > 0 && (
            <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-emerald-500 text-neutral-950 text-[10px] font-bold px-1">
              {unreadReplays}
            </span>
          )}
        </TabButton>
      </nav>

      <section className="flex-1 overflow-y-auto">
        {tab === 'people' && (
          <PeoplePanel
            participants={participants}
            onVolumeChange={setParticipantVolume}
            onToggleMute={toggleMute}
          />
        )}
        {tab === 'chat' && (
          <ChatPanel
            messages={messages}
            draft={draft}
            setDraft={setDraft}
            sendMessage={sendMessage}
            connected={connected}
            scrollRef={chatScrollRef}
            currentUser={userName || userId}
          />
        )}
        {tab === 'replays' && (
          <ReplaysPanel
            replays={replays}
            onClear={() => {
              replays.forEach((r) => URL.revokeObjectURL(r.url));
              setReplays([]);
            }}
          />
        )}
      </section>

      <footer className="border-t border-neutral-800 px-6 py-4 flex flex-col items-center gap-2 bg-neutral-950">
        <p className="text-[11px] text-neutral-500">
          Hold to talk (or press Space)
        </p>
        <button
          disabled={!connected}
          onMouseDown={startTalking}
          onMouseUp={stopTalking}
          onMouseLeave={stopTalking}
          onTouchStart={(e) => {
            e.preventDefault();
            startTalking();
          }}
          onTouchEnd={(e) => {
            e.preventDefault();
            stopTalking();
          }}
          className={`select-none w-32 h-32 rounded-full font-bold text-lg transition shadow-2xl ${
            transmitting
              ? 'bg-red-500 scale-95 shadow-red-500/50'
              : connected
                ? 'bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600'
                : 'bg-neutral-700 opacity-50 cursor-not-allowed'
          } text-neutral-950`}
        >
          {transmitting ? 'ON AIR' : connected ? 'TALK' : '…'}
        </button>
      </footer>
    </main>
  );
}

function applyVolume(track: RemoteAudioTrack, volume: number) {
  try {
    track.setVolume(volume);
  } catch {}
}

function cryptoRandom(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

function StatusDot({ state }: { state: ConnectionState }) {
  const map: Record<ConnectionState, { color: string; label: string }> = {
    [ConnectionState.Disconnected]: {
      color: 'bg-neutral-500',
      label: 'offline',
    },
    [ConnectionState.Connecting]: { color: 'bg-amber-400', label: 'connecting' },
    [ConnectionState.Connected]: { color: 'bg-emerald-400', label: 'live' },
    [ConnectionState.Reconnecting]: {
      color: 'bg-amber-400',
      label: 'reconnecting',
    },
    [ConnectionState.SignalReconnecting]: {
      color: 'bg-amber-400',
      label: 'reconnecting',
    },
  };
  const v = map[state] ?? map[ConnectionState.Disconnected];
  return (
    <div className="flex items-center gap-2 text-xs text-neutral-400">
      <span className={`w-2 h-2 rounded-full ${v.color}`} />
      {v.label}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 py-3 text-xs font-medium border-b-2 transition ${
        active
          ? 'border-emerald-500 text-emerald-300'
          : 'border-transparent text-neutral-400 hover:text-neutral-100'
      }`}
    >
      <span className="inline-flex items-center justify-center gap-1">
        {children}
      </span>
    </button>
  );
}

function Count({ value }: { value: number }) {
  return (
    <span className="ml-1 text-[10px] text-neutral-500">({value})</span>
  );
}

function PeoplePanel({
  participants,
  onVolumeChange,
  onToggleMute,
}: {
  participants: ParticipantUi[];
  onVolumeChange: (id: string, v: number) => void;
  onToggleMute: (id: string) => void;
}) {
  return (
    <ul className="p-3 space-y-2">
      {participants.map((p) => (
        <li
          key={p.identity}
          className={`rounded-xl border px-3 py-2 ${
            p.isSpeaking
              ? 'bg-emerald-950/40 border-emerald-700'
              : 'bg-neutral-900 border-neutral-800'
          }`}
        >
          <div className="flex items-center gap-3">
            <span
              className={`inline-block w-2.5 h-2.5 rounded-full ${
                p.isSpeaking
                  ? 'bg-emerald-400 animate-pulse'
                  : 'bg-neutral-600'
              }`}
            />
            <span className="font-medium text-sm flex-1 truncate">
              {p.identity}
              {p.isLocal && (
                <span className="ml-2 text-[10px] text-neutral-500">
                  (you)
                </span>
              )}
            </span>
            {!p.isLocal && (
              <button
                onClick={() => onToggleMute(p.identity)}
                className={`text-[11px] px-2 py-1 rounded ${
                  p.muted
                    ? 'bg-red-500/20 text-red-300 border border-red-700'
                    : 'bg-neutral-800 text-neutral-300 border border-neutral-700 hover:bg-neutral-700'
                }`}
              >
                {p.muted ? 'Muted' : 'Mute'}
              </button>
            )}
          </div>
          {!p.isLocal && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[10px] text-neutral-500 w-10">Vol</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={p.volume}
                onChange={(e) =>
                  onVolumeChange(p.identity, Number(e.target.value))
                }
                disabled={p.muted}
                className="flex-1 accent-emerald-500"
              />
              <span className="text-[10px] text-neutral-500 w-9 text-right tabular-nums">
                {Math.round(p.volume * 100)}%
              </span>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function ChatPanel({
  messages,
  draft,
  setDraft,
  sendMessage,
  connected,
  scrollRef,
  currentUser,
}: {
  messages: ChatMessage[];
  draft: string;
  setDraft: (v: string) => void;
  sendMessage: () => void;
  connected: boolean;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  currentUser: string;
}) {
  return (
    <div className="h-full flex flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {messages.length === 0 && (
          <div className="text-xs text-neutral-500 text-center pt-8">
            No messages yet. Say hi.
          </div>
        )}
        {messages.map((m) => {
          const isMine = m.from === currentUser;
          return (
            <div
              key={m.id}
              className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-3 py-2 ${
                  isMine
                    ? 'bg-emerald-500/90 text-neutral-950'
                    : 'bg-neutral-800 text-neutral-100'
                }`}
              >
                {!isMine && (
                  <div className="text-[10px] font-semibold text-neutral-400 mb-0.5">
                    {m.from}
                  </div>
                )}
                <div className="text-sm whitespace-pre-wrap break-words">
                  {m.text}
                </div>
                <div
                  className={`text-[10px] mt-1 ${
                    isMine ? 'text-emerald-950/70' : 'text-neutral-500'
                  }`}
                >
                  {timeStr(m.ts)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendMessage();
        }}
        className="border-t border-neutral-800 p-2 flex gap-2"
      >
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={connected ? 'Type a message…' : 'Not connected'}
          disabled={!connected}
          className="flex-1 rounded-lg bg-neutral-900 border border-neutral-800 px-3 py-2 text-sm outline-none focus:border-neutral-600 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!connected || !draft.trim()}
          className="rounded-lg bg-emerald-500 text-neutral-950 px-4 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Send
        </button>
      </form>
    </div>
  );
}

function ReplaysPanel({
  replays,
  onClear,
}: {
  replays: Replay[];
  onClear: () => void;
}) {
  if (replays.length === 0) {
    return (
      <div className="p-6 text-xs text-neutral-500 text-center">
        No voice clips yet. Anything you receive while on this page is recorded
        here so you can replay it. Clips disappear when you leave the channel.
      </div>
    );
  }
  return (
    <div className="p-3 space-y-2">
      <div className="flex justify-between items-center">
        <span className="text-[10px] uppercase tracking-wider text-neutral-500">
          {replays.length} clip{replays.length === 1 ? '' : 's'}
        </span>
        <button
          onClick={onClear}
          className="text-[11px] text-neutral-500 hover:text-neutral-200"
        >
          Clear all
        </button>
      </div>
      <ul className="space-y-2">
        {replays.map((r) => (
          <li
            key={r.id}
            className="bg-neutral-900 border border-neutral-800 rounded-xl p-3"
          >
            <div className="flex justify-between items-baseline mb-1">
              <span className="text-sm font-medium">{r.from}</span>
              <span className="text-[10px] text-neutral-500">
                {timeStr(r.ts)} · {(r.durationMs / 1000).toFixed(1)}s
              </span>
            </div>
            <audio
              controls
              preload="none"
              src={r.url}
              className="w-full h-8"
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function timeStr(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
