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

type CallStatusValue = 'ringing' | 'accepted' | 'declined';

type CallStatus = {
  id: string;
  fromUserId: string;
  targetUserId: string;
  status: CallStatusValue;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
};

type PendingCallRow = {
  id: string;
  fromUserId: string;
  fromName: string;
  fromEmail: string;
  targetUserId?: string;
  targetName?: string;
  createdAt: number | string;
  expiresAt: number | string;
};

type CallStatusRow = {
  id: string;
  fromUserId: string;
  targetUserId: string;
  status: CallStatusValue;
  createdAt: number | string;
  updatedAt: number | string;
  expiresAt: number | string;
};

const TTL_MS = 45_000;
const STATUS_RETENTION_MS = 5 * 60_000;

const globalForCalls = globalThis as typeof globalThis & {
  __talkiePendingCalls?: CallStore;
  __talkieCallStatuses?: Map<string, CallStatus>;
};

function store(): CallStore {
  if (!globalForCalls.__talkiePendingCalls) {
    globalForCalls.__talkiePendingCalls = new Map();
  }
  return globalForCalls.__talkiePendingCalls;
}

function statusStore() {
  if (!globalForCalls.__talkieCallStatuses) {
    globalForCalls.__talkieCallStatuses = new Map();
  }
  return globalForCalls.__talkieCallStatuses;
}

function prune(now = Date.now()) {
  for (const [id, call] of store()) {
    if (call.expiresAt <= now) store().delete(id);
  }
  for (const [id, status] of statusStore()) {
    if (status.updatedAt <= now - STATUS_RETENTION_MS) statusStore().delete(id);
  }
}

async function pruneDb(now = Date.now()) {
  const db = sql();
  if (!db) return false;
  await ensureSchema();
  await db`delete from talkie_pending_calls where expires_at <= ${now}`;
  await db`
    delete from talkie_call_statuses
    where updated_at <= ${now - STATUS_RETENTION_MS}
  `;
  return true;
}

function serializeStatus(status: CallStatusRow | CallStatus | null) {
  if (!status) return null;
  const expiresAt = Number(status.expiresAt);
  const rawStatus = status.status;
  return {
    id: status.id,
    fromUserId: status.fromUserId,
    targetUserId: status.targetUserId,
    status:
      rawStatus === 'ringing' && expiresAt <= Date.now()
        ? 'expired'
        : rawStatus,
    createdAt: Number(status.createdAt),
    updatedAt: Number(status.updatedAt),
    expiresAt,
  };
}

