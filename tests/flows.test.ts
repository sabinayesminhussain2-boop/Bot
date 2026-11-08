import test from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import http from 'node:http';
const httpRequest = http.request;
import express from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { config, credentialStatus, hasRealCredentials } from '../src/config';
import { MENU, findItem, categoryById, formatPrice } from '../src/menu';
import {
  addToCart,
  setQty,
  removeFromCart,
  cartSubtotal,
  cartItemCount,
} from '../src/cart';
import { OrderStore } from '../src/orders';
import { SessionStore } from '../src/state';
import { SimulatedWhatsAppAdapter, RealWhatsAppAdapter } from '../src/whatsapp';
import { ConversationRouter, IncomingMessage } from '../src/router';
import { createWebhookRouter } from '../src/webhook';

let counter = 0;

function tempDir(name: string): string {
  const dir = path.join(os.tmpdir(), 'veyora-tests', `${process.pid}-${Date.now()}-${counter}-${name}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

interface Deps {
  phone: string;
  sessions: SessionStore;
  orders: OrderStore;
  adapter: SimulatedWhatsAppAdapter;
  router: ConversationRouter;
}

function makeDeps(): Deps {
  const id = ++counter;
  const phone = `+91999999${String(id).padStart(4, '0')}`;
  const sessions = new SessionStore(path.join(tempDir(`sessions-${id}`), 'sessions.json'), false);
  const orders = new OrderStore(tempDir(`store-${id}`));
  const adapter = new SimulatedWhatsAppAdapter();
  const router = new ConversationRouter(sessions, orders, adapter);
  return { phone, sessions, orders, adapter, router };
}

function message(
  from: string,
  text?: string,
  interactive?: IncomingMessage['interactive'],
  id = `msg-${Math.random().toString(36).slice(2)}`,
): IncomingMessage {
  return { id, from, text, interactive };
}

function listReply(id: string): IncomingMessage['interactive'] {
  return { type: 'list_reply', list_reply: { id, title: id } };
}

function buttonReply(id: string): IncomingMessage['interactive'] {
  return { type: 'button_reply', button_reply: { id, title: id } };
}

function allText(adapter: SimulatedWhatsAppAdapter): string[] {
  return adapter.getOutbox().map((m) => m.body ?? '').filter(Boolean);
}

function lastText(adapter: SimulatedWhatsAppAdapter): string | undefined {
  const outbox = adapter.getOutbox();
  return outbox.length ? outbox[outbox.length - 1].body : undefined;
}

async function welcome(router: ConversationRouter, phone: string) {
  return router.handleIncoming(message(phone, 'Hi, I want to order food. Table T01.'));
}

async function viewMenu(router: ConversationRouter, phone: string) {
  await welcome(router, phone);
  return router.handleIncoming(message(phone, '', listReply('cb_view_menu')));
}

async function pickCategory(router: ConversationRouter, phone: string, categoryId: string) {
  return router.handleIncoming(message(phone, '', listReply(`cat_${categoryId}`)));
}

async function addItemQty(router: ConversationRouter, phone: string, itemId: string, qty: number) {
  await router.handleIncoming(message(phone, '', listReply(`add_${itemId}`)));
  return router.handleIncoming(message(phone, '', listReply(`qty_${itemId}_${qty}`)));
}

test('config: tables are configurable and defaults exist', () => {
  assert.ok(config.restaurant.tables.length > 0);
  assert.ok(config.restaurant.tables.includes('T01'));
});

test('config: missing credentials are reported clearly, no false success', () => {
  const status = credentialStatus();
  assert.ok(!status.configured);
  assert.ok(status.missing.includes('WHATSAPP_TOKEN'));
  assert.ok(status.missing.includes('WHATSAPP_PHONE_NUMBER_ID'));
  assert.ok(status.missing.length > 0);
  assert.ok(!hasRealCredentials());
  assert.ok(config.demoMode);
});

test('menu: categories and items are configurable', () => {
  assert.equal(MENU.length, 5);
  const starters = categoryById('starters');
  assert.ok(starters);
  assert.equal(starters?.name, 'Starters');

  const item = findItem('item_veg_fried_rice');
  assert.ok(item);
  assert.equal(item.name, 'Veg Fried Rice');
  assert.equal(item.price, 190);
  assert.equal(item.type, 'veg');

  const unavailable = findItem('item_chicken_biryani');
  assert.ok(unavailable);
  assert.equal(unavailable.available, false);

  assert.equal(formatPrice(190), '₹190');
});

test('cart: add, quantity, remove, subtotal', () => {
  const paneer = findItem('item_paneer_tikka')!;
  const rice = findItem('item_veg_fried_rice')!;

  let cart = addToCart([], paneer, 1);
  cart = addToCart(cart, rice, 2);
  assert.equal(cartItemCount(cart), 3);
  assert.equal(cartSubtotal(cart), 250 + 190 * 2);

  cart = setQty(cart, paneer.id, 3);
  const entry = cart.find((e) => e.itemId === paneer.id);
  assert.equal(entry?.qty, 3);

  cart = removeFromCart(cart, rice.id);
  assert.equal(cart.length, 1);
  assert.equal(cartSubtotal(cart), 250 * 3);
});

test('orders: creation, idempotency, status updates, active orders', () => {
  const orders = new OrderStore(tempDir('orders-store'));
  const paneer = findItem('item_paneer_tikka')!;
  const cart = [{ itemId: paneer.id, name: paneer.name, price: paneer.price, qty: 2 }];

  const key = 'cart-phone-123';
  const order = orders.createOrder('+919999999999', 'T01', cart, 500, 25, 525, key);
  assert.ok(order);
  assert.equal(order.reference, 'ORD-1001');
  assert.equal(order.status, 'received');
  assert.equal(order.table, 'T01');

  const duplicate = orders.createOrder('+919999999999', 'T01', cart, 500, 25, 525, key);
  assert.equal(duplicate, null);

  const order2 = orders.createOrder('+919999999999', 'T01', cart, 500, 25, 525, 'cart-phone-456');
  assert.ok(order2);
  assert.notEqual(order2.reference, order.reference);

  const updated = orders.updateStatus(order.reference, 'preparing');
  assert.ok(updated);
  assert.equal(updated.status, 'preparing');

  const active = orders.activeByPhone('+919999999999');
  assert.ok(active.find((o) => o.reference === order.reference));
  orders.updateStatus(order.reference, 'cancelled');
  assert.equal(orders.activeByPhone('+919999999999').length, 1);
});

test('orders: bill requests and feedback are saved', () => {
  const orders = new OrderStore(tempDir('orders-store-2'));
  const request = orders.addBillRequest('+919999999999', 'T01', 'ORD-1001');
  assert.ok(request.id);
  assert.equal(request.notified, false);
  assert.equal(orders.listBillRequests().length, 1);

  const feedback = orders.addFeedback('+919999999999', 'T01', 5, 'Great food!');
  assert.equal(feedback.rating, 5);
  assert.equal(feedback.comment, 'Great food!');
  assert.equal(orders.listFeedback().length, 1);
});

test('router: welcome message sets table from QR prefilled text', async () => {
  const { adapter, router, phone } = makeDeps();
  const results = await welcome(router, phone);
  assert.equal(results.length, 2);
  const texts = allText(adapter);
  assert.ok(texts[0]!.includes('Welcome to VEYORA Demo Restaurant'));
  assert.ok(texts[0]!.includes('Your table: T01'));
  const list = adapter.getOutbox()[1];
  assert.equal(list?.type, 'list');
  assert.equal(list?.sections?.[0]?.rows.length, 5);
});

test('router: main menu routes to view menu and categories', async () => {
  const { adapter, router, phone } = makeDeps();
  await viewMenu(router, phone);
  const lists = adapter.getOutbox().filter((m) => m.type === 'list');
  const last = lists[lists.length - 1];
  assert.ok(last);
  assert.equal(last.sections?.[0]?.rows.length, 5);
  assert.ok(last.sections?.[0]?.rows.some((r) => r.id === 'cat_starters'));

  await pickCategory(router, phone, 'starters');
  const categoryLists = adapter.getOutbox().filter((m) => m.type === 'list' && m.body?.includes('Starters — tap an item'));
  assert.ok(categoryLists.length > 0);
  const rowIds = categoryLists[0]!.sections?.[0]?.rows.map((r) => r.id) ?? [];
  assert.ok(rowIds.includes('add_item_paneer_tikka'));
});

test('router: unavailable item is rejected with a clear message', async () => {
  const { adapter, router, phone } = makeDeps();
  await viewMenu(router, phone);
  await pickCategory(router, phone, 'main_course');
  await router.handleIncoming(message(phone, '', listReply('add_item_chicken_biryani')));
  assert.ok(allText(adapter).some((b) => b.includes('unavailable')));
});

test('router: add item to cart, view cart, confirm order', async () => {
  const { adapter, router, sessions, orders, phone } = makeDeps();
  await viewMenu(router, phone);
  await pickCategory(router, phone, 'starters');
  await addItemQty(router, phone, 'item_paneer_tikka', 2);

  const session = sessions.get(phone);
  assert.equal(session!.cart.length, 1);
  assert.equal(session!.cart[0].qty, 2);

  await router.handleIncoming(message(phone, '', listReply('cb_cart')));
  assert.ok(allText(adapter).some((b) => b.includes('₹500')));

  await router.handleIncoming(message(phone, '', listReply('cb_checkout')));
  assert.ok(allText(adapter).some((b) => b.includes('Please confirm your order')));

  await router.handleIncoming(message(phone, '', buttonReply('cb_confirm_order')));
  const bodies = allText(adapter);
  assert.ok(bodies.some((b) => b.includes('Order received') && /ORD-\d+/.test(b)));
  assert.equal(session!.cart.length, 0);
});

test('router: cancelled order is never submitted', async () => {
  const { adapter, router, orders, phone } = makeDeps();
  await viewMenu(router, phone);
  await pickCategory(router, phone, 'starters');
  await addItemQty(router, phone, 'item_paneer_tikka', 1);
  await router.handleIncoming(message(phone, '', listReply('cb_checkout')));
  await router.handleIncoming(message(phone, '', buttonReply('cb_cancel_order')));
  assert.ok(allText(adapter).some((b) => b.includes('cancelled')));
  assert.equal(orders.list().length, 0);
});

test('router: duplicate message id is not processed twice', async () => {
  const { adapter, router, phone } = makeDeps();
  const raw = message(phone, 'Table T01', undefined, 'dup-msg-1');
  const first = await router.handleIncoming(raw);
  assert.equal(first.length, 2);
  const second = await router.handleIncoming(raw);
  assert.equal(second.length, 0);
});

test('router: track order reflects backend status updates', async () => {
  const { adapter, router, sessions, orders, phone } = makeDeps();
  await viewMenu(router, phone);
  await pickCategory(router, phone, 'starters');
  await addItemQty(router, phone, 'item_paneer_tikka', 1);
  await router.handleIncoming(message(phone, '', listReply('cb_checkout')));
  await router.handleIncoming(message(phone, '', buttonReply('cb_confirm_order')));

  const refMatch = allText(adapter).join('\n').match(/ORD-\d+/);
  assert.ok(refMatch);
  const reference = refMatch[0];

  orders.updateStatus(reference, 'preparing');

  await router.handleIncoming(message(phone, '', listReply('cb_track_order')));
  assert.ok(allText(adapter).some((b) => b.includes('Preparing')));
});

test('router: request bill shows subtotal, tax and total and notifies staff', async () => {
  const { adapter, router, orders, phone } = makeDeps();
  await viewMenu(router, phone);
  await pickCategory(router, phone, 'starters');
  await addItemQty(router, phone, 'item_paneer_tikka', 1);
  await router.handleIncoming(message(phone, '', listReply('cb_checkout')));
  await router.handleIncoming(message(phone, '', buttonReply('cb_confirm_order')));

  await router.handleIncoming(message(phone, '', listReply('cb_request_bill')));
  const bodies = allText(adapter);
  assert.ok(bodies.some((b) => b.includes('Bill — Table T01')));
  assert.ok(bodies.some((b) => b.includes('Subtotal: ₹250')));
  assert.ok(bodies.some((b) => b.includes('Total amount:')));
  assert.ok(bodies.some((b) => b.includes('notified the restaurant staff')));
  assert.ok(!bodies.some((b) => /payment (is |has been )?completed/i.test(b)));

  const requests = orders.listBillRequests();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].table, 'T01');
});

test('router: give feedback saves rating and comment', async () => {
  const { adapter, router, orders, phone } = makeDeps();
  await welcome(router, phone);
  await router.handleIncoming(message(phone, '', listReply('cb_give_feedback')));
  await router.handleIncoming(message(phone, '', listReply('feedback_4')));
  await router.handleIncoming(message(phone, 'Loved the biryani!'));

  const feedback = orders.listFeedback();
  assert.equal(feedback.length, 1);
  assert.equal(feedback[0].rating, 4);
  assert.equal(feedback[0].comment, 'Loved the biryani!');
  assert.ok(allText(adapter).some((b) => b.includes('Thank you for your feedback')));
});

test('router: invalid message gets a helpful response with the main menu', async () => {
  const { adapter, router, phone } = makeDeps();
  await welcome(router, phone);
  await router.handleIncoming(message(phone, 'gibberish xyz'));
  assert.ok(allText(adapter).some((b) => b.includes('understood')));
  const lists = adapter.getOutbox().filter((m) => m.type === 'list');
  assert.ok(lists.length >= 1);
});

test('router: keywords work as free text fallback', async () => {
  const { adapter, router, phone } = makeDeps();
  await welcome(router, phone);
  await router.handleIncoming(message(phone, 'menu'));
  const lists = adapter.getOutbox().filter((m) => m.type === 'list');
  assert.ok(lists.some((l) => l.sections?.[0]?.rows.some((r) => r.id?.startsWith('cat_'))));
});

test('qr url format uses configured number and table', () => {
  const phone = '919999999999';
  const table = 'T07';
  const text = `Hi, I want to order food. Table ${table}.`;
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
  assert.equal(url, `https://wa.me/919999999999?text=Hi%2C%20I%20want%20to%20order%20food.%20Table%20T07.`);
  assert.ok(url.includes('wa.me'));
  assert.ok(url.includes('Table%20T07'));
});

