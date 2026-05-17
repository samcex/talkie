import { createHash } from 'node:crypto';
import { AccessToken } from 'livekit-server-sdk';
import { NextRequest, NextResponse } from 'next/server';
import { auth, clerkClient, currentUser } from '@clerk/nextjs/server';
import { displayNameFor, userIsDisabled } from '@/lib/admin';

type TokenRequest = {
  identity?: string;
  room?: string;
  pin?: string;
  directUserId?: string;
};

function resolveRoom(room: string, pin: string | undefined): string {
  if (!pin) return room;
  const digest = createHash('sha256')
    .update(`${room}:${pin}`)
    .digest('hex');
  return `${room}__${digest.slice(0, 24)}`;
}

function resolveDirectRoom(userA: string, userB: string): string {
  const [a, b] = [userA, userB].sort();
  const digest = createHash('sha256').update(`${a}:${b}`).digest('hex');
  return `direct__${digest.slice(0, 32)}`;
}

async function issue(input: TokenRequest, req: NextRequest) {
  let identity = input.identity?.trim();
  let displayName = identity;
  let room = input.room?.trim();
  const pin = input.pin?.trim() || undefined;
  const directUserId = input.directUserId?.trim();
  let sessionUserId = '';

  // If the caller has a Clerk session (web), force the identity to their
  // Clerk user ID so they can't impersonate. Native clients without sessions
  // fall back to the requested identity for backward compat.
  try {
    const { userId } = await auth();
    if (userId) {
      sessionUserId = userId;
      const user = await currentUser();
      if (user) {
        if (userIsDisabled(user)) {
          return NextResponse.json(
            { error: 'This account is disabled' },
            { status: 403 },
          );
        }
        identity = user.id;
        displayName = displayNameFor(user);
      }
    }
  } catch {
    // Not in a Clerk-protected route or session missing — continue as anonymous
  }

  if (directUserId) {
    if (!sessionUserId) {
      return NextResponse.json(
        { error: 'Direct calls require sign in' },
        { status: 401 },
      );
    }
    if (directUserId === sessionUserId) {
      return NextResponse.json(
        { error: 'Choose another user for a direct call' },
        { status: 400 },
      );
    }

    const client = await clerkClient();
    const peer = await client.users.getUser(directUserId).catch(() => null);
    if (!peer) {
      return NextResponse.json(
        { error: 'Direct call user not found' },
        { status: 404 },
      );
    }
    if (userIsDisabled(peer)) {
      return NextResponse.json(
        { error: 'This user is unavailable' },
        { status: 403 },
      );
    }
    room = resolveDirectRoom(sessionUserId, directUserId);
  }

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

  const actualRoom = directUserId ? room : resolveRoom(room, pin);

  const at = new AccessToken(apiKey, apiSecret, {
    identity,
    name: displayName,
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
  return NextResponse.json({
    token,
    wsUrl,
    private: Boolean(pin) || Boolean(directUserId),
    direct: Boolean(directUserId),
    identity,
    displayName,
  });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  return issue(
    {
      identity: searchParams.get('identity') ?? undefined,
      room: searchParams.get('room') ?? undefined,
      pin: searchParams.get('pin') ?? undefined,
      directUserId: searchParams.get('directUserId') ?? undefined,
    },
    req,
  );
}

export async function POST(req: NextRequest) {
  let body: TokenRequest = {};
  try {
    body = (await req.json()) as TokenRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  return issue(body, req);
}
