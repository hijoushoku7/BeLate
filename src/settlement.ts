import { doubtOutcomes, fineTransfers, giftCount, GIFT_URL, netDebts, type Debt } from './domain';
import { eventById, participants } from './db';

// debts は罰金（円）だけ、gifts はダウトの勝ち負け（ギフト本数）だけ。混ぜない。
export interface Settlement { doubtText: string; debts: Debt[]; gifts: Debt[]; names: Map<string, string>; }

export async function settle(db: D1Database, eventId: string, now = Date.now()): Promise<Settlement> {
  const event = await eventById(db, eventId);
  if (!event) throw new Error('Event not found');
  const people = await participants(db, eventId);
  const names = new Map(people.map(p => [p.user_id, p.display_name || p.user_id.slice(-6)]));

  // Settling before the meeting time means the event was cancelled in advance: nobody was late, so no fines
  // (and no-shows must not be treated as 180-minute latecomers) and the unresolved doubts are void.
  const cancelledEarly = now < event.meet_at;
  if (cancelledEarly) {
    await db.batch([
      db.prepare('UPDATE participants SET late_minutes=NULL,fine=0 WHERE event_id=?').bind(eventId),
      db.prepare('DELETE FROM bets WHERE event_id=?').bind(eventId),
    ]);
    people.forEach(p => { p.late_minutes = null; p.fine = 0; });
  } else {
    const updates = people.filter(p => p.status === 'joining' && p.arrived_at == null).map(p => {
      p.late_minutes = 180; p.fine = event.max_fine;
      return db.prepare('UPDATE participants SET late_minutes=180,fine=? WHERE event_id=? AND user_id=? AND arrived_at IS NULL').bind(event.max_fine, eventId, p.user_id);
    });
    if (updates.length) await db.batch(updates);
  }

  const bets = (await db.prepare(`SELECT b.*, bu.display_name bettor_name, tu.display_name target_name
    FROM bets b JOIN users bu ON bu.user_id=b.bettor_id JOIN users tu ON tu.user_id=b.target_id WHERE event_id=?`)
    .bind(eventId).all<Record<string, string | number | null>>()).results;
  const transfers = fineTransfers(people);
  const giftTransfers: Debt[] = [];
  const wasLate = (targetId: string) => {
    const target = people.find(p => p.user_id === targetId);
    return (target?.late_minutes ?? 0) > 0 || target?.status === 'absent';
  };
  const outcomes = doubtOutcomes(bets, wasLate);
  const resultLines: string[] = [];
  const payoutUpdates: D1PreparedStatement[] = [];
  const byTarget = new Map<string, typeof outcomes>();
  for (const o of outcomes) byTarget.set(o.targetId, [...(byTarget.get(o.targetId) ?? []), o]);
  for (const [targetId, targetOutcomes] of byTarget) {
    const name = (id: string) => names.get(id) ?? id;
    resultLines.push(`${name(targetId)}の遅刻に ${targetOutcomes.length}人\n 当たり: ${targetOutcomes.filter(o => o.won).map(o => name(o.bettorId)).join('、') || 'なし'} / はずれ: ${targetOutcomes.filter(o => !o.won).map(o => name(o.bettorId)).join('、') || 'なし'}`);
    for (const o of targetOutcomes) {
      giftTransfers.push(o.transfer);
      payoutUpdates.push(db.prepare('UPDATE bets SET payout=? WHERE event_id=? AND bettor_id=? AND target_id=?').bind(o.payout, eventId, o.bettorId, targetId));
    }
  }
  await db.batch([
    ...payoutUpdates,
    db.prepare("UPDATE events SET state='settled',settled_at=? WHERE id=? AND state<>'settled'").bind(now, eventId),
  ]);
  return { doubtText: resultLines.length ? resultLines.join('\n') : 'ダウトはありませんでした', debts: netDebts(transfers), gifts: netDebts(giftTransfers), names };
}

export async function storedSettlement(db: D1Database, eventId: string): Promise<Settlement> {
  const people = await participants(db, eventId);
  const names = new Map(people.map(p => [p.user_id, p.display_name || p.user_id.slice(-6)]));
  const bets = (await db.prepare(`SELECT b.*,bu.display_name bettor_name,tu.display_name target_name
    FROM bets b JOIN users bu ON bu.user_id=b.bettor_id JOIN users tu ON tu.user_id=b.target_id WHERE event_id=?`)
    .bind(eventId).all<Record<string, string | number | null>>()).results;
  const transfers = fineTransfers(people), giftTransfers: Debt[] = [], lines: string[] = [];
  const targets = new Map<string, typeof bets>();
  bets.forEach(b => targets.set(String(b.target_id), [...(targets.get(String(b.target_id)) ?? []), b]));
  for (const [targetId, targetBets] of targets) {
    const winners = targetBets.filter(b => Number(b.payout) >= 0), losers = targetBets.filter(b => Number(b.payout) < 0);
    lines.push(`${names.get(targetId) ?? targetId}の遅刻に ${targetBets.length}人\n 当たり: ${winners.map(b => b.bettor_name).join('、') || 'なし'} / はずれ: ${losers.map(b => b.bettor_name).join('、') || 'なし'}`);
    for (const bet of targetBets) {
      const payout = Number(bet.payout ?? 0);
      if (payout > 0) giftTransfers.push({ from: targetId, to: String(bet.bettor_id), amount: payout });
      if (payout < 0) giftTransfers.push({ from: String(bet.bettor_id), to: targetId, amount: -payout });
    }
  }
  return { doubtText: lines.join('\n') || 'ダウトはありませんでした', debts: netDebts(transfers), gifts: netDebts(giftTransfers), names };
}

export function settlementText(result: Settlement): string {
  const name = (id: string) => result.names.get(id) ?? id;
  const fines = result.debts.map(d => `${name(d.from)} → ${name(d.to)}  ${d.amount.toLocaleString('ja-JP')}円`);
  const gifts = result.gifts.map(d => `${name(d.from)} → ${name(d.to)}  ${giftCount(d.amount)}`);
  return `【ダウト結果】\n${result.doubtText}\n\n【罰金の精算】\n${fines.join('\n') || '支払いはありません'}\n\n【ダウトのギフト】（罰金とは別）\n${gifts.length ? `${gifts.join('\n')}\n${GIFT_URL}` : 'やり取りはありません'}\n支払いは各自でお願いします`;
}
