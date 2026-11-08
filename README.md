# VEYORA — Restaurant WhatsApp Automation Bot

A working DEMO of a restaurant WhatsApp chatbot accessed by scanning a QR code
on the table. The customer experience stays entirely inside WhatsApp — no
website, landing page, or dashboard is the main product.

## The customer journey

1. Customer scans the table QR code → WhatsApp opens with a prefilled message
   like `"Hi, I want to order food. Table T01."`
2. Customer sends the message → the bot replies with a welcome message and an
   interactive menu.
3. Customer can: View Menu → Place Order → Track Order → Request Bill → Give
   Feedback — all inside WhatsApp using native interactive lists/buttons.
4. Confirmed orders are submitted to the backend with an order reference.
5. Staff can update order status; customers see it when they track.
6. Bill requests notify staff; feedback is saved and acknowledged.

## Architecture (separated concerns)

- `src/whatsapp.ts` — WhatsApp messaging adapter (real Cloud API + simulation)
- `src/webhook.ts` — Incoming webhook handling (verification + signature)
- `src/router.ts` — Conversation state machine / customer flows
- `src/state.ts` — Per-customer conversation state (session store)
- `src/menu.ts` — Menu and pricing data (configurable demo data)
- `src/cart.ts` — Cart and order management
- `src/orders.ts` — Orders, bill requests, feedback (in-memory backend)
- `scripts/generate-qr.ts` — QR code generation per table

## Quick start

```
npm install
cp .env.example .env          # fill in WhatsApp credentials, or leave DEMO_MODE=true
npm run build                 # compile TypeScript
npm start                     # start the server (port 3000)
```

- Health: `GET http://localhost:3000/health`
- Webhook: `POST http://localhost:3000/webhook`
- Demo simulator (no credentials): `POST http://localhost:3000/simulate/message`
- Generate QR codes: `npm run qr:generate` → `qr-codes/`

## Test results

```
npm test
# 25 tests, 25 passing, 0 failing
```

Tests cover: configurable tables, missing-credentials reporting (no false
success), menu/pricing, cart math, order creation & idempotency (no duplicates),
status updates, bill requests & staff notification, feedback saving, welcome
message with table from QR text, menu navigation, unavailable items, confirm /
cancel, track-order status reflection, cancelled orders never submitted,
invalid-message handling, QR URL format, webhook signature validation
(valid/invalid/undefined signature, undefined appSecret), POST webhook
401/200 on invalid/valid signature, and GET webhook verification challenge.

### What actually ran vs what needs credentials

| Feature | Status |
|---|---|
| All conversation flows (welcome, menu, order, track, bill, feedback) | ✅ Running in simulation |
| Interactive WhatsApp lists & buttons | ✅ Running in simulation |
| QR code generation (downloadable/printable PNGs) | ✅ Running |
| Menu / prices / tax calculation | ✅ Running (configurable) |
| Duplicate webhook protection / idempotent orders | ✅ Running |
| Staff status updates reflected to customers | ✅ Running (via /admin endpoints) |
| Real WhatsApp message delivery | ⚠️ Requires WhatsApp credentials (`DEMO_MODE=false`) |
| Webhook signature validation | ⚠️ Requires `WHATSAPP_APP_SECRET` |

## Backend setup for your friend

See `BACKEND_SETUP.md` — how to replace the in-memory backend with your custom
backend, wire up the WhatsApp Cloud API, and use the admin test endpoints.

## Known limitations

- In demo mode, WhatsApp messages are logged to the console, not delivered to
  real phones. Clearly labeled as simulation; no claim of live WhatsApp connection
  is made unless credentials are configured.
- No payment integration is included or claimed as operational. Bills show the
  total amount and state that payment is settled at the table.
- The small `/admin/*` endpoints are optional staff test tools, not a staff
  dashboard. Remove or secure them before production.
- Session data is persisted to a JSON file; for production, replace with your
  backend's session store.
