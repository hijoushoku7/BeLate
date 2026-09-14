import type { Env, EventRow, LineEvent, LineMessage } from './types';
import { activeEvent, ensureUser, eventById, participant, participants, upsertUser } from './db';
import { formatJst, LOCK_BEFORE_MS, PRESETS, shortcutTime } from './domain';
import { buttons, canPush, postbackAction, profile, quick, reply as lineReply, text, uriAction } from './line';
import { settle, settlementText } from './settlement';

function groupId(event: LineEvent): string | null {
  return event.source.type === 'group' ? event.source.groupId : null;
}
function userId(event: LineEvent): string | null { return 'userId' in event.source ? event.source.userId ?? null : null; }
function liffUrl(env: Env, eventId: string, mode = 'arrive'): string { return `https://liff.line.me/${env.LIFF_ID}?e=${encodeURIComponent(eventId)}&mode=${mode}`; }

const HELP = `BeLateの使い方

① 集合場所をグループに位置情報で送る（＋ → 位置情報）
② 出てきたボタンで日時と罰金を選ぶ（送った人が幹事）
③ 参加する人は「参加」ボタン。Botを友だち追加していない人は参加できません
④ 集合時刻を過ぎたら、届いたリンクから到着報告（150m以内で到着判定）

ダウトはBotとの1:1トークで「ダウト」と送信。締切は集合の2時間前で、結果は精算時にグループで全公開されます。

キーワード
・ヘルプ … この案内（@BeLate とメンションしてもOK）
・戦績 … 遅刻回数・平均遅刻・累計罰金
・精算 … 精算結果をもう一度表示
・解散 … 幹事がイベントを締める`;

// Mentions arrive inside the text ("@BeLate 戦績"), so strip them before matching keywords.
export function commandText(message: { text?: string; mention?: { mentionees?: { index: number; length: number }[] } }): string {
  const mentionees = [...(message.mention?.mentionees ?? [])].sort((a, b) => b.index - a.index);
  return mentionees.reduce((value, m) => value.slice(0, m.index) + value.slice(m.index + m.length), message.text ?? '').trim();
}

const replyContexts = new Map<string, { env: Env; groupId: string }>();

async function reply(token: string, replyToken: string | undefined, messages: LineMessage[]): Promise<void> {
  if (!replyToken) return;
  const context = replyContexts.get(replyToken);
  if (!context) return lineReply(token, replyToken, messages);
  const pending = (await context.env.DB.prepare(`SELECT id,message FROM pending_group_notifications
    WHERE group_id=? AND notified_at IS NULL ORDER BY id LIMIT ?`).bind(context.groupId, Math.max(0, 5 - messages.length)).all<{ id: number; message: string }>()).results;
  const queued = pending.map(row => JSON.parse(row.message) as LineMessage);
  await lineReply(token, replyToken, [...queued, ...messages]);
  if (pending.length) {
    await context.env.DB.prepare(`UPDATE pending_group_notifications SET notified_at=? WHERE id IN (${pending.map(() => '?').join(',')})`)
      .bind(Date.now(), ...pending.map(row => row.id)).run();
  }
  replyContexts.delete(replyToken);
}

async function knownName(env: Env, uid: string): Promise<string> {
  try { const p = await profile(env.LINE_CHANNEL_ACCESS_TOKEN, uid); await upsertUser(env.DB, uid, p.displayName, true); return p.displayName; }
  catch { await ensureUser(env.DB, uid); return uid.slice(-6); }
}

function creationTimeMessage(eventId: string, now: number): LineMessage {
  return buttons('ここで集合ですか？ 日時を選んでください', [
    postbackAction('今日19:00', `action=set_time&id=${eventId}&value=${shortcutTime(now, 0, 19)}`),
    postbackAction('今日20:00', `action=set_time&id=${eventId}&value=${shortcutTime(now, 0, 20)}`),
    postbackAction('明日12:00', `action=set_time&id=${eventId}&value=${shortcutTime(now, 1, 12)}`),
    { type: 'datetimepicker', label: '日時を選ぶ', data: `action=set_time&id=${eventId}`, mode: 'datetime', initial: new Date(shortcutTime(now, 0, 19) + 9 * 3600000).toISOString().slice(0, 16) },
  ]);
}

