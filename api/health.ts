/**
 * Vercel serverless health check endpoint.
 * GET /health — returns bot status without exposing credentials.
 */

import { config } from '../src/config';

export default async function handler(
  req: { method?: string },
    res: {
    status: (code: number) => { json: (body: unknown) => void; send: (body: string) => void };
    json: (body: unknown) => void;
    send: (body: string) => void;
  },
) {
  if (req.method && req.method !== 'GET') {
    res.status(405).send('Method not allowed');
    return;
  }

  res.status(200).json({
    status: 'ok',
    demoMode: config.demoMode,
    credentialsConfigured: Boolean(
      config.whatsapp.token &&
        config.whatsapp.phoneNumberId &&
        config.whatsapp.phoneNumber,
    ),
    restaurant: config.restaurant.name,
    tables: config.restaurant.tables,
    platform: 'vercel-serverless',
    note: 'Vercel serverless is stateless — sessions/orders do not persist between invocations. Use Render for production.',
  });
}
