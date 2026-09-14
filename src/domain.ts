import type { ParticipantRow } from './types';

export const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
export const LOCK_BEFORE_MS = 2 * 60 * 60 * 1000;
export const AUTO_SETTLE_MS = 3 * 60 * 60 * 1000;
export const ARRIVAL_RADIUS_M = 150;

export const PRESETS = {
  light: { baseFine: 100, perMin: 20, maxFine: 1000, label: 'ゆるめ' },
  standard: { baseFine: 200, perMin: 50, maxFine: 3000, label: '標準' },
  strict: { baseFine: 500, perMin: 100, maxFine: 5000, label: 'きつめ' },
} as const;

export function lateMinutes(meetAt: number, arrivedAt: number): number {
  return Math.max(0, Math.ceil((arrivedAt - meetAt) / 60_000));
}

export function calculateFine(meetAt: number, arrivedAt: number, base: number, perMin: number, max: number): number {
  const minutes = lateMinutes(meetAt, arrivedAt);
  return minutes === 0 ? 0 : Math.min(base + perMin * minutes, max);
}

export function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(6_371_000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
}

export function formatJst(epochMs: number): string {
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(epochMs);
}

export function shortcutTime(now: number, dayOffset: number, hour: number): number {
  const local = new Date(now + JST_OFFSET_MS);
  const utc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + dayOffset, hour - 9, 0, 0);
  return utc <= now ? utc + 24 * 60 * 60 * 1000 : utc;
}

export type Debt = { from: string; to: string; amount: number };
export function netDebts(transfers: Debt[]): Debt[] {
  const balances = new Map<string, number>();
  for (const t of transfers) {
    balances.set(t.from, (balances.get(t.from) ?? 0) - t.amount);
    balances.set(t.to, (balances.get(t.to) ?? 0) + t.amount);
  }
  const debtors = [...balances].filter(([, n]) => n < 0).map(([id, n]) => ({ id, n: -n }));
  const creditors = [...balances].filter(([, n]) => n > 0).map(([id, n]) => ({ id, n }));
  const result: Debt[] = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i]!.n, creditors[j]!.n);
    if (amount > 0) result.push({ from: debtors[i]!.id, to: creditors[j]!.id, amount });
    debtors[i]!.n -= amount; creditors[j]!.n -= amount;
    if (!debtors[i]!.n) i++;
    if (!creditors[j]!.n) j++;
  }
  return result;
}

export function fineTransfers(participants: ParticipantRow[]): Debt[] {
  const onTime = participants.filter(p => p.status === 'joining' && (p.late_minutes ?? 0) === 0);
  if (!onTime.length) return [];
  const out: Debt[] = [];
  for (const late of participants.filter(p => (p.fine ?? 0) > 0)) {
    const fine = late.fine ?? 0;
    const share = Math.floor(fine / onTime.length);
    let remainder = fine - share * onTime.length;
    onTime.forEach(p => out.push({ from: late.user_id, to: p.user_id, amount: share + (remainder-- > 0 ? 1 : 0) }));
  }
  return out.filter(x => x.amount > 0);
}
