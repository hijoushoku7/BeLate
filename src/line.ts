import type { LineMessage } from './types';

const API = 'https://api.line.me/v2/bot';

export async function verifySignature(body: string, signature: string | undefined, secret: string): Promise<boolean> {
  if (!signature || !secret) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const actual = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  let expected: Uint8Array;
  try { expected = Uint8Array.from(atob(signature), c => c.charCodeAt(0)); } catch { return false; }
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i]! ^ expected[i]!;
  return diff === 0;
}

async function call(path: string, token: string, body?: unknown, method = 'POST'): Promise<Response> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`LINE ${path}: ${response.status} ${await response.text()}`);
  return response;
}

export async function reply(token: string, replyToken: string | undefined, messages: LineMessage[]): Promise<void> {
  if (!replyToken || !messages.length) return;
  await call('/message/reply', token, { replyToken, messages: messages.slice(0, 5) });
}

export async function push(token: string, to: string, messages: LineMessage[]): Promise<void> {
  await call('/message/push', token, { to, messages: messages.slice(0, 5) });
}

export async function profile(token: string, userId: string): Promise<{ displayName: string }> {
  return (await call(`/profile/${encodeURIComponent(userId)}`, token, undefined, 'GET')).json() as Promise<{ displayName: string }>;
}

export async function canPush(token: string, userId: string): Promise<boolean> {
  try { await profile(token, userId); return true; } catch { return false; }
}

export async function verifyIdToken(idToken: string, liffId: string): Promise<string | null> {
  const clientId = liffId.split('-')[0];
  if (!idToken || !clientId || !/^\d+$/.test(clientId)) return null;
  const response = await fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken, client_id: clientId }),
  });
  if (!response.ok) return null;
  const claims = await response.json() as { sub?: string; aud?: string };
  return claims.sub && claims.aud === clientId ? claims.sub : null;
}

export const text = (value: string): LineMessage => ({ type: 'text', text: value });
export const postbackAction = (label: string, data: string) => ({ type: 'postback', label, data, displayText: label });
export const uriAction = (label: string, uri: string) => ({ type: 'uri', label, uri });
export const buttons = (body: string, actions: Record<string, unknown>[], title?: string): LineMessage => ({
  type: 'template', altText: body, template: { type: 'buttons', ...(title ? { title } : {}), text: body.slice(0, 160), actions: actions.slice(0, 4) },
});
export const quick = (body: string, actions: Record<string, unknown>[]): LineMessage => ({
  type: 'text', text: body, quickReply: { items: actions.slice(0, 13).map(action => ({ type: 'action', action })) },
});
