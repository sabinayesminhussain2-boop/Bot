/**
 * Generates printable QR codes for restaurant tables.
 *
 * Each QR encodes a WhatsApp click-to-chat URL with a prefilled,
 * table-specific message, e.g. "Hi, I want to order food. Table T01."
 *
 * Run: npm run qr:generate   (requires WHATSAPP_PHONE_NUMBER in .env)
 */

import qrcode from 'qrcode';
import fs from 'fs';
import path from 'path';
import { config } from '../src/config';

async function main(): Promise<void> {
  const outDir = path.resolve('qr-codes');
  fs.mkdirSync(outDir, { recursive: true });

  const phone = config.whatsapp.phoneNumber;
  if (!phone) {
    console.error(
      '❌ WHATSAPP_PHONE_NUMBER is not set in .env. ' +
        'Set it to the restaurant WhatsApp number (international format, no "+"), then re-run.',
    );
    process.exit(1);
  }

  const rows: string[] = [];
  for (const table of config.restaurant.tables) {
    const text = `Hi, I want to order food. Table ${table}.`;
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
    const file = path.join(outDir, `qr-${table}.png`);
    await qrcode.toFile(file, url);
    console.log(`✅ qr-${table}.png  →  ${url}`);
    rows.push(
      `<tr><td><strong>${table}</strong></td>` +
        `<td><img src="qr-${table}.png" width="160"></td>` +
        `<td><a href="${url}">${url}</a></td></tr>`,
    );
  }

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>VEYORA — Table QR codes</title>
<style>body{font-family:sans-serif;padding:24px;} table{border-collapse:collapse;margin-top:16px;} td,th{border:1px solid #ddd;padding:8px;vertical-align:top;} img{display:block;margin-bottom:8px;} a{color:#25d366;}</style>
</head>
<body>
<h1>VEYORA — Restaurant Table QR Codes</h1>
<p>Customers scan the code for their table to open WhatsApp with a prefilled order message.</p>
<p><b>Restaurant:</b> ${config.restaurant.name} &nbsp;|&nbsp; <b>Number:</b> ${phone}</p>
<table>
<thead><tr><th>Table</th><th>QR Code</th><th>Click-to-chat URL</th></tr></thead>
<tbody>${rows.join('')}</tbody>
</table>
<p><b>Note:</b> Scanning the QR only opens WhatsApp. The bot replies after the customer sends the prefilled message.</p>
</body>
</html>`;
  fs.writeFileSync(path.join(outDir, 'index.html'), html);
  console.log(`\n📄 Printable gallery: ${path.join(outDir, 'index.html')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
