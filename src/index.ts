import { Hono } from 'hono';
import type { Env, LineEvent } from './types';
import { verifySignature } from './line';
import { handleLineEvent } from './webhook';
import { api } from './api';
import { liffHtml } from './liff';
import { runCron } from './cron';

const app = new Hono<{ Bindings: Env }>();
app.get('/', c => c.text('BeLate is running'));
app.get('/health', c => c.json({ ok: true }));
app.get('/liff', c => c.html(liffHtml(c.env.LIFF_ID)));
app.route('/api', api);
app.post('/webhook', async c => {
  const body = await c.req.text();
  if (!(await verifySignature(body, c.req.header('x-line-signature'), c.env.LINE_CHANNEL_SECRET))) return c.text('Invalid signature', 401);
  let payload: { events?: LineEvent[] };
  try { payload = JSON.parse(body) as { events?: LineEvent[] }; } catch { return c.text('Invalid JSON', 400); }
  await Promise.all((payload.events ?? []).map(event => handleLineEvent(c.env, event).catch(error => console.error('webhook event failed', error))));
  return c.text('OK');
});
app.notFound(c => c.json({ error: 'Not found' }, 404));
app.onError((error, c) => { console.error(error); return c.json({ error: 'Internal server error' }, 500); });

export default {
  fetch: app.fetch,
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) { ctx.waitUntil(runCron(env)); },
};