async function signedInUserId() {
  if (
    !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ||
    !process.env.CLERK_SECRET_KEY
  ) {
    return null;
  }

  try {
    const { userId } = await auth();
    return userId;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const userId = await signedInUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const now = Date.now();
  const id = new URL(req.url).searchParams.get('id')?.trim();
  const db = sql();
  if (db) {
    await pruneDb(now);
    if (id) {
      const calls = (await db`
        select
          id,
          from_user_id as "fromUserId",
          from_name as "fromName",
          from_email as "fromEmail",
          target_user_id as "targetUserId",
          target_name as "targetName",
          created_at as "createdAt",
          expires_at as "expiresAt"
        from talkie_pending_calls
        where id = ${id}
          and (target_user_id = ${userId} or from_user_id = ${userId})
        limit 1
      `) as PendingCallRow[];
      const call = calls[0];
      if (call) {
        return NextResponse.json({
          call: {
            ...call,
            initials: initialsFor(call.fromName as string),
            createdAt: Number(call.createdAt),
            expiresAt: Number(call.expiresAt),
          },
          status: serializeStatus({
            id: call.id,
            fromUserId: call.fromUserId,
            targetUserId: call.targetUserId ?? '',
            status: 'ringing',
            createdAt: call.createdAt,
            updatedAt: call.createdAt,
            expiresAt: call.expiresAt,
          }),
          persistent: true,
        });
      }

      const statuses = (await db`
        select
          id,
          from_user_id as "fromUserId",
          target_user_id as "targetUserId",
          status,
          created_at as "createdAt",
          updated_at as "updatedAt",
          expires_at as "expiresAt"
        from talkie_call_statuses
        where id = ${id}
          and (target_user_id = ${userId} or from_user_id = ${userId})
        limit 1
      `) as CallStatusRow[];
      return NextResponse.json({
        call: null,
        status: serializeStatus(statuses[0] ?? null),
        persistent: true,
      });
    }

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
  if (id) {
    const call = store().get(id);
    if (
      call &&
      (call.targetUserId === userId || call.fromUserId === userId)
    ) {
      const status = statusStore().get(id) ?? {
        id: call.id,
        fromUserId: call.fromUserId,
        targetUserId: call.targetUserId,
        status: 'ringing' as const,
        createdAt: call.createdAt,
        updatedAt: call.createdAt,
        expiresAt: call.expiresAt,
      };
      return NextResponse.json({
        call: {
          id: call.id,
          fromUserId: call.fromUserId,
          fromName: call.fromName,
          fromEmail: call.fromEmail,
          targetUserId: call.targetUserId,
          targetName: call.targetName,
          initials: initialsFor(call.fromName),
          createdAt: call.createdAt,
          expiresAt: call.expiresAt,
        },
        status: serializeStatus(status),
        persistent: false,
      });
    }
    const status = statusStore().get(id);
    const canViewStatus =
      status &&
      (status.targetUserId === userId || status.fromUserId === userId);
    return NextResponse.json({
      call: null,
      status: canViewStatus ? serializeStatus(status) : null,
      persistent: false,
    });
  }

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
  const userId = await signedInUserId();
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
    await db`
      insert into talkie_call_statuses (
        id,
        from_user_id,
        target_user_id,
        status,
        created_at,
        updated_at,
        expires_at
      )
      values (
        ${call.id},
        ${call.fromUserId},
        ${call.targetUserId},
        ${'ringing'},
        ${call.createdAt},
        ${call.createdAt},
        ${call.expiresAt}
      )
      on conflict (id) do update set
        status = excluded.status,
        updated_at = excluded.updated_at,
        expires_at = excluded.expires_at
    `;
  } else {
    store().set(id, call);
    statusStore().set(id, {
      id: call.id,
      fromUserId: call.fromUserId,
      targetUserId: call.targetUserId,
      status: 'ringing',
      createdAt: call.createdAt,
      updatedAt: call.createdAt,
      expiresAt: call.expiresAt,
    });
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
  const userId = await signedInUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const id = new URL(req.url).searchParams.get('id')?.trim();
  const nextStatus = new URL(req.url).searchParams.get('status')?.trim();
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }
  if (
    nextStatus &&
    nextStatus !== 'accepted' &&
    nextStatus !== 'declined'
  ) {
    return NextResponse.json({ error: 'invalid status' }, { status: 400 });
  }
  const statusUpdate = nextStatus as 'accepted' | 'declined' | undefined;

  const db = sql();
  const now = Date.now();
  if (db) {
    await ensureSchema();
    const calls = (await db`
      select
        id,
        from_user_id as "fromUserId",
        target_user_id as "targetUserId",
        created_at as "createdAt",
        expires_at as "expiresAt"
      from talkie_pending_calls
      where id = ${id}
        and (target_user_id = ${userId} or from_user_id = ${userId})
      limit 1
    `) as Array<{
      id: string;
      fromUserId: string;
      targetUserId: string;
      createdAt: number | string;
      expiresAt: number | string;
    }>;
    const call = calls[0];
    if (call && statusUpdate && call.targetUserId === userId) {
      await db`
        insert into talkie_call_statuses (
          id,
          from_user_id,
          target_user_id,
          status,
          created_at,
          updated_at,
          expires_at
        )
        values (
          ${call.id},
          ${call.fromUserId},
          ${call.targetUserId},
          ${statusUpdate},
          ${Number(call.createdAt)},
          ${now},
          ${Number(call.expiresAt)}
        )
        on conflict (id) do update set
          status = excluded.status,
          updated_at = excluded.updated_at,
          expires_at = excluded.expires_at
      `;
    }
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
      if (statusUpdate && call.targetUserId === userId) {
        statusStore().set(id, {
          id: call.id,
          fromUserId: call.fromUserId,
          targetUserId: call.targetUserId,
          status: statusUpdate,
          createdAt: call.createdAt,
          updatedAt: now,
          expiresAt: call.expiresAt,
        });
      }
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