async function handleJoin(env: Env, event: LineEvent): Promise<void> {
  const gid = groupId(event); if (!gid) return;
  await env.DB.prepare('INSERT OR IGNORE INTO groups(line_group_id,doubt_enabled,created_at) VALUES(?,1,?)').bind(gid, Date.now()).run();
  await reply(env.LINE_CHANNEL_ACCESS_TOKEN, event.replyToken, [text(HELP), buttons('ダウト機能（遅刻するかを賭ける）を使いますか？ 結果は精算時に全公開されます。', [
    postbackAction('使う', `action=group_doubt&group=${gid}&value=1`), postbackAction('使わない', `action=group_doubt&group=${gid}&value=0`),
  ])]);
}

async function handleLocation(env: Env, event: LineEvent): Promise<void> {
  const gid = groupId(event), uid = userId(event), message = event.message;
  if (!gid || !uid || message?.latitude == null || message.longitude == null) return;
  if (await activeEvent(env.DB, gid)) { await reply(env.LINE_CHANNEL_ACCESS_TOKEN, event.replyToken, [text('このグループには進行中のイベントがあります。精算後に作成してください。')]); return; }
  const name = await knownName(env, uid);
  await env.DB.prepare('INSERT OR IGNORE INTO groups(line_group_id,doubt_enabled,created_at) VALUES(?,1,?)').bind(gid, Date.now()).run();
  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(`INSERT INTO events(id,group_id,owner_id,place_lat,place_lng,place_name,meet_at,state,base_fine,per_min,max_fine,created_at)
      VALUES(?,?,?,?,?,?,0,'draft',200,50,3000,?)`).bind(id, gid, uid, message.latitude, message.longitude, message.title || message.address || '集合場所', Date.now()).run();
    await reply(env.LINE_CHANNEL_ACCESS_TOKEN, event.replyToken, [text(`${name}さんがイベントを作成中です。`), creationTimeMessage(id, Date.now())]);
  } catch (error) {
    console.error(error); await reply(env.LINE_CHANNEL_ACCESS_TOKEN, event.replyToken, [text('イベントを作成できませんでした。進行中のイベントがないか確認してください。')]);
  }
}

async function finalizeEvent(env: Env, event: LineEvent, row: EventRow, presetName: keyof typeof PRESETS): Promise<void> {
  const uid = userId(event); if (!uid || uid !== row.owner_id || row.state !== 'draft') { await reply(env.LINE_CHANNEL_ACCESS_TOKEN, event.replyToken, [text('幹事だけが設定できます。')]); return; }
  const preset = PRESETS[presetName] ?? PRESETS.standard;
  await env.DB.prepare("UPDATE events SET state='open',base_fine=?,per_min=?,max_fine=? WHERE id=? AND state='draft'").bind(preset.baseFine, preset.perMin, preset.maxFine, row.id).run();
  const url = liffUrl(env, row.id);
  await reply(env.LINE_CHANNEL_ACCESS_TOKEN, event.replyToken, [
    text(`イベントを作成しました！\n集合: ${formatJst(row.meet_at)}\n場所: ${row.place_name ?? '指定地点'}\n罰金: ${preset.label}（${preset.baseFine}円 + ${preset.perMin}円/分、上限${preset.maxFine}円）\n参加・ダウト締切: 集合2時間前`),
    buttons('参加する人はボタンを押してください', [postbackAction('参加', `action=join_event&id=${row.id}`), postbackAction('欠席', `action=absent&id=${row.id}`), uriAction('到着・位置報告', url), uriAction('詳細設定', liffUrl(env, row.id, 'settings'))]),
  ]);
}

async function joinEvent(env: Env, lineEvent: LineEvent, row: EventRow): Promise<void> {
  const uid = userId(lineEvent); if (!uid) return;
  if (!['open'].includes(row.state) || Date.now() >= row.meet_at - LOCK_BEFORE_MS) { await reply(env.LINE_CHANNEL_ACCESS_TOKEN, lineEvent.replyToken, [text('参加受付は終了しました。')]); return; }
  const name = await knownName(env, uid);
  const friend = await canPush(env.LINE_CHANNEL_ACCESS_TOKEN, uid);
  await upsertUser(env.DB, uid, name, friend);
  if (!friend) { await reply(env.LINE_CHANNEL_ACCESS_TOKEN, lineEvent.replyToken, [text(`${name}さん、Botを友だち追加してからもう一度参加してください。`)]); return; }
  await env.DB.prepare(`INSERT INTO participants(event_id,user_id,status,joined_at) VALUES(?,?,'joining',?) ON CONFLICT(event_id,user_id) DO UPDATE SET status='joining'`).bind(row.id, uid, Date.now()).run();
  await reply(env.LINE_CHANNEL_ACCESS_TOKEN, lineEvent.replyToken, [text(`${name}さんが参加しました。ダウトはBotとの1:1トークで「ダウト」と送ってください。`)]);
}

