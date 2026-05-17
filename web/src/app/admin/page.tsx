import Link from 'next/link';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { auth, currentUser, clerkClient } from '@clerk/nextjs/server';
import {
  displayNameFor,
  isAdminUser,
  rolesFromEnv,
  userIsDisabled,
} from '@/lib/admin';
import { Logo } from '@/components/Logo';

async function setUserRole(formData: FormData) {
  'use server';
  const { userId: callerId } = await auth();
  if (!callerId) throw new Error('Not signed in');
  const caller = await currentUser();
  if (!caller || !isAdminUser(caller)) throw new Error('Not authorized');

  const targetId = formData.get('userId')?.toString();
  const role = formData.get('role')?.toString();
  if (!targetId || (role !== 'admin' && role !== 'user')) {
    throw new Error('Invalid request');
  }

  const client = await clerkClient();
  const target = await client.users.getUser(targetId);
  await client.users.updateUserMetadata(targetId, {
    publicMetadata: { ...target.publicMetadata, role },
  });
  revalidatePath('/admin');
}

async function setUserDisabled(formData: FormData) {
  'use server';
  const { userId: callerId } = await auth();
  if (!callerId) throw new Error('Not signed in');
  const caller = await currentUser();
  if (!caller || !isAdminUser(caller)) throw new Error('Not authorized');

  const targetId = formData.get('userId')?.toString();
  const disabledRaw = formData.get('disabled')?.toString();
  if (!targetId || (disabledRaw !== 'true' && disabledRaw !== 'false')) {
    throw new Error('Invalid request');
  }
  if (targetId === callerId && disabledRaw === 'true') {
    throw new Error('You cannot disable yourself');
  }

  const client = await clerkClient();
  const target = await client.users.getUser(targetId);
  await client.users.updateUserMetadata(targetId, {
    publicMetadata: {
      ...target.publicMetadata,
      disabled: disabledRaw === 'true',
    },
  });
  revalidatePath('/admin');
}

export default async function AdminPage() {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');
  const me = await currentUser();
  if (!me || !isAdminUser(me)) redirect('/');

  const client = await clerkClient();
  const { data: users, totalCount } = await client.users.getUserList({
    limit: 100,
    orderBy: '-created_at',
  });
  const adminEmails = rolesFromEnv();

  return (
    <main className="min-h-dvh bg-neutral-950 text-neutral-100 px-6 py-10">
      <div className="max-w-3xl mx-auto space-y-6">
        <header className="flex items-center gap-3">
          <Logo size={36} />
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold">Admin</h1>
            <p className="text-xs text-neutral-400">
              {totalCount} user{totalCount === 1 ? '' : 's'} · signed in as{' '}
              {displayNameFor(me)}
            </p>
          </div>
          <Link
            href="/"
            className="text-xs text-neutral-400 hover:text-neutral-100"
          >
            Back
          </Link>
        </header>

        {adminEmails.length === 0 && (
          <div className="rounded-xl bg-amber-950/40 border border-amber-800 text-amber-200 text-xs p-3">
            <strong>Tip:</strong> set <code>ADMIN_EMAILS</code> env var (comma
            separated) to auto-promote those email addresses on sign-in.
            Currently empty.
          </div>
        )}

        <section className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900 border-b border-neutral-800 text-[10px] uppercase tracking-wider text-neutral-500">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">User</th>
                <th className="text-left px-4 py-3 font-semibold hidden sm:table-cell">
                  Email
                </th>
                <th className="text-left px-4 py-3 font-semibold">Status</th>
                <th className="text-right px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const role =
                  (u.publicMetadata?.role as string | undefined) ?? 'user';
                const isEnvAdmin = u.emailAddresses.some((e) =>
                  adminEmails.includes(e.emailAddress.toLowerCase()),
                );
                const effectiveAdmin = role === 'admin' || isEnvAdmin;
                const disabled = userIsDisabled(u);
                const isSelf = u.id === userId;
                const primaryEmail =
                  u.emailAddresses[0]?.emailAddress ?? '—';
                const name = displayNameFor(u);

                return (
                  <tr
                    key={u.id}
                    className="border-b border-neutral-800 last:border-0"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium truncate max-w-[180px]">
                        {name}
                      </div>
                      <div className="text-[10px] text-neutral-500 sm:hidden truncate max-w-[180px]">
                        {primaryEmail}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-neutral-300 hidden sm:table-cell">
                      <div className="truncate max-w-[200px]">
                        {primaryEmail}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {effectiveAdmin && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-red-600/15 text-red-300 border border-red-700/50">
                            admin{isEnvAdmin && !role.includes('admin') ? ' (env)' : ''}
                          </span>
                        )}
                        {!effectiveAdmin && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-neutral-800 text-neutral-300 border border-neutral-700">
                            user
                          </span>
                        )}
                        {disabled && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-red-500/15 text-red-300 border border-red-700/50">
                            disabled
                          </span>
                        )}
                        {isSelf && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-neutral-800 text-neutral-400 border border-neutral-700">
                            you
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-1">
                        {!isEnvAdmin && (
                          <form action={setUserRole}>
                            <input
                              type="hidden"
                              name="userId"
                              value={u.id}
                            />
                            <input
                              type="hidden"
                              name="role"
                              value={role === 'admin' ? 'user' : 'admin'}
                            />
                            <button
                              type="submit"
                              className="text-[11px] px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700"
                            >
                              {role === 'admin' ? 'Demote' : 'Promote'}
                            </button>
                          </form>
                        )}
                        {!isSelf && (
                          <form action={setUserDisabled}>
                            <input
                              type="hidden"
                              name="userId"
                              value={u.id}
                            />
                            <input
                              type="hidden"
                              name="disabled"
                              value={disabled ? 'false' : 'true'}
                            />
                            <button
                              type="submit"
                              className={`text-[11px] px-2 py-1 rounded border ${
                                disabled
                                  ? 'bg-red-600/15 text-red-300 border-red-700/50 hover:bg-red-600/20'
                                  : 'bg-red-500/15 text-red-300 border-red-700/50 hover:bg-red-500/20'
                              }`}
                            >
                              {disabled ? 'Enable' : 'Disable'}
                            </button>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 space-y-2 text-xs text-neutral-400">
          <div className="font-semibold text-neutral-300">How it works</div>
          <ul className="list-disc list-inside space-y-1">
            <li>
              Roles and disabled state live in Clerk{' '}
              <code>publicMetadata</code>.
            </li>
            <li>
              <code>ADMIN_EMAILS</code> seeds admin access for new
              installations.
            </li>
            <li>
              Disabled users get a <code>403</code> from{' '}
              <code>/api/token</code> when trying to join a channel.
            </li>
          </ul>
        </section>
      </div>
    </main>
  );
}
