import type { Env, LineMessage } from './types';
import { push } from './line';

const MONTHLY_LIMIT = 200;

function jstMonth(now = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit' }).format(now);
}

/** Reserves estimated LINE delivery units atomically. Group audience size is unavailable, so the spec's five-person estimate is used. */
export async function budgetedPush(env: Env, to: string, messages: LineMessage[], kind: 'group' | 'user'): Promise<boolean> {
  const cost = kind === 'group' ? 5 : 1, month = jstMonth();
  await env.DB.prepare('INSERT OR IGNORE INTO notification_usage(month,sent_count) VALUES(?,0)').bind(month).run();
  const reserved = await env.DB.prepare('UPDATE notification_usage SET sent_count=sent_count+? WHERE month=? AND sent_count+?<=?').bind(cost, month, cost, MONTHLY_LIMIT).run();
  if (!reserved.meta.changes) return false;
  try { await push(env.LINE_CHANNEL_ACCESS_TOKEN, to, messages); return true; }
  catch (error) {
    await env.DB.prepare('UPDATE notification_usage SET sent_count=MAX(0,sent_count-?) WHERE month=?').bind(cost, month).run();
    throw error;
  }
}