async function absent(env: Env, lineEvent: LineEvent, row: EventRow): Promise<void> {
  const uid = userId(lineEvent); if (!uid) return;
  const p = await participant(env.DB, row.id, uid); if (!p) { await reply(env.LINE_CHANNEL_ACCESS_TOKEN, lineEvent.replyToken, [text('参加登録されていません。')]); return; }
  const lateCancel = Date.now() >= row.meet_at - LOCK_BEFORE_MS;
  await env.DB.prepare("UPDATE participants SET status='absent',late_minutes=NULL,fine=? WHERE event_id=? AND user_id=?").bind(lateCancel ? row.max_fine : 0, row.id, uid).run();
  await reply(env.LINE_CHANNEL_ACCESS_TOKEN, lineEvent.replyToken, [text(lateCancel ? `締切後の欠席として上限${row.max_fine}円が確定しました。` : '欠席を登録しました。罰金はありません。')]);
}

async function doubtMenu(env: Env, lineEvent: LineEvent, eventId?: string): Promise<void> {
  if (lineEvent.source.type !== 'user') { await reply(env.LINE_CHANNEL_ACCESS_TOKEN, lineEvent.replyToken, [text('ダウトはBotとの1:1トークで操作してください。')]); return; }
  const uid = lineEvent.source.userId;
  const row = eventId
    ? await eventById(env.DB, eventId)
    : await env.DB.prepare(`SELECT e.* FROM events e JOIN participants p ON p.event_id=e.id
        WHERE p.user_id=? AND p.status='joining' AND e.state='open' ORDER BY e.meet_at LIMIT 1`).bind(uid).first<EventRow>();
  if (!row || row.state !== 'open' || Date.now() >= row.meet_at - LOCK_BEFORE_MS) { await reply(env.LINE_CHANNEL_ACCESS_TOKEN, lineEvent.replyToken, [text('ダウト受付は終了しました。')]); return; }
  const group = await env.DB.prepare('SELECT doubt_enabled FROM groups WHERE line_group_id=?').bind(row.group_id).first<{ doubt_enabled: number }>();
  if (!group?.doubt_enabled || !(await participant(env.DB, row.id, uid))) { await reply(env.LINE_CHANNEL_ACCESS_TOKEN, lineEvent.replyToken, [text('このイベントではダウトできません。')]); return; }
  const targets = (await participants(env.DB, row.id)).filter(p => p.user_id !== uid && p.status === 'joining');
  await reply(env.LINE_CHANNEL_ACCESS_TOKEN, lineEvent.replyToken, [quick('誰をダウトしますか？', targets.map(p => postbackAction(p.display_name || p.user_id.slice(-6), `action=bet_target&id=${row.id}&target=${p.user_id}`)))]);
}

async function stats(env: Env, lineEvent: LineEvent): Promise<void> {
  const gid = groupId(lineEvent); if (!gid) { await reply(env.LINE_CHANNEL_ACCESS_TOKEN, lineEvent.replyToken, [text('戦績はグループで確認してください。')]); return; }
  const rows = (await env.DB.prepare(`SELECT u.display_name,p.user_id,COUNT(*) events,
    SUM(CASE WHEN COALESCE(p.late_minutes,0)>0 THEN 1 ELSE 0 END) late_count,
    ROUND(AVG(CASE WHEN COALESCE(p.late_minutes,0)>0 THEN p.late_minutes END),1) avg_late,
    SUM(COALESCE(p.fine,0)) total_fine FROM participants p JOIN events e ON e.id=p.event_id JOIN users u ON u.user_id=p.user_id
    WHERE e.group_id=? AND e.state='settled' AND p.status='joining' GROUP BY p.user_id,u.display_name ORDER BY late_count DESC,total_fine DESC`).bind(gid).all<Record<string, string | number | null>>()).results;
  await reply(env.LINE_CHANNEL_ACCESS_TOKEN, lineEvent.replyToken, [text(`【戦績】\n${rows.map(r => `${r.display_name || String(r.user_id).slice(-6)}: 遅刻${r.late_count}/${r.events}回、平均${r.avg_late ?? 0}分、累計${Number(r.total_fine).toLocaleString()}円`).join('\n') || 'まだ戦績はありません'}`)]);
}

