import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { ensureSchema, sql } from '@/lib/db';

type ContactBody = {
  id?: string;
  name?: string;
  email?: string;
  initials?: string;
  lastActiveAt?: number | null;
};

type ContactRow = {
  id: string;
  name: string;
  email: string;
  initials: string;
  lastActiveAt: number | string | null;
  savedAt: number | string;
};

const MAX = 32;

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const db = sql();
  if (!db) {
    return NextResponse.json({ contacts: [], persistent: false });
  }

  await ensureSchema();
  const contacts = (await db`
    select
      contact_user_id as id,
      name,
      email,
      initials,
      last_active_at as "lastActiveAt",
      saved_at as "savedAt"
    from talkie_contacts
    where owner_user_id = ${userId}
    order by saved_at desc
    limit ${MAX}
  `) as ContactRow[];

  return NextResponse.json({
    contacts: contacts.map((contact) => ({
      ...contact,
      lastActiveAt:
        contact.lastActiveAt === null ? null : Number(contact.lastActiveAt),
      savedAt: Number(contact.savedAt),
    })),
    persistent: true,
  });
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const db = sql();
  if (!db) {
    return NextResponse.json(
      { error: 'DATABASE_URL is not configured' },
      { status: 501 },
    );
  }

  let body: ContactBody = {};
  try {
    body = (await req.json()) as ContactBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const id = body.id?.trim();
  const name = body.name?.trim();
  if (!id || !name) {
    return NextResponse.json(
      { error: 'id and name are required' },
      { status: 400 },
    );
  }

  await ensureSchema();
  const now = Date.now();
  await db`
    insert into talkie_contacts (
      owner_user_id,
      contact_user_id,
      name,
      email,
      initials,
      last_active_at,
      saved_at
    )
    values (
      ${userId},
      ${id},
      ${name},
      ${body.email?.trim() ?? ''},
      ${body.initials?.trim() || initialsFor(name)},
      ${body.lastActiveAt ?? null},
      ${now}
    )
    on conflict (owner_user_id, contact_user_id)
    do update set
      name = excluded.name,
      email = excluded.email,
      initials = excluded.initials,
      last_active_at = excluded.last_active_at,
      saved_at = excluded.saved_at
  `;

  return GET();
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
  if (!db) {
    return NextResponse.json(
      { error: 'DATABASE_URL is not configured' },
      { status: 501 },
    );
  }

  await ensureSchema();
  await db`
    delete from talkie_contacts
    where owner_user_id = ${userId}
      and contact_user_id = ${id}
  `;

  return GET();
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
