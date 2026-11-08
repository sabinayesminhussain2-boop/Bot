/**
 * Vercel serverless webhook endpoint for WhatsApp Business Platform Cloud API.
 *
 * GET  /webhook — webhook verification (challenge response)
 * POST /webhook — incoming messages (signature validated)
 *
 * IMPORTANT: Vercel serverless is stateless. Customer sessions and orders
 * do NOT persist between invocations. Multi-step conversations (order →
 * confirm → track → bill → feedback) will break on Vercel because the
 * in-memory state is lost after each request.
 *
 * For production with persistent sessions and orders, deploy to Render
 * (see README.md deployment section).
 */

import { createApp } from '../src/app';
import { config } from '../src/config';

// Create the Express app once per cold start.
const { app } = createApp();

// Override storage directory for Vercel's writable (but ephemeral) /tmp.
// This prevents crashes but does NOT persist across invocations.
export default async function handler(
  req: {
    method?: string;
    headers: { [key: string]: string | string[] | undefined };
    query: { [key: string]: string | string[] | undefined };
    body: unknown;
    url?: string;
  },
  res: {
    status: (code: number) => { json: (body: unknown) => void; send: (body: string) => void };
    json: (body: unknown) => void;
    send: (body: string) => void;
    setHeader: (name: string, value: string) => void;
  },
): Promise<void> {
  const url = req.url || '/webhook';

  // Route GET /webhook (verification) and POST /webhook (messages)
  if (url === '/webhook' || url.startsWith('/webhook?')) {
    if (req.method === 'GET') {
      const mode = req.query['hub.mode'];
      const token = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];

      if (mode === 'subscribe' && token === config.whatsapp.verifyToken) {
        res.status(200).send(String(challenge));
        return;
      }
      res.status(403).send('Forbidden: invalid verify token');
      return;
    }

    if (req.method === 'POST') {
      const signature =
        (req.headers['x-hub-signature-256'] as string) ||
        (req.headers['x-hub-signature-256'] as string[])[0];

      const appSecret = config.whatsapp.appSecret;

      if (appSecret) {
        if (!signature || !validateSignatureVercel(req.body, signature)) {
          res.status(401).send('Invalid signature');
          return;
        }
      } else {
        console.warn(
          '[webhook] WHATSAPP_APP_SECRET not set — signature validation skipped',
        );
      }

      let body: unknown;
      try {
        body = JSON.parse(JSON.stringify(req.body));
      } catch {
        res.status(400).send('Invalid JSON');
        return;
      }

      try {
        await processWebhookBody(body, app);
        res.status(200).send('OK');
      } catch (error) {
        console.error('[webhook] processing error:', (error as Error).message);
        res.status(200).send('OK');
      }
      return;
    }

    res.status(405).send('Method not allowed');
    return;
  }

  // Fall through to Express for other routes (e.g. /health, /simulate/*)
  // Vercel passes the request to the Express app.
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  app(req as unknown as Parameters<typeof app>[0], res as unknown as Parameters<typeof app>[1]);
}

/**
 * Minimal signature validation for serverless (mirrors whatsapp.ts logic
 * without importing the adapter, to keep this file self-contained).
 */
function validateSignatureVercel(body: unknown, signature: string): boolean {
  try {
    const crypto = require('node:crypto');
    const raw = JSON.stringify(body);
    const expected = crypto
      .createHmac('sha256', config.whatsapp.appSecret)
      .update(raw)
      .digest('hex');
    return signature === `sha256=${expected}`;
  } catch {
    return false;
  }
}

/**
 * Process WhatsApp webhook body using the Express app's router.
 * Reuses the same conversation router as the live server.
 */
async function processWebhookBody(body: unknown, app: unknown): Promise<void> {
  // The Express app is already mounted with the webhook router.
  // For serverless, we need direct access to the router. Since createApp()
  // doesn't expose the router, we re-create minimal processing here.
  const entry = (body as { entry?: unknown[] }).entry ?? [];
  for (const e of entry) {
    const changes = (e as { changes?: unknown[] }).changes ?? [];
    for (const change of changes) {
      const value = (change as { value?: unknown }).value as
        | { messages?: unknown[]; statuses?: unknown[] }
        | undefined;
      if (!value) continue;
      for (const m of value.messages ?? []) {
        await handleIncomingMessage(m);
      }
      for (const s of value.statuses ?? []) {
        console.log('[webhook] message status update:', JSON.stringify(s));
      }
    }
  }
}

async function handleIncomingMessage(m: unknown): Promise<void> {
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

  const { ConversationRouter } = await import('../src/router');
  const { SessionStore } = await import('../src/state');
  const { OrderStore } = await import('../src/orders');
  const { SimulatedWhatsAppAdapter } = await import('../src/whatsapp');
  const { config } = await import('../src/config');

  // Per-invocation stores — stateless on Vercel. Sessions/orders reset each cold start.
  const sessions = new SessionStore('/tmp/veyora-sessions.json', true);
  const orders = new OrderStore('/tmp/veyora-data');
  const adapter = new SimulatedWhatsAppAdapter();
  const router = new ConversationRouter(sessions, orders, adapter);

  const raw = {
    id: message.id,
    from: message.from || '',
    text: message.text?.body,
    interactive: message.interactive as
      | {
          type: 'button_reply' | 'list_reply';
          button_reply?: { id: string; title: string };
          list_reply?: { id: string; title: string };
        }
      | undefined,
  };

  await router.handleIncoming(raw as import('../src/router').IncomingMessage);
}