async function finish(env: Env, lineEvent: LineEvent, command: string): Promise<void> {
  const gid = groupId(lineEvent), uid = userId(lineEvent); if (!gid || !uid) return;
  const row = command === '精算'
    ? await env.DB.prepare('SELECT * FROM events WHERE group_id=? ORDER BY created_at DESC LIMIT 1').bind(gid).first<EventRow>()
    : await activeEvent(env.DB, gid);
  if (!row) { await reply(env.LINE_CHANNEL_ACCESS_TOKEN, lineEvent.replyToken, [text('対象のイベントはありません。')]); return; }
  if (command === '解散') {
    if (row.owner_id !== uid) { await reply(env.LINE_CHANNEL_ACCESS_TOKEN, lineEvent.replyToken, [text('解散できるのは幹事だけです。')]); return; }
    if (row.state === 'draft') {
      await env.DB.prepare('DELETE FROM events WHERE id=?').bind(row.id).run();
      await reply(env.LINE_CHANNEL_ACCESS_TOKEN, lineEvent.replyToken, [text('作成途中のイベントを破棄しました。')]); return;
    }
    const resolved = row.state === 'settled' ? await buildStoredSettlement(env, row.id) : await settle(env.DB, row.id);
    await reply(env.LINE_CHANNEL_ACCESS_TOKEN, lineEvent.replyToken, [text(settlementText(resolved))]); return;
  }
  if (row.state !== 'settled') { await reply(env.LINE_CHANNEL_ACCESS_TOKEN, lineEvent.replyToken, [text('イベントはまだ精算されていません。罰金カウントは継続中です。')]); return; }
  const resolved = await buildStoredSettlement(env, row.id);
  await reply(env.LINE_CHANNEL_ACCESS_TOKEN, lineEvent.replyToken, [text(settlementText(resolved))]);
}

async function buildStoredSettlement(env: Env, eventId: string) {
  const domain = await import('./domain');
  const people = await participants(env.DB, eventId); const names = new Map(people.map(p => [p.user_id, p.display_name || p.user_id.slice(-6)]));
  const bets = (await env.DB.prepare(`SELECT b.*,bu.display_name bettor_name,tu.display_name target_name FROM bets b JOIN users bu ON bu.user_id=b.bettor_id JOIN users tu ON tu.user_id=b.target_id WHERE event_id=?`).bind(eventId).all<Record<string, string | number | null>>()).results;
  const transfers = domain.fineTransfers(people), lines: string[] = [];
  const targets = new Map<string, typeof bets>();
  bets.forEach(b => targets.set(String(b.target_id), [...(targets.get(String(b.target_id)) ?? []), b]));
  for (const [targetId, targetBets] of targets) {
    const winners = targetBets.filter(b => Number(b.payout) >= 0), losers = targetBets.filter(b => Number(b.payout) < 0);
    lines.push(`${names.get(targetId) ?? targetId}の遅刻に ${targetBets.length}人\n 当たり: ${winners.map(b => b.bettor_name).join('、') || 'なし'} / はずれ: ${losers.map(b => b.bettor_name).join('、') || 'なし'}`);
  }
  for (const targetBets of targets.values()) {
    if (!targetBets.some(bet => Number(bet.payout) > 0)) continue;
    for (const bet of targetBets) {
      const payout = Number(bet.payout ?? 0);
      if (payout < 0) transfers.push({ from: String(bet.bettor_id), to: '__doubt_pool__', amount: -payout });
      if (payout > 0) transfers.push({ from: '__doubt_pool__', to: String(bet.bettor_id), amount: payout });
    }
  }
  return { doubtText: lines.join('\n') || 'ダウトはありませんでした', debts: domain.netDebts(transfers), names };
}