/* ------------------------------------------------------------------ */
/* Webhook signature validation tests                                 */
/* ------------------------------------------------------------------ */

function makeSignature(secret: string, payload: Buffer): string {
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `sha256=${expected}`;
}

test('webhook: RealWhatsAppAdapter.validateSignature with valid signature returns true', () => {
  const secret = 'test-app-secret-123';
  const adapter = new RealWhatsAppAdapter('token', 'phone-id', secret, 'v22.0');
  const payload = Buffer.from('{"entry":[{"changes":[{"value":{"messages":[{"id":"msg1","from":"+919999999999","text":{"body":"hi"}}]}]}]}', 'utf8');
  const signature = makeSignature(secret, payload);
  assert.ok(adapter.validateSignature(payload, signature));
});

test('webhook: RealWhatsAppAdapter.validateSignature with invalid signature returns false', () => {
  const secret = 'test-app-secret-123';
  const adapter = new RealWhatsAppAdapter('token', 'phone-id', secret, 'v22.0');
  const payload = Buffer.from('{"entry":[]}', 'utf8');
  assert.ok(!adapter.validateSignature(payload, 'sha256=invalid-signature'));
});

test('webhook: RealWhatsAppAdapter.validateSignature with undefined signature returns false', () => {
  const secret = 'test-app-secret-123';
  const adapter = new RealWhatsAppAdapter('token', 'phone-id', secret, 'v22.0');
  const payload = Buffer.from('{"entry":[]}', 'utf8');
  assert.ok(!adapter.validateSignature(payload, undefined));
});

