import { NextResponse } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';
import { isAdminUser } from '@/lib/admin';
import { ensureSchema, hasDatabase } from '@/lib/db';

async function initDb() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }
  const user = await currentUser();
  if (!isAdminUser(user)) {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 });
  }
  if (!hasDatabase()) {
    return NextResponse.json(
      { error: 'DATABASE_URL is not configured' },
      { status: 500 },
    );
  }

  await ensureSchema();
  return NextResponse.json({ ok: true });
}

export async function GET() {
  return initDb();
}

export async function POST() {
  return initDb();
}
