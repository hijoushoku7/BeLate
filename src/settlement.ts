import { fineTransfers, netDebts, type Debt } from './domain';
import { eventById, participants } from './db';

export interface Settlement { doubtText: string; debts: Debt[]; names: Map<string, string>; }

export async function settle(db: D1Database, eventId: string, now = Date.now()): Promise<Settlement> {
  const event = await eventById(db, eventId);
  if (!event) throw new Error('Event not found');
  const people = await participants(db, eventId);
  const names = new Map(people.map(p => [p.user_id, p.display_name || p.user_id.slice(-6)]));

  const updates: D1PreparedStatement[] = [];
  for (const p of people.filter(p => p.status === 'joining' && p.arrived_at == null)) {
    updates.push(db.prepare('UPDATE participants SET late_minutes=180,fine=? WHERE event_id=? AND user_id=? AND arrived_at IS NULL').bind(event.max_fine, eventId, p.user_id));
    p.late_minutes = 180; p.fine = event.max_fine;
  }
  if (updates.length) await db.batch(updates);

  const bets = (await db.prepare(`SELECT b.*, bu.display_name bettor_name, tu.display_name target_name
    FROM bets b JOIN users bu ON bu.user_id=b.bettor_id JOIN users tu ON tu.user_id=b.target_id WHERE event_id=?`)
    .bind(eventId).all<Record<string, string | number | null>>()).results;
  const transfers = fineTransfers(people);
  const resultLines: string[] = [];
  const byTarget = new Map<string, typeof bets>();
  for (const bet of bets) byTarget.set(String(bet.target_id), [...(byTarget.get(String(bet.target_id)) ?? []), bet]);
  const payoutUpdates: D1PreparedStatement[] = [];
  for (const [targetId, targetBets] of byTarget) {
    const target = people.find(p => p.user_id === targetId);
    const wasLate = (target?.late_minutes ?? 0) > 0 || target?.status === 'absent';
    const winners = targetBets.filter(b => Boolean(b.predicts_late) === wasLate);
    const losers = targetBets.filter(b => Boolean(b.predicts_late) !== wasLate);
    const winnerReceipts = new Map<string, number>();
    resultLines.push(`${names.get(targetId) ?? targetId}の遅刻に ${targetBets.length}人\n 当たり: ${winners.map(b => b.bettor_name).join('、') || 'なし'} / はずれ: ${losers.map(b => b.bettor_name).join('、') || 'なし'}`);
    for (const loser of losers) {
      if (winners.length) {
        let remainder = Number(loser.stake) - Math.floor(Number(loser.stake) / winners.length) * winners.length;
        winners.forEach(w => {
          const amount = Math.floor(Number(loser.stake) / winners.length) + (remainder-- > 0 ? 1 : 0);
          transfers.push({ from: String(loser.bettor_id), to: String(w.bettor_id), amount });
          winnerReceipts.set(String(w.bettor_id), (winnerReceipts.get(String(w.bettor_id)) ?? 0) + amount);
        });
      }
      payoutUpdates.push(db.prepare('UPDATE bets SET payout=? WHERE event_id=? AND bettor_id=? AND target_id=?').bind(-Number(loser.stake), eventId, loser.bettor_id, targetId));
    }
    winners.forEach(w => payoutUpdates.push(db.prepare('UPDATE bets SET payout=? WHERE event_id=? AND bettor_id=? AND target_id=?').bind(winnerReceipts.get(String(w.bettor_id)) ?? 0, eventId, w.bettor_id, targetId)));
  }
  await db.batch([
    ...payoutUpdates,
    db.prepare("UPDATE events SET state='settled',settled_at=? WHERE id=? AND state<>'settled'").bind(now, eventId),
  ]);
  return { doubtText: resultLines.length ? resultLines.join('\n') : 'ダウトはありませんでした', debts: netDebts(transfers), names };
}

export async function storedSettlement(db: D1Database, eventId: string): Promise<Settlement> {
  const people = await participants(db, eventId);
  const names = new Map(people.map(p => [p.user_id, p.display_name || p.user_id.slice(-6)]));
  const bets = (await db.prepare(`SELECT b.*,bu.display_name bettor_name,tu.display_name target_name
    FROM bets b JOIN users bu ON bu.user_id=b.bettor_id JOIN users tu ON tu.user_id=b.target_id WHERE event_id=?`)
    .bind(eventId).all<Record<string, string | number | null>>()).results;
  const transfers = fineTransfers(people), lines: string[] = [];
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
  return { doubtText: lines.join('\n') || 'ダウトはありませんでした', debts: netDebts(transfers), names };
}

export function settlementText(result: Settlement): string {
  const lines = result.debts.map(d => `${result.names.get(d.from) ?? d.from} → ${result.names.get(d.to) ?? d.to}  ${d.amount.toLocaleString('ja-JP')}円`);
  return `【ダウト結果】\n${result.doubtText}\n\n【精算】\n${lines.join('\n') || '支払いはありません'}\n支払いは各自でお願いします`;
}
