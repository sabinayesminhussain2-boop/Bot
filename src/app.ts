/**
 * Express application assembly.
 */

import express from 'express';
import { config } from './config';
import { SessionStore } from './state';
import { OrderStore } from './orders';
import {
  SimulatedWhatsAppAdapter,
  RealWhatsAppAdapter,
  WhatsAppAdapter,
} from './whatsapp';
import { ConversationRouter } from './router';
import { createWebhookRouter } from './webhook';
import { createSimulatorRouter } from './simulator';

export interface AppParts {
  app: express.Application;
  sessions: SessionStore;
  orders: OrderStore;
  adapter: WhatsAppAdapter;
  router: ConversationRouter;
}

export function createApp(): AppParts {
  const sessions = new SessionStore(
    `${config.stateDir}/sessions.json`,
    true,
  );
  const orders = new OrderStore(config.stateDir);
  const adapter: WhatsAppAdapter = hasRealCredentials()
    ? new RealWhatsAppAdapter(
        config.whatsapp.token,
        config.whatsapp.phoneNumberId,
        config.whatsapp.appSecret,
        config.whatsapp.apiVersion,
      )
    : new SimulatedWhatsAppAdapter();

  const router = new ConversationRouter(sessions, orders, adapter);

  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      demoMode: config.demoMode,
      credentialsConfigured: hasRealCredentials(),
      restaurant: config.restaurant.name,
      tables: config.restaurant.tables,
    });
  });

  app.use(createWebhookRouter(sessions, orders, router, adapter));

  if (config.demoMode) {
    app.use(createSimulatorRouter(sessions, router, adapter));
    console.log('[demo] simulation mode active — use /simulate/* endpoints');
  } else {
    console.log('[live] real WhatsApp Cloud API adapter active');
  }

  return { app, sessions, orders, adapter, router };
}

function hasRealCredentials(): boolean {
  return Boolean(
    config.whatsapp.token &&
      config.whatsapp.phoneNumberId &&
      config.whatsapp.phoneNumber,
  );
}
