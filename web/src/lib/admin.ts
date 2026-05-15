import { auth, currentUser, clerkClient } from '@clerk/nextjs/server';
import type { User } from '@clerk/nextjs/server';

export type UserRole = 'admin' | 'user';

export function rolesFromEnv(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminUser(user: User | null): boolean {
  if (!user) return false;
  const role = (user.publicMetadata?.role as UserRole | undefined) ?? 'user';
  if (role === 'admin') return true;
  const adminEmails = rolesFromEnv();
  if (adminEmails.length === 0) return false;
  return user.emailAddresses.some((e) =>
    adminEmails.includes(e.emailAddress.toLowerCase()),
  );
}

export function userIsDisabled(user: User | null): boolean {
  if (!user) return false;
  return user.publicMetadata?.disabled === true;
}

export function displayNameFor(user: User): string {
  return (
    user.fullName ||
    user.username ||
    user.firstName ||
    user.emailAddresses[0]?.emailAddress ||
    user.id
  );
}

export async function requireAdmin(): Promise<User> {
  const { userId } = await auth();
  if (!userId) throw new Error('Not signed in');
  const user = await currentUser();
  if (!user || !isAdminUser(user)) throw new Error('Not authorized');
  return user;
}

export { clerkClient };
