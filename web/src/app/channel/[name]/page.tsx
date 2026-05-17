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
  displayName: string;
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
  const directUserId = search.get('peer')?.trim() || undefined;
  const directTitle = search.get('title')?.trim() || 'Direct Call';
  const isDirect = channelName === 'direct' && Boolean(directUserId);
  const displayChannelName = isDirect ? directTitle : channelName;
  const userName =
    user?.fullName ||
    user?.username ||
    user?.firstName ||
    user?.emailAddresses[0]?.emailAddress ||
    '';
  const userId = user?.id ?? '';
  const isPrivate = search.get('private') === '1' || isDirect;

  const roomRef = useRef<Room | null>(null);
  const localTrackRef = useRef<LocalAudioTrack | null>(null);
  const micSetupPromiseRef = useRef<Promise<LocalAudioTrack> | null>(null);
  const wantsToTalkRef = useRef(false);
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const remoteTracksRef = useRef<Map<string, RemoteAudioTrack>>(new Map());
  const participantNamesRef = useRef<Map<string, string>>(new Map());
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
    const localDisplayName = participantDisplayName(room.localParticipant);
    participantNamesRef.current.set(
      room.localParticipant.identity,
      localDisplayName,
    );
    list.push({
      identity: room.localParticipant.identity,
      displayName: localDisplayName,
      isLocal: true,
      isSpeaking: room.localParticipant.isSpeaking,
      volume: 1,
      muted: false,
    });
    room.remoteParticipants.forEach((p) => {
      const existing = participantStateRef.current.get(p.identity);
      const displayName = participantDisplayName(p);
      participantNamesRef.current.set(p.identity, displayName);
      list.push({
        identity: p.identity,
        displayName,
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
        maybeNotify(participantNamesRef.current.get(identity) ?? identity);
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
        const from = participantNamesRef.current.get(identity) ?? identity;
        setReplays((prev) => {
          const next: Replay[] = [
            { id: cryptoRandom(), from, ts: entry.startedAt, durationMs, url },
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
          if (!isDirect) rememberChannel(channelName, isPrivate);
        }
      })
      .on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => {
        participantNamesRef.current.set(p.identity, participantDisplayName(p));
        p.on('isSpeakingChanged', (speaking) =>
          handleSpeakingChange(p.identity, speaking),
        );
        refreshParticipants(room);
      })
      .on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
        finishRecording(p.identity);
        participantStateRef.current.delete(p.identity);
        participantNamesRef.current.delete(p.identity);
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
              const senderIdentity = participant?.identity ?? '';
              const from =
                participant?.name?.trim() ||
                parsed.from ||
                senderIdentity ||
                '(unknown)';
              if (senderIdentity === userId) {
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
        const pin = isPrivate && !isDirect ? getChannelPin(channelName) ?? '' : '';
        const res = await fetch('/api/token', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            identity: userName,
            room: channelName,
            pin,
            directUserId,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `token request failed: ${res.status}`);
        }
        const { token, wsUrl } = await res.json();
        if (cancelled) return;

        await room.connect(wsUrl, token);

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
      wantsToTalkRef.current = false;
      localTrackRef.current?.stop();
      localTrackRef.current = null;
      micSetupPromiseRef.current = null;
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
    directUserId,
    isDirect,
    userId,
    isLoaded,
    isPrivate,
    router,
    refreshParticipants,
    handleSpeakingChange,
    finishRecording,
  ]);

  const ensureLocalAudioTrack = useCallback(async () => {
    const existing = localTrackRef.current;
    if (existing) return existing;

    const room = roomRef.current;
    if (!room || state !== ConnectionState.Connected) {
      throw new Error('Not connected');
    }

    if (!micSetupPromiseRef.current) {
      micSetupPromiseRef.current = (async () => {
        const audioTrack = await createLocalAudioTrack({
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        });
        await room.localParticipant.publishTrack(audioTrack, {
          source: Track.Source.Microphone,
        });
        await audioTrack.mute();
        localTrackRef.current = audioTrack;
        return audioTrack;
      })().finally(() => {
        micSetupPromiseRef.current = null;
      });
    }

    return micSetupPromiseRef.current;
  }, [state]);

  const startTalking = useCallback(async () => {
    if (state !== ConnectionState.Connected) return;
    wantsToTalkRef.current = true;
    setError(null);

    try {
      const track = await ensureLocalAudioTrack();
      if (!wantsToTalkRef.current) {
        await track.mute();
        setTransmitting(false);
        return;
      }
      await track.unmute();
      setTransmitting(true);
    } catch (err) {
      wantsToTalkRef.current = false;
      setTransmitting(false);
      const msg =
        err instanceof Error
          ? err.message
          : 'Microphone access was not allowed';
      setError(msg);
    }
  }, [ensureLocalAudioTrack, state]);

  const stopTalking = useCallback(async () => {
    wantsToTalkRef.current = false;
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
    <main className="min-h-dvh talkie-shell flex justify-center text-zinc-100">
      <div className="talkie-phone relative flex h-dvh w-full max-w-[430px] flex-col overflow-hidden bg-zinc-950">
        <div className="talkie-noise" />
        <header className="glass-panel relative z-20 flex shrink-0 items-center justify-between rounded-b-[2rem] px-5 pb-4 pt-10">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-zinc-900 inset-border">
              <Logo size={30} />
            </div>
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-500">
                Channel{isPrivate && ' Private'}
              </div>
              <div className="flex min-w-0 items-center gap-2">
                {isPrivate && <LockIcon className="h-3.5 w-3.5 flex-shrink-0 text-emerald-400" />}
                <h1 className="truncate text-base font-black uppercase tracking-tight text-white">
                  {displayChannelName}
                </h1>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusDot state={state} />
            <Link
              href="/settings"
              aria-label="Settings"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-900 text-zinc-400 transition active:scale-95 inset-border hover:text-white"
            >
              <SettingsIcon className="h-4 w-4" />
            </Link>
            <button
              onClick={() => router.push('/')}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-900 text-zinc-400 transition active:scale-95 inset-border hover:text-white"
              aria-label="Leave channel"
            >
              <LeaveIcon className="h-4 w-4" />
            </button>
          </div>
        </header>

        {error && (
          <div className="relative z-20 border-b border-red-800/60 bg-red-950/80 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <section className="relative z-10 flex-1 overflow-y-auto no-scrollbar px-4 pb-44 pt-5">
          <div className="machined-panel relative overflow-hidden rounded-[2rem] p-5">
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
                d="M-10,80 Q60,120 150,80 T350,80"
                fill="none"
                stroke="#71717a"
                strokeWidth="0.5"
              />
            </svg>
            <div className="relative z-10 flex items-start justify-between gap-4">
              <div>
                <div className="mb-1 flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      connected
                        ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]'
                        : 'bg-zinc-600'
                    }`}
                  />
                  <span className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-400">
                  {isDirect
                    ? connected
                      ? 'Direct Link'
                      : 'Direct Pending'
                    : connected
                      ? 'Encrypted Link'
                      : 'Link Pending'}
                  </span>
                </div>
                <div className="text-3xl font-black uppercase tracking-tight text-white">
                  {displayChannelName}
                </div>
              </div>
              <div className="rounded-xl bg-zinc-800/80 p-2 text-zinc-400 inset-border">
                {isPrivate ? (
                  <LockIcon className="h-5 w-5" />
                ) : (
                  <HashIcon className="h-5 w-5" />
                )}
              </div>
            </div>
            <div className="relative z-10 mt-6 grid grid-cols-2 gap-4">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  Members
                </div>
                <div className="font-mono text-lg text-zinc-200">
                  {participants.length.toString().padStart(2, '0')}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                  Mode
                </div>
                <div className="font-mono text-lg text-zinc-200">
                  {isDirect ? '1:1' : isPrivate ? 'PIN' : 'OPEN'}
                </div>
              </div>
            </div>
          </div>

          <nav className="mt-5 grid grid-cols-3 gap-2 rounded-2xl bg-zinc-900/70 p-1 inset-border">
            <TabButton active={tab === 'people'} onClick={() => selectTab('people')}>
              People <Count value={participants.length} />
            </TabButton>
            <TabButton active={tab === 'chat'} onClick={() => selectTab('chat')}>
              Chat
              {unreadChat > 0 && <Badge value={unreadChat} />}
            </TabButton>
            <TabButton active={tab === 'replays'} onClick={() => selectTab('replays')}>
              Replays
              {unreadReplays > 0 && <Badge value={unreadReplays} />}
            </TabButton>
          </nav>

          <div className="mt-5">
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
          </div>
        </section>

        <footer className="glass-panel absolute bottom-0 left-0 right-0 z-40 flex h-40 items-center justify-center rounded-t-[2.5rem] border-t border-zinc-800 px-6 pb-8 pt-2">
          <div className="relative flex w-full max-w-sm items-center justify-between">
            <button
              onClick={() => selectTab('chat')}
              className="group relative flex aspect-square w-14 flex-col items-center justify-center gap-1 rounded-2xl bg-zinc-900 text-zinc-500 transition active:scale-95 shadow-tactile-up"
            >
              {unreadChat > 0 && (
                <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-emerald-500" />
              )}
              <ChatIcon className="h-5 w-5 text-zinc-400 group-hover:text-white" />
              <span className="text-[9px] font-bold uppercase">Chat</span>
            </button>

            <div
              className={`ptt-halo relative -translate-y-6 flex h-28 w-28 items-center justify-center ${
                transmitting ? 'ptt-halo-active' : ''
              }`}
            >
              <div className="absolute inset-0 rounded-full border-4 border-zinc-950 bg-zinc-900 shadow-[inset_0_4px_10px_rgba(0,0,0,0.8),_0_2px_0_rgba(255,255,255,0.05)]" />
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
                className={`absolute z-10 flex h-24 w-24 select-none flex-col items-center justify-center gap-1 rounded-full border transition-all duration-150 focus:outline-none ${
                  transmitting
                    ? 'translate-y-1 border-emerald-500 bg-gradient-to-b from-zinc-800 to-zinc-950 shadow-ptt-active'
                    : connected
                      ? 'border-zinc-600 bg-gradient-to-b from-zinc-700 to-zinc-900 shadow-ptt-idle'
                      : 'border-zinc-700 bg-zinc-800 opacity-60'
                }`}
              >
                <span
                  className={`mb-1 h-2 w-2 rounded-full ${
                    transmitting
                      ? 'bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,1)]'
                      : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]'
                  }`}
                />
                <MicIcon className="h-6 w-6 text-zinc-200" />
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">
                  {transmitting ? 'On Air' : connected ? 'Push' : 'Wait'}
                </span>
              </button>
            </div>

            <button
              onClick={() => selectTab('replays')}
              className="group flex aspect-square w-14 flex-col items-center justify-center gap-1 rounded-2xl bg-zinc-900 text-zinc-500 transition active:scale-95 shadow-tactile-up"
            >
              <ReplayIcon className="h-5 w-5 text-zinc-400 group-hover:text-white" />
              <span className="text-[9px] font-bold uppercase">Replay</span>
            </button>
          </div>
          <div className="absolute bottom-2 left-1/2 h-1 w-1/3 -translate-x-1/2 rounded-full bg-zinc-600 opacity-30" />
        </footer>
      </div>
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

function participantDisplayName(participant: {
  identity: string;
  name?: string;
}): string {
  return participant.name?.trim() || participant.identity;
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

function LeaveIcon({ className }: { className?: string }) {
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
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

function ChatIcon({ className }: { className?: string }) {
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
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" />
      <path d="M8 9h8" />
      <path d="M8 13h5" />
    </svg>
  );
}

function MicIcon({ className }: { className?: string }) {
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
      <path d="M12 14a4 4 0 0 0 4-4V6a4 4 0 0 0-8 0v4a4 4 0 0 0 4 4Z" />
      <path d="M19 10a7 7 0 0 1-14 0" />
      <path d="M12 17v4" />
      <path d="M8 21h8" />
    </svg>
  );
}

function ReplayIcon({ className }: { className?: string }) {
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
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 3v6h6" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
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
    <div className="flex items-center gap-2 rounded-full bg-zinc-900 px-3 py-2 font-mono text-[10px] uppercase text-zinc-400 inset-border">
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
      className={`rounded-xl py-3 text-xs font-bold transition ${
        active
          ? 'bg-emerald-500 text-black'
          : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
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
    <span className="ml-1 text-[10px] opacity-70">({value})</span>
  );
}

function Badge({ value }: { value: number }) {
  return (
    <span className="ml-1 inline-flex min-w-[18px] items-center justify-center rounded-full bg-black/20 px-1 text-[10px] font-black">
      {value}
    </span>
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
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {participants.map((p) => (
        <li
          key={p.identity}
          className={`relative overflow-hidden rounded-2xl border p-3 inset-border ${
            p.isSpeaking
              ? 'border-emerald-500/30 bg-zinc-900/80 shadow-[0_0_15px_-5px_rgba(16,185,129,0.25)]'
              : 'border-transparent bg-zinc-900/55'
          }`}
        >
          <div className="flex items-center gap-3">
            <span
              className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-black uppercase ${
                p.isSpeaking
                  ? 'bg-emerald-500 text-black'
                  : 'bg-zinc-800 text-zinc-500'
              }`}
            >
              {p.displayName.slice(0, 1)}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold text-zinc-100">
                {p.displayName}
              </span>
              {p.isSpeaking ? (
                <span className="mt-1 flex h-3 items-end gap-[2px]">
                  <span className="vu-bar" />
                  <span className="vu-bar" />
                  <span className="vu-bar" />
                  <span className="vu-bar" />
                </span>
              ) : (
                <span className="block font-mono text-[10px] text-zinc-500">
                  {p.isLocal ? 'YOU' : 'STANDBY'}
                </span>
              )}
            </span>
            {!p.isLocal && (
              <button
                onClick={() => onToggleMute(p.identity)}
                className={`rounded-lg px-2 py-1 text-[10px] font-bold uppercase ${
                  p.muted
                    ? 'border border-red-700 bg-red-500/20 text-red-300'
                    : 'border border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
                }`}
              >
                {p.muted ? 'Muted' : 'Mute'}
              </button>
            )}
          </div>
          {!p.isLocal && (
            <div className="mt-2 flex items-center gap-2">
              <span className="w-10 text-[10px] uppercase text-zinc-500">Vol</span>
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
              <span className="w-9 text-right font-mono text-[10px] tabular-nums text-zinc-500">
                {Math.round(p.volume * 100)}%
              </span>
            </div>
          )}
          {p.isSpeaking && (
            <div className="pointer-events-none absolute right-0 top-0 h-full w-16 bg-gradient-to-l from-emerald-500/10 to-transparent" />
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
    <div className="flex min-h-[360px] flex-col overflow-hidden rounded-3xl bg-zinc-900/55 inset-border">
      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
        {messages.length === 0 && (
          <div className="pt-8 text-center text-xs text-zinc-500">
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
                    ? 'bg-emerald-500 text-black'
                    : 'bg-zinc-800 text-zinc-100'
                }`}
              >
                {!isMine && (
                  <div className="mb-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                    {m.from}
                  </div>
                )}
                <div className="text-sm whitespace-pre-wrap break-words">
                  {m.text}
                </div>
                <div
                  className={`text-[10px] mt-1 ${
                    isMine ? 'text-emerald-950/70' : 'text-zinc-500'
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
        className="flex gap-2 border-t border-zinc-800 p-2"
      >
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={connected ? 'Type a message…' : 'Not connected'}
          disabled={!connected}
          className="flex-1 rounded-2xl border border-zinc-800 bg-zinc-950 px-3 py-3 text-sm outline-none focus:border-emerald-500/50 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!connected || !draft.trim()}
          className="rounded-2xl bg-emerald-500 px-4 text-sm font-black text-black disabled:cursor-not-allowed disabled:opacity-40"
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
      <div className="rounded-3xl bg-zinc-900/55 p-6 text-center text-xs text-zinc-500 inset-border">
        No voice clips yet. Anything you receive while on this page is recorded
        here so you can replay it. Clips disappear when you leave the channel.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500">
          {replays.length} clip{replays.length === 1 ? '' : 's'}
        </span>
        <button
          onClick={onClear}
          className="text-[11px] text-zinc-500 hover:text-zinc-200"
        >
          Clear all
        </button>
      </div>
      <ul className="space-y-2">
        {replays.map((r) => (
          <li
            key={r.id}
            className="rounded-2xl border border-zinc-800 bg-zinc-900/55 p-3 inset-border"
          >
            <div className="flex justify-between items-baseline mb-1">
              <span className="text-sm font-medium">{r.from}</span>
              <span className="text-[10px] text-zinc-500">
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