async function handlePostback(env: Env, event: LineEvent): Promise<void> {
  const q = new URLSearchParams(event.postback?.data ?? ''), action = q.get('action');
  if (action === 'group_doubt') { const gid = groupId(event); if (!gid || gid !== q.get('group')) return; await env.DB.prepare('UPDATE groups SET doubt_enabled=? WHERE line_group_id=?').bind(q.get('value') === '1' ? 1 : 0, gid).run(); await reply(env.LINE_CHANNEL_ACCESS_TOKEN, event.replyToken, [text(`ダウト機能を${q.get('value') === '1' ? '有効' : '無効'}にしました。`)]); return; }
  const id = q.get('id'); if (!id) return; const row = await eventById(env.DB, id); if (!row) { await reply(env.LINE_CHANNEL_ACCESS_TOKEN, event.replyToken, [text('イベントが見つかりません。')]); return; }
  if (action === 'set_time') {
    if (userId(event) !== row.owner_id || row.state !== 'draft') { await reply(env.LINE_CHANNEL_ACCESS_TOKEN, event.replyToken, [text('幹事だけが設定できます。')]); return; }
    const raw = q.get('value') ?? event.postback?.params?.datetime; const meetAt = raw && /^\d+$/.test(raw) ? Number(raw) : Date.parse(`${raw}:00+09:00`);
    if (!meetAt || meetAt <= Date.now()) { await reply(env.LINE_CHANNEL_ACCESS_TOKEN, event.replyToken, [text('未来の日時を選んでください。')]); return; }
    await env.DB.prepare('UPDATE events SET meet_at=? WHERE id=?').bind(meetAt, id).run();
    await reply(env.LINE_CHANNEL_ACCESS_TOKEN, event.replyToken, [buttons(`${formatJst(meetAt)} 集合。罰金設定を選んでください`, [postbackAction('ゆるめ', `action=finalize&id=${id}&preset=light`), postbackAction('標準', `action=finalize&id=${id}&preset=standard`), postbackAction('きつめ', `action=finalize&id=${id}&preset=strict`), uriAction('細かく設定', liffUrl(env, id, 'settings'))])]); return;
  }
  if (action === 'finalize') { await finalizeEvent(env, event, row, (q.get('preset') || 'standard') as keyof typeof PRESETS); return; }
  if (action === 'join_event') { await joinEvent(env, event, row); return; }
  if (action === 'absent') { await absent(env, event, row); return; }
  if (action === 'bet_target') {
    const uid = userId(event), target = q.get('target'); if (!uid || !target || event.source.type !== 'user' || row.state !== 'open' || Date.now() >= row.meet_at - LOCK_BEFORE_MS) return;
    await reply(env.LINE_CHANNEL_ACCESS_TOKEN, event.replyToken, [quick('予想を選んでください（掛け金300円）', [postbackAction('遅刻する', `action=bet&id=${id}&target=${target}&late=1`), postbackAction('遅刻しない', `action=bet&id=${id}&target=${target}&late=0`)])]); return;
  }
  if (action === 'bet') {
    const uid = userId(event), target = q.get('target'); if (!uid || !target || uid === target || event.source.type !== 'user' || row.state !== 'open' || Date.now() >= row.meet_at - LOCK_BEFORE_MS) { await reply(env.LINE_CHANNEL_ACCESS_TOKEN, event.replyToken, [text('このダウトは受け付けられません。')]); return; }
    if (!(await participant(env.DB, id, uid)) || !(await participant(env.DB, id, target))) return;
    const result = await env.DB.prepare('INSERT OR IGNORE INTO bets(event_id,bettor_id,target_id,predicts_late,stake) VALUES(?,?,?,?,300)').bind(id, uid, target, q.get('late') === '1' ? 1 : 0).run();
    await reply(env.LINE_CHANNEL_ACCESS_TOKEN, event.replyToken, [text(result.meta.changes ? 'ダウトを秘密で受け付けました。結果は精算時に公開されます。' : 'その人へのダウトは登録済みです。')]);
  }
}

export async function handleLineEvent(env: Env, event: LineEvent): Promise<void> {
  const gid = groupId(event);
  if (gid && event.replyToken) replyContexts.set(event.replyToken, { env, groupId: gid });
  if (event.type === 'join') return handleJoin(env, event);
  if (event.type === 'message' && event.message?.type === 'location') return handleLocation(env, event);
  if (event.type === 'postback') return handlePostback(env, event);
  if (event.type !== 'message' || event.message?.type !== 'text') return;
  const value = commandText(event.message);
  const mentionedSelf = event.message.mention?.mentionees?.some(m => m.isSelf) ?? false;
  if (value === '戦績') return stats(env, event);
  if (value === '精算' || value === '解散') return finish(env, event, value);
  if (value === 'ダウト') return doubtMenu(env, event);
  if (value === 'ヘルプ' || value === 'help' || mentionedSelf) return reply(env.LINE_CHANNEL_ACCESS_TOKEN, event.replyToken, [text(HELP)]);
  await reply(env.LINE_CHANNEL_ACCESS_TOKEN, event.replyToken, []);
}
