import { Hono } from 'hono';
import type { Env } from './types';
import { activeEvent, ensureUser, eventById, groupSettings, participant, participants } from './db';
import { ARRIVAL_RADIUS_M, GIFT_NAME, GIFT_URL, calculateFine, distanceMeters, formatJst, lateMinutes, LOCK_BEFORE_MS, validFine } from './domain';
import { buttons, isGroupMember, postbackAction, text, uriAction, verifyIdToken } from './line';
import { settle, settlementText, storedSettlement } from './settlement';

export const api = new Hono<{ Bindings: Env }>();

api.get('/events/:id', async c => {
  const event = await eventById(c.env.DB, c.req.param('id'));
  if (!event) return c.json({ error: 'イベントが見つかりません' }, 404);
  const people = (await c.env.DB.prepare(`SELECT u.display_name,p.status,p.arrived_at,p.fine,
    (SELECT distance_m FROM reports r WHERE r.event_id=p.event_id AND r.user_id=p.user_id ORDER BY r.reported_at DESC LIMIT 1) distance_m
    FROM participants p JOIN users u ON u.user_id=p.user_id WHERE p.event_id=? AND p.status='joining' ORDER BY p.joined_at`)
    .bind(event.id).all<{ display_name: string | null; status: string; arrived_at: number | null; fine: number | null; distance_m: number | null }>()).results;
  return c.json({
    id: event.id, placeName: event.place_name, meetAt: event.meet_at, state: event.state, baseFine: event.base_fine, perMin: event.per_min, maxFine: event.max_fine,
    participants: people.map(p => ({ name: p.display_name, arrived: p.arrived_at != null, fine: p.fine, distance: p.distance_m })),
  });
});

api.post('/arrive', async c => {
  const body = await c.req.json<{ eventId?: string; idToken?: string; displayName?: string; lat?: number; lng?: number; arrive?: boolean; manual?: boolean }>();
  if (!body.eventId || !body.idToken) return c.json({ error: 'eventId と IDトークンが必要です' }, 400);
  const verifiedUserId = await verifyIdToken(body.idToken, c.env.LIFF_ID);
  if (!verifiedUserId) return c.json({ error: 'LINE認証を確認できません' }, 401);
  const event = await eventById(c.env.DB, body.eventId);
  if (!event || event.state === 'draft' || event.state === 'settled') return c.json({ error: '報告できるイベントではありません' }, 409);
  await ensureUser(c.env.DB, verifiedUserId, body.displayName ?? null);
  const person = await participant(c.env.DB, event.id, verifiedUserId);
  if (!person || person.status !== 'joining') return c.json({ error: '参加者ではありません' }, 403);
  let distance: number | null = null;
  if (!body.manual) {
    if (!Number.isFinite(body.lat) || !Number.isFinite(body.lng) || Math.abs(body.lat!) > 90 || Math.abs(body.lng!) > 180) return c.json({ error: '正しい位置情報が必要です' }, 400);
    distance = distanceMeters(event.place_lat, event.place_lng, body.lat!, body.lng!);
    await c.env.DB.prepare('INSERT INTO reports(event_id,user_id,lat,lng,distance_m,reported_at) VALUES(?,?,?,?,?,?)').bind(event.id, verifiedUserId, body.lat, body.lng, distance, Date.now()).run();
  }
  const shouldArrive = Boolean(body.arrive) && (body.manual || (distance != null && distance <= ARRIVAL_RADIUS_M));
  let arrivalMessage = distance == null ? '手動申告を受け付けました。グループ内で確認してください。' : `集合地点まで約${distance}mです。`;
  let newlyArrived = false;
  if (shouldArrive) {
    const now = Date.now(), minutes = lateMinutes(event.meet_at, now), fine = calculateFine(event.meet_at, now, event.base_fine, event.per_min, event.max_fine);
    const result = await c.env.DB.prepare(`UPDATE participants SET arrived_at=?,arrival_lat=?,arrival_lng=?,late_minutes=?,fine=? WHERE event_id=? AND user_id=? AND arrived_at IS NULL`)
      .bind(now, body.lat ?? null, body.lng ?? null, minutes, fine, event.id, verifiedUserId).run();
    newlyArrived = result.meta.changes > 0;
    arrivalMessage = newlyArrived ? `${person.display_name ?? '参加者'}さんが到着（${minutes ? `${minutes}分遅刻 / ${fine}円` : '早着・定時 / 0円'}）` : '到着報告済みです。';
  } else if (body.arrive && distance != null) arrivalMessage += ` 150m以内で到着になります。`;

  if (newlyArrived || (!body.arrive && distance != null)) {
    const notification = text(newlyArrived ? arrivalMessage : `${person.display_name ?? '参加者'}さん: 集合地点まで約${distance}m`);
    await c.env.DB.prepare('INSERT INTO pending_group_notifications(group_id,message,created_at) VALUES(?,?,?)').bind(event.group_id, JSON.stringify(notification), Date.now()).run();
  }
  if (newlyArrived && event.state === 'running') {
    const remaining = await c.env.DB.prepare(`SELECT COUNT(*) n FROM participants WHERE event_id=? AND status='joining' AND arrived_at IS NULL`).bind(event.id).first<{ n: number }>();
    const fresh = remaining?.n === 0 ? await eventById(c.env.DB, event.id) : null;
    if (fresh?.state === 'running') {
      const resolved = await settle(c.env.DB, event.id);
      await c.env.DB.batch([
        c.env.DB.prepare('INSERT INTO pending_group_notifications(group_id,message,created_at) VALUES(?,?,?)').bind(event.group_id, JSON.stringify(text(settlementText(resolved))), Date.now()),
        c.env.DB.prepare('INSERT INTO pending_group_notifications(group_id,message,created_at) VALUES(?,?,?)').bind(event.group_id, JSON.stringify(buttons('Webで見やすく確認できます', [uriAction('Webで見る', `https://liff.line.me/${c.env.LIFF_ID}?e=${event.id}&mode=settlement`)])), Date.now()),
      ]);
    }
  }
  return c.json({ ok: true, arrived: shouldArrive, distance, message: arrivalMessage });
});

