/**
 * Express webhook router for the WhatsApp Business Platform Cloud API.
 *
 * Routes:
 *  GET    /webhook        — webhook verification (challenge response)
 *  POST   /webhook        — incoming messages (signature validated)
 *  POST   /admin/orders/:reference/status   — minimal staff tool: update order status
 *  GET    /admin/orders                 — list orders (optional staff test tool)
 *  GET    /admin/bill-requests          — list bill requests
 *  GET    /admin/feedback               — list customer feedback
 *
 * The /admin routes are a small supporting tool for testing the staff workflow.
 * They are not the main product — see docs/BACKEND_SETUP.md.
 */

import express from 'express';
import { config } from './config';
import { ConversationRouter } from './router';
import { SessionStore } from './state';
import { OrderStore } from './orders';
import { WhatsAppAdapter } from './whatsapp';
import { IncomingMessage } from './router';

export function createWebhookRouter(
  sessions: SessionStore,
  orders: OrderStore,
  router: ConversationRouter,
  adapter: WhatsAppAdapter,
) {
  const app = express.Router();

  /* ---- WhatsApp webhook verification ---- */
  app.get('/webhook', (_req, res) => {
    const mode = _req.query['hub.mode'];
    const token = _req.query['hub.verify_token'];
    const challenge = _req.query['hub.challenge'];

    if (mode === 'subscribe' && token === config.whatsapp.verifyToken) {
      res.status(200).send(challenge);
      console.log('[webhook] verified');
    } else {
      res.status(403).send('Forbidden: invalid verify token');
    }
  });

  /* ---- Incoming messages ---- */
  app.post(
    '/webhook',
    express.raw({ type: '*/*' }),
    async (req, res) => {
      const rawBody: Buffer = req.body as Buffer;
      const signature = req.headers['x-hub-signature-256'] as string | undefined;

      // Log incoming request metadata only (no secrets, signatures, or message contents).
      console.log(
        '[webhook] request',
        JSON.stringify({ method: req.method, path: req.url }),
      );

      const signatureValid = adapter.validateSignature(rawBody, signature);
      if (!signatureValid) {
        console.log(
          '[webhook] signature validation failed',
          JSON.stringify({ method: req.method, path: req.url, status: 401 }),
        );
        return res.status(401).send('Invalid signature');
      }
      console.log(
        '[webhook] signature validation succeeded',
        JSON.stringify({ method: req.method, path: req.url }),
      );

      let body: unknown;
      try {
        body = JSON.parse(rawBody.toString('utf8'));
      } catch {
        console.log(
          '[webhook] invalid JSON',
          JSON.stringify({ method: req.method, path: req.url, status: 400 }),
        );
        return res.status(400).send('Invalid JSON');
      }

      let messageCount = 0;
      let status = 200;
      try {
        messageCount = await processWebhookBody(body, router);
      } catch (error) {
        // WhatsApp retries on non-2xx; always acknowledge receipt.
        console.error('[webhook] processing error:', (error as Error).message);
        status = 200;
      }
      console.log(
        '[webhook] response',
        JSON.stringify({
          method: req.method,
          path: req.url,
          status,
          messagesProcessed: messageCount,
        }),
      );
      res.status(status).send('OK');
    },
  );

  /* ---- Optional staff test tools ---- */
  app.post('/admin/orders/:reference/status', express.json(), (req, res) => {
    const { reference } = req.params;
    const { status } = req.body as { status?: string };
    const valid = [
      'received',
      'confirmed',
      'preparing',
      'ready',
      'served',
      'cancelled',
    ];
    if (!status || !valid.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const order = orders.updateStatus(reference, status as OrderStatus);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    console.log(`[STAFF] Order ${reference} status -> ${status}`);
    res.json({ ok: true, order });
  });

  app.get('/admin/orders', (_req, res) => res.json(orders.list()));
  app.get('/admin/bill-requests', (_req, res) =>
    res.json(orders.listBillRequests()),
  );
  app.get('/admin/feedback', (_req, res) => res.json(orders.listFeedback()));

  return app;
}

type OrderStatus =
  | 'received'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'served'
  | 'cancelled';

async function processWebhookBody(
  body: unknown,
  router: ConversationRouter,
): Promise<number> {
  let messageCount = 0;
  const entry = (body as { entry?: unknown[] }).entry ?? [];
  for (const e of entry) {
    const changes = (e as { changes?: unknown[] }).changes ?? [];
      for (const change of changes) {
        const value = (change as { value?: unknown }).value as
        | { messages?: unknown[]; statuses?: unknown[] }
        | undefined;
      if (!value) continue;
      for (const m of value.messages ?? []) {
        await router.handleIncoming(normalizeMessage(m));
        messageCount++;
      }
      for (const s of value.statuses ?? []) {
        console.log('[webhook] message status update:', JSON.stringify(s));
      }
    }
  }
  return messageCount;
}

function normalizeMessage(m: unknown): IncomingMessage {
  const message = m as {
    id?: string;
    from?: string;
    text?: { body?: string };
    interactive?: {
      type?: string;
      button_reply?: { id?: string; title?: string };
      list_reply?: { id?: string; title?: string };
    };
  };
  return {
    id: message.id,
    from: message.from || '',
    text: message.text?.body,
    interactive: message.interactive as
      | {
          type: 'button_reply' | 'list_reply';
          button_reply?: { id?: string; title?: string };
          list_reply?: { id?: string; title?: string };
        }
      | undefined,
  } as IncomingMessage;
}
