import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateFine, distanceMeters, doubtOutcomes, lateMinutes, netDebts, shortcutTime, validFine } from '../src/domain';
import { verifyIdToken, verifySignature } from '../src/line';
import { liffHtml } from '../src/liff';
import { settle, settlementText } from '../src/settlement';
import { commandText } from '../src/webhook';

assert.equal(lateMinutes(1_000_000, 1_000_001), 1);
assert.equal(lateMinutes(1_000_000, 999_999), 0);
assert.equal(calculateFine(0, 1, 200, 50, 3000), 250);
assert.equal(calculateFine(0, 56 * 60_000, 200, 50, 3000), 3000);
assert.equal(calculateFine(100, 100, 200, 50, 3000), 0);
assert.ok(distanceMeters(35.681236, 139.767125, 35.681236, 139.767125) === 0);
assert.ok(distanceMeters(35.681236, 139.767125, 35.682236, 139.767125) > 100);
assert.deepEqual(netDebts([{ from: 'A', to: 'B', amount: 500 }, { from: 'B', to: 'C', amount: 300 }]), [{ from: 'A', to: 'B', amount: 200 }, { from: 'A', to: 'C', amount: 300 }]);
const now = Date.UTC(2026, 8, 14, 8); // 17:00 JST
assert.equal(new Date(shortcutTime(now, 0, 19)).toISOString(), '2026-09-14T10:00:00.000Z');

assert.equal(validFine(200, 50, 3000), true);
assert.equal(validFine(0, 0, 0), true);
assert.equal(validFine(-1, 50, 3000), false);
assert.equal(validFine(3000, 50, 200), false); // max below base
assert.equal(validFine(200, 50, 100001), false);
assert.equal(validFine(NaN, 50, 3000), false);
// Doubt is paid in gifts, one per bet: a hit takes one from the target, a miss owes them one.
{
  const bets = [
    { bettor_id: 'a', target_id: 't', predicts_late: 1 },
    { bettor_id: 'b', target_id: 't', predicts_late: 1 },
    { bettor_id: 'c', target_id: 'u', predicts_late: 1 },
  ];
  const out = doubtOutcomes(bets, id => id === 't');
  assert.deepEqual(out.map(o => o.payout), [1, 1, -1]);
  assert.deepEqual(out.map(o => o.transfer), [
    { from: 't', to: 'a', amount: 1 },
    { from: 't', to: 'b', amount: 1 },
    { from: 'c', to: 'u', amount: 1 },
  ]);
}

const secret = 'test-secret', body = '{"events":[]}';
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
const signature = btoa(String.fromCharCode(...bytes));
assert.equal(await verifySignature(body, signature, secret), true);
assert.equal(await verifySignature(body + ' ', signature, secret), false);
assert.equal(await verifySignature(body, 'bad', secret), false);

const originalFetch = globalThis.fetch;
let verificationBody = '';
let verificationAudience = '1234567890';
globalThis.fetch = async (_input, init) => {
  verificationBody = String(init?.body);
  return new Response(JSON.stringify({ sub: 'U-verified', aud: verificationAudience }), { status: 200 });
};
assert.equal(await verifyIdToken('signed-token', '1234567890-AbCdEf'), 'U-verified');
assert.match(verificationBody, /id_token=signed-token/);
assert.match(verificationBody, /client_id=1234567890/);
verificationAudience = 'different-channel';
assert.equal(await verifyIdToken('signed-token', '1234567890-AbCdEf'), null);
assert.equal(await verifyIdToken('signed-token', 'invalid-liff-id'), null);
globalThis.fetch = originalFetch;

