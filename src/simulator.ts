/**
 * Demo-mode test harness.
 *
 * Simulates incoming WhatsApp messages by reusing the exact same conversation
 * router as the real webhook. Responses are captured by the simulated adapter
 * and returned over HTTP so the demo can be verified without any WhatsApp
 * credentials. Clearly separated from live WhatsApp messaging.
 */

import express from 'express';
import { config } from './config';
import { ConversationRouter } from './router';
import { SessionStore } from './state';
import { WhatsAppAdapter } from './whatsapp';

export function createSimulatorRouter(
  sessions: SessionStore,
  router: ConversationRouter,
  adapter: WhatsAppAdapter,
) {
  const app = express.Router();
  app.use(express.json());

  interface SimulateBody {
    from?: string;
    text?: string;
    messageId?: string;
    interactive?: unknown;
  }

  app.post('/simulate/message', async (req, res) => {
    const { from, text, messageId, interactive } = req.body as SimulateBody;
    if (!from) {
      return res.status(400).json({ error: 'from is required' });
    }

    const raw = {
      id: messageId,
      from,
      text,
      interactive: interactive as
        | { type: 'button_reply' | 'list_reply'; button_reply?: { id: string; title: string }; list_reply?: { id: string; title: string } }
        | undefined,
    };

    const responses = await router.handleIncoming(raw);

    const outbox =
      typeof adapter.getOutbox === 'function'
        ? ((adapter as unknown as { getOutbox: () => unknown[] }).getOutbox().slice(-responses.length))
        : [];

    res.json({ ok: true, responses, outbox });
  });

  app.get('/simulate/outbox', (_req, res) => {
    const outbox =
      typeof adapter.getOutbox === 'function'
        ? ((adapter as unknown as { getOutbox: () => unknown[] }).getOutbox())
        : [];
    res.json(outbox);
  });

  app.get('/simulate/session/:phone', (req, res) => {
    const session = sessions.get(req.params.phone);
    if (!session) return res.status(404).json({ error: 'session not found' });
    res.json(session);
  });

  return app;
}
