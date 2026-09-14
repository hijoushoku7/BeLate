import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateFine, distanceMeters, lateMinutes, netDebts, shortcutTime } from '../src/domain';
import { verifyIdToken, verifySignature } from '../src/line';
import { liffHtml } from '../src/liff';
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
}

// The LIFF page is emitted as a template literal: an unescaped \n would break the inline script at parse time.
{
  const html = liffHtml('1234567890-AbCdEf');
  const inline = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
  assert.ok(inline.includes('liff.init'), 'inline LIFF script not found');
  assert.doesNotThrow(() => new Function(inline), 'emitted LIFF script must parse');
}

// A mention arrives inside the text ("@BeLate 戦績"), so keyword matching must see the text without it.
{
  assert.equal(commandText({ text: '@BeLate 戦績', mention: { mentionees: [{ index: 0, length: 7 }] } }), '戦績');
  assert.equal(commandText({ text: 'おい @BeLate', mention: { mentionees: [{ index: 3, length: 7 }] } }), 'おい');
  assert.equal(commandText({ text: '@A @BeLate 精算', mention: { mentionees: [{ index: 0, length: 2 }, { index: 3, length: 7 }] } }), '精算');
  assert.equal(commandText({ text: ' 戦績 ' }), '戦績');
}

console.log('self-check: all assertions passed');