api.post('/settings', async c => {
  const b = await c.req.json<{ eventId?: string; userId?: string; meetAt?: number; baseFine?: number; perMin?: number; maxFine?: number }>();
  if (!b.eventId || !b.userId) return c.json({ error: '必須項目がありません' }, 400);
  const event = await eventById(c.env.DB, b.eventId); if (!event) return c.json({ error: 'イベントが見つかりません' }, 404);
  if (event.owner_id !== b.userId) return c.json({ error: '幹事だけが変更できます' }, 403);
  if (event.state === 'running' || event.state === 'settled') return c.json({ error: '開始後は変更できません' }, 409);
  const meetAt = Number(b.meetAt), base = Number(b.baseFine), per = Number(b.perMin), max = Number(b.maxFine);
  if (!Number.isFinite(meetAt) || meetAt <= Date.now() || !validFine(base, per, max)) return c.json({ error: '設定値が不正です' }, 400);
  const changedTime = event.meet_at > 0 && event.meet_at !== meetAt;
  const wasLocked = event.state === 'locked';
  if (wasLocked && changedTime) await c.env.DB.prepare('DELETE FROM bets WHERE event_id=?').bind(event.id).run();
  const nextState = meetAt - LOCK_BEFORE_MS <= Date.now() ? 'locked' : 'open';
  await c.env.DB.prepare('UPDATE events SET meet_at=?,base_fine=?,per_min=?,max_fine=?,state=? WHERE id=?').bind(meetAt, base, per, max, nextState, event.id).run();
  if (wasLocked && changedTime) await c.env.DB.prepare('INSERT INTO pending_group_notifications(group_id,message,created_at) VALUES(?,?,?)').bind(event.group_id, JSON.stringify(text('集合時刻が変更されたためダウトは全て無効になりました。')), Date.now()).run();
  if (event.state === 'draft') {
    const url = `https://liff.line.me/${c.env.LIFF_ID}?e=${event.id}&mode=arrive`;
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO pending_group_notifications(group_id,message,created_at) VALUES(?,?,?)').bind(event.group_id, JSON.stringify(text(`イベントを作成しました！\n集合: ${formatJst(meetAt)}\n罰金: ${base}円 + ${per}円/分（上限${max}円）`)), Date.now()),
      c.env.DB.prepare('INSERT INTO pending_group_notifications(group_id,message,created_at) VALUES(?,?,?)').bind(event.group_id, JSON.stringify(buttons('参加する人はボタンを押してください', [postbackAction('参加', `action=join_event&id=${event.id}`), postbackAction('欠席', `action=absent&id=${event.id}`), uriAction('到着・位置報告', url)])), Date.now()),
    ]);
  } else if (changedTime && !wasLocked) {
    await c.env.DB.prepare('INSERT INTO pending_group_notifications(group_id,message,created_at) VALUES(?,?,?)').bind(event.group_id, JSON.stringify(text(`集合時刻が ${formatJst(meetAt)} に変更されました。`)), Date.now()).run();
  }
  return c.json({ ok: true, message: `設定しました: ${formatJst(meetAt)}`, state: nextState });
});

