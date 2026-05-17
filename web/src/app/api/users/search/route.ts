import { NextRequest, NextResponse } from 'next/server';
import { auth, clerkClient } from '@clerk/nextjs/server';
import { displayNameFor, userIsDisabled } from '@/lib/admin';

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const q = new URL(req.url).searchParams.get('q')?.trim() ?? '';
  if (q.length < 2) {
    return NextResponse.json({ users: [] });
  }

  const client = await clerkClient();
  const { data } = await client.users.getUserList({
    limit: 12,
    query: q,
  } as Parameters<typeof client.users.getUserList>[0]);

  const users = data
    .filter((u) => u.id !== userId && !userIsDisabled(u))
    .map((u) => {
      const name = displayNameFor(u);
      const email = u.emailAddresses[0]?.emailAddress ?? '';
      return {
        id: u.id,
        name,
        email,
        initials: initialsFor(name),
        lastActiveAt: u.lastSignInAt ?? u.updatedAt ?? null,
      };
    });

  return NextResponse.json({ users });
}

function initialsFor(name: string): string {
  const parts = name
    .split(/[\s@._-]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  return (parts[0]?.[0] ?? '?').toUpperCase() + (parts[1]?.[0] ?? '').toUpperCase();
}
