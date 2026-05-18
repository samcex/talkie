import { auth } from '@clerk/nextjs/server';
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

type PendingCallRow = {
  id: string;
  fromUserId: string;
  fromName: string;
  fromEmail: string;
  createdAt: number | string;
  expiresAt: number | string;
};

type CallStore = Map<string, PendingCall>;

export const dynamic = 'force-dynamic';

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

async function pendingCallsFor(userId: string) {
  const now = Date.now();
  const db = sql();
  if (db) {
    await ensureSchema();
    await db`delete from talkie_pending_calls where expires_at <= ${now}`;
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
    return calls.map((call) => ({
      ...call,
      initials: initialsFor(call.fromName as string),
      createdAt: Number(call.createdAt),
      expiresAt: Number(call.expiresAt),
    }));
  }

  prune(now);
  return [...store().values()]
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
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return new Response('Not signed in', { status: 401 });
  }

  const currentUserId = userId;
  const encoder = new TextEncoder();
  let lastPayload = '';
  let timer: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    async start(controller) {
      async function push() {
        const calls = await pendingCallsFor(currentUserId);
        const payload = JSON.stringify({ calls });
        if (payload !== lastPayload) {
          lastPayload = payload;
          controller.enqueue(encoder.encode(`event: calls\ndata: ${payload}\n\n`));
        } else {
          controller.enqueue(encoder.encode(': keepalive\n\n'));
        }
      }

      await push();
      timer = setInterval(() => {
        push().catch(() => {
          controller.error(new Error('Call stream failed'));
        });
      }, 1500);
    },
    cancel() {
      if (timer) clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
    },
  });
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
