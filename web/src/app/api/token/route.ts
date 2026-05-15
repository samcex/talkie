import { createHash } from 'node:crypto';
import { AccessToken } from 'livekit-server-sdk';
import { NextRequest, NextResponse } from 'next/server';

type TokenRequest = {
  identity?: string;
  room?: string;
  pin?: string;
};

function resolveRoom(room: string, pin: string | undefined): string {
  if (!pin) return room;
  const digest = createHash('sha256')
    .update(`${room}:${pin}`)
    .digest('hex');
  return `${room}__${digest.slice(0, 24)}`;
}

async function issue(input: TokenRequest) {
  const identity = input.identity?.trim();
  const room = input.room?.trim();
  const pin = input.pin?.trim() || undefined;

  if (!identity || !room) {
    return NextResponse.json(
      { error: 'identity and room are required' },
      { status: 400 },
    );
  }

  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const wsUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;

  if (!apiKey || !apiSecret || !wsUrl) {
    return NextResponse.json(
      { error: 'Server is not configured with LiveKit credentials' },
      { status: 500 },
    );
  }

  const actualRoom = resolveRoom(room, pin);

  const at = new AccessToken(apiKey, apiSecret, {
    identity,
    ttl: '4h',
  });

  at.addGrant({
    room: actualRoom,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  const token = await at.toJwt();
  return NextResponse.json({ token, wsUrl, private: Boolean(pin) });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  return issue({
    identity: searchParams.get('identity') ?? undefined,
    room: searchParams.get('room') ?? undefined,
    pin: searchParams.get('pin') ?? undefined,
  });
}

export async function POST(req: NextRequest) {
  let body: TokenRequest = {};
  try {
    body = (await req.json()) as TokenRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  return issue(body);
}
