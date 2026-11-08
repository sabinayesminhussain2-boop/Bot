/**
 * Entry point: start the Express server.
 */

import { createApp } from './app';
import { config } from './config';

const { app } = createApp();

// Render sets PORT and requires binding to 0.0.0.0.
const host = '0.0.0.0';
const port = config.port;

app.listen(port, host, () => {
  console.log(`\n🍽️  VEYORA Restaurant WhatsApp Bot`);
  console.log(`   Restaurant: ${config.restaurant.name}`);
  console.log(`   Tables: ${config.restaurant.tables.join(', ')}`);
  console.log(`   Mode: ${config.demoMode ? 'SIMULATION (demo)' : 'LIVE WhatsApp Cloud API'}`);
  console.log(`   Server: http://localhost:${config.port}`);
  console.log(`   Health: http://localhost:${config.port}/health`);
  console.log(`   Webhook: POST http://localhost:${config.port}/webhook`);
  if (config.demoMode) {
    console.log(`   Simulator: POST http://localhost:${config.port}/simulate/message`);
  }
  console.log(`\nGenerate table QR codes with: npm run qr:generate\n`);
});