api.get('/group/:id', async c => {
  const group = await groupSettings(c.env.DB, c.req.param('id'));
  return c.json({ baseFine: group.base_fine, perMin: group.per_min, maxFine: group.max_fine });
});

api.post('/group-settings', async c => {
  const b = await c.req.json<{ groupId?: string; idToken?: string; baseFine?: number; perMin?: number; maxFine?: number }>();
  if (!b.groupId || !b.idToken) return c.json({ error: 'groupId と IDトークンが必要です' }, 400);
  const uid = await verifyIdToken(b.idToken, c.env.LIFF_ID);
  if (!uid) return c.json({ error: 'LINE認証を確認できません' }, 401);
  if (!(await isGroupMember(c.env.LINE_CHANNEL_ACCESS_TOKEN, b.groupId, uid))) return c.json({ error: 'このグループのメンバーだけが変更できます' }, 403);
  const base = Number(b.baseFine), per = Number(b.perMin), max = Number(b.maxFine);
  if (!validFine(base, per, max)) return c.json({ error: '設定値が不正です' }, 400);
  await c.env.DB.prepare(`INSERT INTO groups(line_group_id,doubt_enabled,created_at,base_fine,per_min,max_fine) VALUES(?,1,?,?,?,?)
    ON CONFLICT(line_group_id) DO UPDATE SET base_fine=excluded.base_fine,per_min=excluded.per_min,max_fine=excluded.max_fine`)
    .bind(b.groupId, Date.now(), base, per, max).run();
  return c.json({ ok: true, message: `保存しました: ${base}円 + ${per}円/分（上限${max}円）` });
});

api.get('/settlement/:id', async c => {
  const event = await eventById(c.env.DB, c.req.param('id')); if (!event) return c.json({ error: 'not found' }, 404);
  if (event.state !== 'settled') return c.json({ error: '未精算です' }, 409);
  const people = await participants(c.env.DB, event.id);
  const resolved = await storedSettlement(c.env.DB, event.id);
  return c.json({
    eventId: event.id,
    participants: people.map(p => ({ name: p.display_name, lateMinutes: p.late_minutes, fine: p.fine })),
    doubtText: resolved.doubtText,
    debts: resolved.debts.map(d => ({ from: resolved.names.get(d.from) ?? d.from, to: resolved.names.get(d.to) ?? d.to, amount: d.amount })),
    gifts: resolved.gifts.map(d => ({ from: resolved.names.get(d.from) ?? d.from, to: resolved.names.get(d.to) ?? d.to, count: d.amount })),
    giftName: GIFT_NAME, giftUrl: GIFT_URL,
  });
});
