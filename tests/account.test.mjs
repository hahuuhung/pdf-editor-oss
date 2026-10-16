import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AccountClient,
  AccountError,
  clientNameFrom,
  isSessionExpired,
  planLabel,
  resolveVetviralUrl,
  unreadCount,
} from '../src/account.js';

const UA = {
  chromeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  edgeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  safariIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  firefoxMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:131.0) Gecko/20100101 Firefox/131.0',
};

test('clientNameFrom names the browser and system the way people recognize them', () => {
  assert.equal(clientNameFrom(UA.chromeWin), 'Chrome trên Windows');
  assert.equal(clientNameFrom(UA.edgeWin), 'Edge trên Windows');
  assert.equal(clientNameFrom(UA.safariIos), 'Safari trên iOS');
  assert.equal(clientNameFrom(UA.chromeAndroid), 'Chrome trên Android');
  assert.equal(clientNameFrom(UA.firefoxMac), 'Firefox trên macOS');
  assert.equal(clientNameFrom(''), 'Trình duyệt');
});

test('resolveVetviralUrl makes relative links absolute and accepts only https', () => {
  assert.equal(resolveVetviralUrl('/pricing'), 'https://vetviral.com/pricing');
  assert.equal(resolveVetviralUrl('/media/announcements/a.png'), 'https://vetviral.com/media/announcements/a.png');
  assert.equal(resolveVetviralUrl('https://example.com/x'), 'https://example.com/x');
  for (const bad of ['', '   ', '//evil.example/x', 'javascript:alert(1)', 'http://example.com', 'data:text/html,x', null, 42]) {
    assert.equal(resolveVetviralUrl(bad), null, String(bad));
  }
});

test('unreadCount and planLabel', () => {
  assert.equal(unreadCount([{ read: true }, { read: false }, {}]), 2);
  assert.equal(unreadCount(undefined), 0);
  assert.equal(planLabel({ plan: null }), 'Miễn phí');
  assert.equal(planLabel({ plan: 'STUDIO-VIP', planExpiresAt: null }), 'STUDIO-VIP');
  assert.match(planLabel({ plan: 'STUDIO-VIP', planExpiresAt: '2026-12-31T00:00:00.000Z' }), /^STUDIO-VIP \(đến /);
});

// A fake VET VIRAL API: answers by "METHOD path" and records every call.
function fakeServer(routes) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const path = new URL(url).pathname;
    const key = `${init.method ?? 'GET'} ${path}`;
    calls.push({ key, headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : undefined });
    const route = routes[key];
    if (!route) return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    const { status = 200, body } = typeof route === 'function' ? route(calls.at(-1)) : route;
    return new Response(status === 204 ? null : JSON.stringify(body ?? {}), { status });
  };
  return { calls, fetchImpl };
}

test('login: asks for a code, polls until approved, then stores the token', async () => {
  let polls = 0;
  const { calls, fetchImpl } = fakeServer({
    'POST /api/app-auth/device': { status: 201, body: { deviceCode: 'd'.repeat(43), userCode: 'KTRM-4821', verificationUrl: 'https://vetviral.com/connect?code=KTRM-4821', expiresIn: 600, interval: 3 } },
    'POST /api/app-auth/token': () => (++polls < 3 ? { status: 202, body: { status: 'pending' } } : { status: 200, body: { status: 'approved', token: 'vvapp_tok', user: { name: 'Lan', email: 'lan@example.vn' } } }),
  });
  const client = new AccountClient({ fetchImpl });
  const started = await client.startLogin('Chrome trên Windows');
  assert.equal(started.userCode, 'KTRM-4821');
  assert.deepEqual(calls[0].body, { app: 'pdf-editor', clientName: 'Chrome trên Windows' });
  assert.equal(calls[0].headers.Authorization, undefined);

  let pendingTicks = 0;
  const user = await client.waitForApproval({ ...started, interval: 0 }, { onPending: () => pendingTicks++ });
  assert.equal(user.name, 'Lan');
  assert.equal(pendingTicks, 2);
  assert.equal(client.token, 'vvapp_tok');
  assert.equal(client.signedIn, true);
});

test('login: a denied request surfaces access_denied and stores nothing', async () => {
  const { fetchImpl } = fakeServer({
    'POST /api/app-auth/token': { status: 403, body: { error: 'Bạn đã từ chối kết nối ứng dụng này.', code: 'access_denied' } },
  });
  const client = new AccountClient({ fetchImpl });
  await assert.rejects(client.waitForApproval({ deviceCode: 'x'.repeat(43), interval: 0 }), (err) => err instanceof AccountError && err.code === 'access_denied');
  assert.equal(client.token, null);
});

test('login: cancelling stops polling', async () => {
  const { calls, fetchImpl } = fakeServer({ 'POST /api/app-auth/token': { status: 202, body: { status: 'pending' } } });
  const client = new AccountClient({ fetchImpl });
  const controller = new AbortController();
  const waiting = client.waitForApproval({ deviceCode: 'x'.repeat(43), interval: 60 }, { signal: controller.signal });
  controller.abort();
  await assert.rejects(waiting, (err) => err.code === 'aborted');
  assert.equal(calls.length, 0);
});

test('signed-in calls send the app token, and a 401 clears it', async () => {
  const { calls, fetchImpl } = fakeServer({
    'GET /api/apps/pdf-editor/me': { body: { user: { name: 'Lan' } } },
    'GET /api/apps/pdf-editor/announcements': { status: 401, body: { error: 'Phiên kết nối đã hết hiệu lực. Hãy đăng nhập lại.', code: 'invalid_app_token' } },
  });
  const client = new AccountClient({ fetchImpl });
  client.token = 'vvapp_tok';
  assert.equal((await client.me()).name, 'Lan');
  assert.equal(calls[0].headers.Authorization, 'Bearer vvapp_tok');
  await assert.rejects(client.announcements(), (err) => isSessionExpired(err));
  assert.equal(client.token, null);
});

test('logout revokes on the server and always clears the token, even offline', async () => {
  const { calls, fetchImpl } = fakeServer({ 'POST /api/apps/pdf-editor/logout': { status: 204 } });
  const client = new AccountClient({ fetchImpl });
  client.token = 'vvapp_tok';
  await client.logout();
  assert.equal(calls[0].key, 'POST /api/apps/pdf-editor/logout');
  assert.equal(client.token, null);

  const offline = new AccountClient({ fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
  offline.token = 'vvapp_tok';
  await assert.rejects(offline.logout(), (err) => err.code === 'network');
  assert.equal(offline.token, null);
});
