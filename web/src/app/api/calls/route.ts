import { NextRequest, NextResponse } from 'next/server';
import { auth, clerkClient, currentUser } from '@clerk/nextjs/server';
import { displayNameFor, userIsDisabled } from '@/lib/admin';
import { ensureSchema, sql } from '@/lib/db';

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

type PendingCallRow = {
  id: string;
  fromUserId: string;
  fromName: string;
  fromEmail: string;
  createdAt: number | string;
  expiresAt: number | string;
};

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

async function pruneDb(now = Date.now()) {
  const db = sql();
  if (!db) return false;
  await ensureSchema();
  await db`delete from talkie_pending_calls where expires_at <= ${now}`;
  return true;
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const now = Date.now();
  const db = sql();
  if (db) {
    await pruneDb(now);
    const calls = (await db`
      select
        id,
        from_user_id as "fromUserId",
        from_name as "fromName",
        from_email as "fromEmail",
        created_at as "createdAt",
        expires_at as "expiresAt"
      from talkie_pending_calls
      where target_user_id = ${userId}
      order by created_at desc
    `) as PendingCallRow[];
    return NextResponse.json({
      calls: calls.map((call) => ({
        ...call,
        initials: initialsFor(call.fromName as string),
        createdAt: Number(call.createdAt),
        expiresAt: Number(call.expiresAt),
      })),
      persistent: true,
    });
  }

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

  return NextResponse.json({ calls, persistent: false });
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

  const db = sql();
  if (db) {
    await pruneDb();
  } else {
    prune();
  }
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
  if (db) {
    await ensureSchema();
    await db`
      insert into talkie_pending_calls (
        id,
        from_user_id,
        from_name,
        from_email,
        target_user_id,
        target_name,
        created_at,
        expires_at
      )
      values (
        ${call.id},
        ${call.fromUserId},
        ${call.fromName},
        ${call.fromEmail},
        ${call.targetUserId},
        ${call.targetName},
        ${call.createdAt},
        ${call.expiresAt}
      )
    `;
  } else {
    store().set(id, call);
  }

  return NextResponse.json({
    call: {
      id,
      targetUserId,
      targetName,
      createdAt: call.createdAt,
      expiresAt: call.expiresAt,
    },
    persistent: Boolean(db),
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

  const db = sql();
  if (db) {
    await ensureSchema();
    await db`
      delete from talkie_pending_calls
      where id = ${id}
        and (target_user_id = ${userId} or from_user_id = ${userId})
    `;
  } else {
    const call = store().get(id);
    if (
      call &&
      (call.targetUserId === userId || call.fromUserId === userId)
    ) {
      store().delete(id);
    }
  }

  return NextResponse.json({ ok: true, persistent: Boolean(db) });
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