const apiSource = readFileSync('src/api.ts', 'utf8');
assert.doesNotMatch(apiSource, /budgetedPush/);
assert.match(apiSource, /verifyIdToken\(body\.idToken/);
const cronSource = readFileSync('src/cron.ts', 'utf8');
assert.equal((cronSource.match(/budgetedPush\(/g) ?? []).length, 2);
// LIFF entry URLs arrive as /liff?liff.state=%3Fe%3D...%26mode%3D..., so params must be unwrapped from liff.state.
const liffSource = readFileSync('src/liff.ts', 'utf8');
assert.match(liffSource, /liff\.state/);
{
  const unwrap = (search: string) => {
    const raw = new URLSearchParams(search);
    return new URLSearchParams(raw.get('liff.state')?.replace(/^\?/, '') ?? search);
  };
  const wrapped = unwrap('?liff.state=%3Fe%3DABC%26mode%3Dsettings');
  assert.equal(wrapped.get('e'), 'ABC');
  assert.equal(wrapped.get('mode'), 'settings');
  const plain = unwrap('?e=XYZ&mode=arrive');
  assert.equal(plain.get('e'), 'XYZ');
  assert.equal(plain.get('mode'), 'arrive');
  const group = unwrap('?liff.state=%3Fg%3DC123%26mode%3Dgroup');
  assert.equal(group.get('g'), 'C123');
  assert.equal(group.get('mode'), 'group');
}

// The LIFF page is emitted as a template literal: an unescaped \n would break the inline script at parse time.
{
  const html = liffHtml('1234567890-AbCdEf');
  const inline = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
  assert.ok(inline.includes('liff.init'), 'inline LIFF script not found');
  assert.doesNotThrow(() => new Function(inline), 'emitted LIFF script must parse');
  assert.match(inline, /\/api\/group-settings/); // group mode posts to the group endpoint, not the event one
  assert.match(inline, /settleGifts/); // 精算画面は罰金とギフトを別々に出す
  assert.doesNotMatch(inline, /doubtStake/);
  assert.match(inline, /toastTimer/); // saves must pop a toast, not only rewrite the status card
  assert.match(html, /id="toast"/);
}

// A mention arrives inside the text ("@BeLate 戦績"), so keyword matching must see the text without it.
{
  assert.equal(commandText({ text: '@BeLate 戦績', mention: { mentionees: [{ index: 0, length: 7 }] } }), '戦績');
  assert.equal(commandText({ text: 'おい @BeLate', mention: { mentionees: [{ index: 3, length: 7 }] } }), 'おい');
  assert.equal(commandText({ text: '@A @BeLate 精算', mention: { mentionees: [{ index: 0, length: 2 }, { index: 3, length: 7 }] } }), '精算');
  assert.equal(commandText({ text: ' 戦績 ' }), '戦績');
}


// Cancelling an event before its meeting time must not turn everyone into a 180-minute latecomer.
{
  const { DatabaseSync } = await import('node:sqlite');
  const sqlite = new DatabaseSync(':memory:');
  for (const file of ['0001_initial', '0002_notification_budget', '0003_pending_group_notifications', '0004_group_fine_defaults'])
    sqlite.exec(readFileSync(`migrations/${file}.sql`, 'utf8'));

  type Row = Record<string, unknown>;
  class Stmt {
    constructor(private sql: string, private args: unknown[] = []) {}
    bind(...args: unknown[]) { return new Stmt(this.sql, args); }
    async first<T>() { return (sqlite.prepare(this.sql).get(...this.args as never[]) ?? null) as T | null; }
    async all<T>() { return { results: sqlite.prepare(this.sql).all(...this.args as never[]) as T[] }; }
    async run() { return { meta: { changes: Number(sqlite.prepare(this.sql).run(...this.args as never[]).changes) } }; }
  }
  const db = {
    prepare: (sql: string) => new Stmt(sql),
    batch: (statements: Stmt[]) => Promise.all(statements.map(s => s.run())),
  } as unknown as D1Database;

  const meetAt = Date.now() + 3_600_000;
  sqlite.exec(`INSERT INTO groups(line_group_id,doubt_enabled,created_at) VALUES('G',1,0);
    INSERT INTO users(user_id,display_name,is_friend,updated_at) VALUES('U1','あ',1,0),('U2','い',1,0);
    INSERT INTO events(id,group_id,owner_id,place_lat,place_lng,meet_at,state,base_fine,per_min,max_fine,created_at)
      VALUES('E','G','U1',35.0,139.0,${meetAt},'open',200,50,3000,0);
    INSERT INTO participants(event_id,user_id,status,joined_at) VALUES('E','U1','joining',0),('E','U2','joining',0);
    INSERT INTO bets(event_id,bettor_id,target_id,predicts_late,stake) VALUES('E','U1','U2',1,1);`);

  const cancelled = await settle(db, 'E');
  assert.deepEqual(cancelled.debts, [], '事前キャンセルでは支払いは発生しない');
  assert.deepEqual(cancelled.gifts, [], '事前キャンセルではギフトも発生しない');
  const after = sqlite.prepare('SELECT user_id,late_minutes,fine FROM participants WHERE event_id=?').all('E') as Row[];
  assert.deepEqual(after.map(r => [r.late_minutes, r.fine]), [[null, 0], [null, 0]], '事前キャンセルで遅刻扱いにしない');
  assert.equal((sqlite.prepare('SELECT COUNT(*) n FROM bets').get() as Row).n, 0, '未確定のダウトは無効化される');

  // Same event settled after the meeting time still charges the no-shows.
  sqlite.exec(`UPDATE events SET state='running' WHERE id='E';
    INSERT INTO bets(event_id,bettor_id,target_id,predicts_late,stake) VALUES('E','U1','U2',1,1);`);
  const late = await settle(db, 'E', meetAt + 10_000);
  assert.deepEqual(
    (sqlite.prepare('SELECT late_minutes,fine FROM participants WHERE event_id=?').all('E') as Row[]).map(r => [r.late_minutes, r.fine]),
    [[180, 3000], [180, 3000]],
  );
  assert.deepEqual(late.debts, [], '全員遅刻なら受け取る側がいない');
  // ダウトの当たりはチケット1枚で、罰金（円）の側には混ざらない。
  assert.deepEqual(late.gifts, [{ from: 'U2', to: 'U1', amount: 1 }]);
  assert.match(settlementText(late), /スタバのドリンクチケット1枚/);
  assert.doesNotMatch(settlementText(late), /1円/);
}

console.log('self-check: all assertions passed');
