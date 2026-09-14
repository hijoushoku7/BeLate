import type { EventRow, ParticipantRow } from './types';

export async function eventById(db: D1Database, id: string): Promise<EventRow | null> {
  return db.prepare('SELECT * FROM events WHERE id = ?').bind(id).first<EventRow>();
}

export async function activeEvent(db: D1Database, groupId: string): Promise<EventRow | null> {
  return db.prepare("SELECT * FROM events WHERE group_id = ? AND state <> 'settled' ORDER BY created_at DESC LIMIT 1").bind(groupId).first<EventRow>();
}

export async function participant(db: D1Database, eventId: string, userId: string): Promise<ParticipantRow | null> {
  return db.prepare(`SELECT p.*, u.display_name FROM participants p JOIN users u ON u.user_id=p.user_id WHERE p.event_id=? AND p.user_id=?`).bind(eventId, userId).first<ParticipantRow>();
}

export async function participants(db: D1Database, eventId: string): Promise<ParticipantRow[]> {
  return (await db.prepare(`SELECT p.*, u.display_name FROM participants p JOIN users u ON u.user_id=p.user_id WHERE p.event_id=? ORDER BY p.joined_at`).bind(eventId).all<ParticipantRow>()).results;
}

export async function upsertUser(db: D1Database, userId: string, displayName: string | null, isFriend: boolean, now = Date.now()): Promise<void> {
  await db.prepare(`INSERT INTO users(user_id,display_name,is_friend,updated_at) VALUES(?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET display_name=COALESCE(excluded.display_name,display_name),is_friend=excluded.is_friend,updated_at=excluded.updated_at`)
    .bind(userId, displayName, isFriend ? 1 : 0, now).run();
}

export async function ensureUser(db: D1Database, userId: string, displayName: string | null = null): Promise<void> {
  await db.prepare(`INSERT INTO users(user_id,display_name,is_friend,updated_at) VALUES(?,?,0,?)
    ON CONFLICT(user_id) DO UPDATE SET display_name=COALESCE(excluded.display_name,display_name),updated_at=excluded.updated_at`)
    .bind(userId, displayName, Date.now()).run();
}
