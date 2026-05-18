import { neon } from '@neondatabase/serverless';

export type Sql = ReturnType<typeof neon>;

let sqlClient: Sql | null = null;
let schemaReady: Promise<void> | null = null;

export function hasDatabase() {
  return Boolean(process.env.DATABASE_URL);
}

export function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!sqlClient) sqlClient = neon(url);
  return sqlClient;
}

export async function ensureSchema() {
  const db = sql();
  if (!db) return false;

  if (!schemaReady) {
    schemaReady = (async () => {
      await db`
        create table if not exists talkie_contacts (
          owner_user_id text not null,
          contact_user_id text not null,
          name text not null,
          email text not null default '',
          initials text not null default '?',
          last_active_at bigint,
          saved_at bigint not null,
          primary key (owner_user_id, contact_user_id)
        )
      `;

      await db`
        create index if not exists talkie_contacts_owner_saved_idx
        on talkie_contacts (owner_user_id, saved_at desc)
      `;

      await db`
        create table if not exists talkie_pending_calls (
          id text primary key,
          from_user_id text not null,
          from_name text not null,
          from_email text not null default '',
          target_user_id text not null,
          target_name text not null,
          created_at bigint not null,
          expires_at bigint not null
        )
      `;

      await db`
        create index if not exists talkie_pending_calls_target_expires_idx
        on talkie_pending_calls (target_user_id, expires_at)
      `;

      await db`
        create table if not exists talkie_call_statuses (
          id text primary key,
          from_user_id text not null,
          target_user_id text not null,
          status text not null,
          created_at bigint not null,
          updated_at bigint not null,
          expires_at bigint not null
        )
      `;

      await db`
        create index if not exists talkie_call_statuses_participants_idx
        on talkie_call_statuses (from_user_id, target_user_id, updated_at desc)
      `;
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }

  await schemaReady;
  return true;
}
