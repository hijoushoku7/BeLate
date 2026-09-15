import type { Env, EventRow } from './types';
import { eventById, participants } from './db';
import { AUTO_SETTLE_MS, LOCK_BEFORE_MS } from './domain';
import { buttons, text, uriAction } from './line';
import { budgetedPush } from './notifications';
import { settle, settlementText } from './settlement';

export async function runCron(env: Env, now = Date.now()): Promise<void> {
  const locked = await env.DB.prepare("UPDATE events SET state='locked' WHERE state='open' AND meet_at-?<=?").bind(LOCK_BEFORE_MS, now).run();
  if (locked.meta.changes) console.log(`cron: locked ${locked.meta.changes} event(s)`);

  const starts = (await env.DB.prepare("SELECT * FROM events WHERE state='locked' AND meet_at<=?").bind(now).all<EventRow>()).results;
  for (const event of starts) {
    const claimed = await env.DB.prepare("UPDATE events SET state='running' WHERE id=? AND state='locked'").bind(event.id).run();
    if (!claimed.meta.changes) continue;
    console.log(`cron: started event ${event.id}`);
    await budgetedPush(env, event.group_id, [text(`集合時刻です！罰金カウントを開始します。\n到着報告: https://liff.line.me/${env.LIFF_ID}?e=${event.id}&mode=arrive`)], 'group').catch(console.error);
    const people = await participants(env.DB, event.id);
    for (const p of people.filter(p => p.status === 'joining' && p.arrived_at == null)) {
      const reserved = await env.DB.prepare('INSERT OR IGNORE INTO reminders(event_id,user_id,sent_at) VALUES(?,?,?)').bind(event.id, p.user_id, now).run();
      if (reserved.meta.changes) {
        console.log(`cron: reminded user ${p.user_id} for event ${event.id}`);
        await budgetedPush(env, p.user_id, [text(`集合時刻を過ぎました。現在地・到着を報告してください。\nhttps://liff.line.me/${env.LIFF_ID}?e=${event.id}&mode=report`)], 'user').catch(console.error);
      }
    }
  }

  const expired = (await env.DB.prepare("SELECT * FROM events WHERE state='running' AND meet_at+?<=?").bind(AUTO_SETTLE_MS, now).all<EventRow>()).results;
  for (const event of expired) {
    const fresh = await eventById(env.DB, event.id); if (fresh?.state !== 'running') continue;
    const result = await settle(env.DB, event.id, now);
    console.log(`cron: settled event ${event.id}`);
    await env.DB.batch([
      env.DB.prepare('INSERT INTO pending_group_notifications(group_id,message,created_at) VALUES(?,?,?)')
        .bind(event.group_id, JSON.stringify(text(settlementText(result))), now),
      env.DB.prepare('INSERT INTO pending_group_notifications(group_id,message,created_at) VALUES(?,?,?)')
        .bind(event.group_id, JSON.stringify(buttons('Webで見やすく確認できます', [uriAction('Webで見る', `https://liff.line.me/${env.LIFF_ID}?e=${event.id}&mode=settlement`)])), now),
    ]);
  }
}