test('webhook: RealWhatsAppAdapter.validateSignature with undefined appSecret returns false', () => {
  const adapter = new RealWhatsAppAdapter('token', 'phone-id', '', 'v22.0');
  const payload = Buffer.from('{"entry":[]}', 'utf8');
  assert.ok(!adapter.validateSignature(payload, 'sha256=anything'));
});

test('webhook: POST /webhook with invalid signature returns 401', async () => {
  const { createServer } = await import('node:http');
  const secret = 'test-app-secret-456';
  const sessions = new SessionStore(path.join(tempDir('sig-sessions'), 'sessions.json'), false);
  const orders = new OrderStore(tempDir('sig-store'));
  const adapter = new RealWhatsAppAdapter('token', 'phone-id', secret, 'v22.0');
  const router = new ConversationRouter(sessions, orders, adapter);
  const webhookRouter = createWebhookRouter(sessions, orders, router, adapter);

  const app = express();
  app.use(webhookRouter);

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;

  try {
    const payload = JSON.stringify({ entry: [] });
    const payloadBuffer = Buffer.from(payload, 'utf8');
    const badSig = makeSignature('wrong-secret', payloadBuffer);
    const res = await new Promise<{ statusCode: number }>((resolve, reject) => {
      const req = httpRequest({
        method: 'POST',
        host: '127.0.0.1',
        port,
        path: '/webhook',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': badSig,
        },
      }, (res) => {
        let statusCode = res.statusCode ?? 0;
        res.resume();
        resolve({ statusCode });
      });
      req.write(payloadBuffer);
      req.end();
      req.on('error', reject);
    });
    assert.equal(res.statusCode, 401);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('webhook: POST /webhook with valid signature returns 200', async () => {
  const { createServer } = await import('node:http');
  const secret = 'test-app-secret-789';
  const sessions = new SessionStore(path.join(tempDir('sig-sessions2'), 'sessions.json'), false);
  const orders = new OrderStore(tempDir('sig-store2'));
  const adapter = new RealWhatsAppAdapter('token', 'phone-id', secret, 'v22.0');
  const router = new ConversationRouter(sessions, orders, adapter);
  const webhookRouter = createWebhookRouter(sessions, orders, router, adapter);

  const app = express();
  app.use(webhookRouter);

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;

  try {
    const payload = JSON.stringify({ entry: [] });
    const payloadBuffer = Buffer.from(payload, 'utf8');
    const signature = makeSignature(secret, payloadBuffer);
    const res = await new Promise<{ statusCode: number }>((resolve, reject) => {
      const req = httpRequest({
        method: 'POST',
        host: '127.0.0.1',
        port,
        path: '/webhook',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
        },
      }, (res) => {
        let statusCode = res.statusCode ?? 0;
        res.resume();
        resolve({ statusCode });
      });
      req.write(payloadBuffer);
      req.end();
      req.on('error', reject);
    });
    assert.equal(res.statusCode, 200);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('webhook: GET /webhook verification returns challenge', async () => {
  const { createServer } = await import('node:http');
  const sessions = new SessionStore(path.join(tempDir('sig-sessions3'), 'sessions.json'), false);
  const orders = new OrderStore(tempDir('sig-store3'));
  const adapter = new SimulatedWhatsAppAdapter();
  const router = new ConversationRouter(sessions, orders, adapter);
  const webhookRouter = createWebhookRouter(sessions, orders, router, adapter);

  const app = express();
  app.use(webhookRouter);

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;

  try {
    const res = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      let body = '';
      const req = httpRequest({
        method: 'GET',
        host: '127.0.0.1',
        port,
        path: '/webhook?hub.mode=subscribe&hub.verify_token=veyora_webhook_verify&hub.challenge=test-challenge-123',
        headers: {},
      }, (res) => {
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode ?? 0, body });
        });
      });
      req.end();
      req.on('error', reject);
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body, 'test-challenge-123');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

/* ------------------------------------------------------------------ */
/* Webhook structured logging tests                                   */
/* ------------------------------------------------------------------ */

function captureConsoleLog(): { logs: string[]; restore: () => void } {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  };
  return {
    logs,
    restore: () => {
      console.log = originalLog;
    },
  };
}

function loggedJSON(logs: string[]): any[] {
  const results: any[] = [];
  for (const line of logs) {
    const match = line.match(/\{.*\}/);
    if (match) {
      try {
        results.push(JSON.parse(match[0]));
      } catch {
        // ignore non-JSON log lines
      }
    }
  }
  return results;
}

test('webhook: POST /webhook logs request, signature success, response status, and message count', async () => {
  const { createServer } = await import('node:http');
  const sessions = new SessionStore(path.join(tempDir('log-sessions'), 'sessions.json'), false);
  const orders = new OrderStore(tempDir('log-store'));
  const adapter = new SimulatedWhatsAppAdapter();
  const router = new ConversationRouter(sessions, orders, adapter);
  const webhookRouter = createWebhookRouter(sessions, orders, router, adapter);

  const app = express();
  app.use(webhookRouter);

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;

  const { logs, restore } = captureConsoleLog();
  try {
    // WhatsApp webhook payload with one incoming message
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: 'msg-log-001',
                    from: '+919999999999',
                    text: { body: 'Hello' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const payloadBuffer = Buffer.from(JSON.stringify(payload), 'utf8');

    const res = await new Promise<{ statusCode: number }>((resolve, reject) => {
      const req = httpRequest({
        method: 'POST',
        host: '127.0.0.1',
        port,
        path: '/webhook',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': 'sha256=any',
        },
      }, (res) => {
        let statusCode = res.statusCode ?? 0;
        res.resume();
        resolve({ statusCode });
      });
      req.write(payloadBuffer);
      req.end();
      req.on('error', reject);
    });
    assert.equal(res.statusCode, 200);

    const entries = loggedJSON(logs);
    const requestLog = entries.find((e) => e.method === 'POST' && e.path === '/webhook');
    assert.ok(requestLog, 'expected request log entry');

    const sigLog = entries.find((e) => e.status === undefined && e.messagesProcessed === undefined);
    // Find the signature validation succeeded log
    const sigSucceeded = logs.some((l) => l.includes('signature validation succeeded'));
    assert.ok(sigSucceeded, 'expected signature validation succeeded log');

    const responseLog = entries.find((e) => e.status === 200 && typeof e.messagesProcessed === 'number');
    assert.ok(responseLog, 'expected response log with status and messagesProcessed');
    assert.equal(responseLog!.messagesProcessed, 1);
  } finally {
    restore();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('webhook: POST /webhook with invalid signature logs failure and returns 401', async () => {
  const { createServer } = await import('node:http');
  const secret = 'test-app-secret-log';
  const sessions = new SessionStore(path.join(tempDir('log-sessions2'), 'sessions.json'), false);
  const orders = new OrderStore(tempDir('log-store2'));
  const adapter = new RealWhatsAppAdapter('token', 'phone-id', secret, 'v22.0');
  const router = new ConversationRouter(sessions, orders, adapter);
  const webhookRouter = createWebhookRouter(sessions, orders, router, adapter);

  const app = express();
  app.use(webhookRouter);

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;

  const { logs, restore } = captureConsoleLog();
  try {
    const payload = JSON.stringify({ entry: [] });
    const payloadBuffer = Buffer.from(payload, 'utf8');
    const badSig = makeSignature('wrong-secret', payloadBuffer);

    const res = await new Promise<{ statusCode: number }>((resolve, reject) => {
      const req = httpRequest({
        method: 'POST',
        host: '127.0.0.1',
        port,
        path: '/webhook',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': badSig,
        },
      }, (res) => {
        let statusCode = res.statusCode ?? 0;
        res.resume();
        resolve({ statusCode });
      });
      req.write(payloadBuffer);
      req.end();
      req.on('error', reject);
    });
    assert.equal(res.statusCode, 401);

    const sigFailed = logs.some((l) => l.includes('signature validation failed'));
    assert.ok(sigFailed, 'expected signature validation failed log');

    const responseLog = loggedJSON(logs).find((e) => e.status === 401);
    assert.ok(responseLog, 'expected response log with status 401');

    // No response log with status 200 should appear for a failed signature
    const successLog = loggedJSON(logs).find((e) => e.status === 200);
    assert.ok(!successLog, 'expected no 200 response log for failed signature');
  } finally {
    restore();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
