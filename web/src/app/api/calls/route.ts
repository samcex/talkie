import { NextRequest, NextResponse } from 'next/server';
import { auth, clerkClient, currentUser } from '@clerk/nextjs/server';
import { displayNameFor, userIsDisabled } from '@/lib/admin';

type PendingCall = {
  id: string;
  fromUserId: string;
  fromName: string;
  fromEmail: string;
  targetUserId: string;
  targetName: string;
  createdAt: number;
  expiresAt: number;
};

type CallStore = Map<string, PendingCall>;

const TTL_MS = 45_000;

const globalForCalls = globalThis as typeof globalThis & {
  __talkiePendingCalls?: CallStore;
};

function store(): CallStore {
  if (!globalForCalls.__talkiePendingCalls) {
    globalForCalls.__talkiePendingCalls = new Map();
  }
  return globalForCalls.__talkiePendingCalls;
}

function prune(now = Date.now()) {
  for (const [id, call] of store()) {
    if (call.expiresAt <= now) store().delete(id);
  }
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const now = Date.now();
  prune(now);
  const calls = [...store().values()]
    .filter((call) => call.targetUserId === userId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((call) => ({
      id: call.id,
      fromUserId: call.fromUserId,
      fromName: call.fromName,
      fromEmail: call.fromEmail,
      initials: initialsFor(call.fromName),
      createdAt: call.createdAt,
      expiresAt: call.expiresAt,
    }));

  return NextResponse.json({ calls });
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const user = await currentUser();
  if (!user || userIsDisabled(user)) {
    return NextResponse.json(
      { error: 'This account is unavailable' },
      { status: 403 },
    );
  }

  let body: { targetUserId?: string } = {};
  try {
    body = (await req.json()) as { targetUserId?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const targetUserId = body.targetUserId?.trim();
  if (!targetUserId || targetUserId === userId) {
    return NextResponse.json(
      { error: 'Choose another user for a direct call' },
      { status: 400 },
    );
  }

  const client = await clerkClient();
  const target = await client.users.getUser(targetUserId).catch(() => null);
  if (!target || userIsDisabled(target)) {
    return NextResponse.json(
      { error: 'This user is unavailable' },
      { status: 404 },
    );
  }

  prune();
  const id = crypto.randomUUID();
  const fromName = displayNameFor(user);
  const targetName = displayNameFor(target);
  const now = Date.now();
  const call: PendingCall = {
    id,
    fromUserId: userId,
    fromName,
    fromEmail: user.emailAddresses[0]?.emailAddress ?? '',
    targetUserId,
    targetName,
    createdAt: now,
    expiresAt: now + TTL_MS,
  };
  store().set(id, call);

  return NextResponse.json({
    call: {
      id,
      targetUserId,
      targetName,
      createdAt: call.createdAt,
      expiresAt: call.expiresAt,
    },
  });
}

export async function DELETE(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const id = new URL(req.url).searchParams.get('id')?.trim();
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const call = store().get(id);
  if (
    call &&
    (call.targetUserId === userId || call.fromUserId === userId)
  ) {
    store().delete(id);
  }

  return NextResponse.json({ ok: true });
}

function initialsFor(name: string): string {
  const parts = name
    .split(/[\s@._-]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  return (
    (parts[0]?.[0] ?? '?').toUpperCase() +
    (parts[1]?.[0] ?? '').toUpperCase()
  );
}
