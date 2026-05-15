'use client';

import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ConnectionState,
  LocalAudioTrack,
  Room,
  RoomEvent,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  Track,
  createLocalAudioTrack,
} from 'livekit-client';

type ParticipantInfo = {
  identity: string;
  isSpeaking: boolean;
  isLocal: boolean;
};

export default function ChannelPage() {
  const params = useParams<{ name: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const channelName = params?.name ?? 'general';
  const userName = search.get('name') ?? '';

  const roomRef = useRef<Room | null>(null);
  const localTrackRef = useRef<LocalAudioTrack | null>(null);
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());

  const [state, setState] = useState<ConnectionState>(
    ConnectionState.Disconnected,
  );
  const [participants, setParticipants] = useState<ParticipantInfo[]>([]);
  const [transmitting, setTransmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshParticipants = useCallback((room: Room) => {
    const list: ParticipantInfo[] = [];
    list.push({
      identity: room.localParticipant.identity,
      isSpeaking: room.localParticipant.isSpeaking,
      isLocal: true,
    });
    room.remoteParticipants.forEach((p) => {
      list.push({
        identity: p.identity,
        isSpeaking: p.isSpeaking,
        isLocal: false,
      });
    });
    setParticipants(list);
  }, []);

  useEffect(() => {
    if (!userName) {
      router.replace('/');
      return;
    }

    let cancelled = false;
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
    });
    roomRef.current = room;

    room
      .on(RoomEvent.ConnectionStateChanged, (s) => setState(s))
      .on(RoomEvent.ParticipantConnected, () => refreshParticipants(room))
      .on(RoomEvent.ParticipantDisconnected, () => refreshParticipants(room))
      .on(RoomEvent.ActiveSpeakersChanged, () => refreshParticipants(room))
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
            document.body.appendChild(el);
            audioElementsRef.current.set(participant.identity, el);
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
          }
        },
      );

    (async () => {
      try {
        const res = await fetch(
          `/api/token?identity=${encodeURIComponent(userName)}&room=${encodeURIComponent(channelName)}`,
        );
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
      room.disconnect();
      roomRef.current = null;
    };
  }, [channelName, userName, router, refreshParticipants]);

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
        e.preventDefault();
        startTalking();
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code === 'Space') {
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

  const connected = state === ConnectionState.Connected;

  return (
    <main className="min-h-dvh flex flex-col bg-neutral-950 text-neutral-100">
      <header className="border-b border-neutral-800 px-6 py-4 flex items-center justify-between">
        <div>
          <div className="text-sm text-neutral-400">Channel</div>
          <div className="text-xl font-semibold">#{channelName}</div>
        </div>
        <div className="flex items-center gap-3">
          <StatusDot state={state} />
          <button
            onClick={() => router.push('/')}
            className="text-sm text-neutral-400 hover:text-neutral-100"
          >
            Leave
          </button>
        </div>
      </header>

      {error && (
        <div className="bg-red-950 border-b border-red-800 text-red-200 px-6 py-3 text-sm">
          {error}
        </div>
      )}

      <section className="flex-1 px-6 py-4 overflow-y-auto">
        <div className="text-xs uppercase tracking-wider text-neutral-500 mb-2">
          In channel ({participants.length})
        </div>
        <ul className="space-y-1">
          {participants.map((p) => (
            <li
              key={p.identity}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg ${
                p.isSpeaking
                  ? 'bg-emerald-950/50 border border-emerald-700'
                  : 'border border-transparent'
              }`}
            >
              <span
                className={`inline-block w-2.5 h-2.5 rounded-full ${
                  p.isSpeaking ? 'bg-emerald-400 animate-pulse' : 'bg-neutral-600'
                }`}
              />
              <span className="font-medium">{p.identity}</span>
              {p.isLocal && (
                <span className="text-xs text-neutral-500">(you)</span>
              )}
              {p.isSpeaking && (
                <span className="ml-auto text-xs text-emerald-300">
                  speaking
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <footer className="border-t border-neutral-800 px-6 py-6 flex flex-col items-center gap-3">
        <p className="text-xs text-neutral-500">
          Hold the button (or press Space) to talk
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
          className={`select-none w-40 h-40 rounded-full font-bold text-lg transition shadow-2xl ${
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

function StatusDot({ state }: { state: ConnectionState }) {
  const map: Record<ConnectionState, { color: string; label: string }> = {
    [ConnectionState.Disconnected]: { color: 'bg-neutral-500', label: 'offline' },
    [ConnectionState.Connecting]: { color: 'bg-amber-400', label: 'connecting' },
    [ConnectionState.Connected]: { color: 'bg-emerald-400', label: 'live' },
    [ConnectionState.Reconnecting]: { color: 'bg-amber-400', label: 'reconnecting' },
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
