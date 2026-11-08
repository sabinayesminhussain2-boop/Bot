# Backend Setup — for your custom backend

This document explains how to connect your custom backend to the VEYORA
WhatsApp chatbot demo. The demo already contains a working in-memory
"backend" (see `src/orders.ts`, `src/state.ts`, `src/cart.ts`) you can
replace piece by piece.

## What your backend must provide

| Responsibility | Demo implementation | What to replace |
|---|---|---|
| Menu & pricing | `src/menu.ts` (hardcoded demo data) | Your menu service / DB |
| Conversation state | `src/state.ts` (JSON file) | Your session store keyed by WhatsApp phone number |
| Orders | `src/orders.ts` (JSON file) | Your order service |
| Order status updates | `src/orders.ts` + `/admin/orders/:ref/status` | Your staff order-management tool |
| Bill requests | `src/orders.ts` | Your billing/POS integration |
| Customer feedback | `src/orders.ts` | Your feedback store |
| WhatsApp messaging | `src/whatsapp.ts` (real + simulated adapter) | WhatsApp Business Platform Cloud API |

## WhatsApp integration (the part you wire up)

The router (`ConversationRouter` in `src/router.ts`) is transport-agnostic.
It never calls the network — it only calls a `WhatsAppAdapter`. To go live:

1. Create a WhatsApp Business Platform app at
   https://developers.facebook.com and get a phone number ID + access token.
2. Set the env vars below in `.env` and set `DEMO_MODE=false`.
3. Configure your webhook URL to point to `POST /webhook` on this server.
4. The webhook verifies the `hub.verify_token` challenge and validates the
   `X-Hub-Signature-256` signature using `WHATSAPP_APP_SECRET`.

The adapter (`RealWhatsAppAdapter`) already sends text, reply buttons (max 3),
and list messages, and validates signatures. You just need to plug in real
credentials.

## Admin test endpoints (optional, not the main product)

These are small supporting tools for testing the staff workflow. They are
NOT a staff dashboard — remove or secure them before production.

- `POST /admin/orders/:reference/status` — body `{ "status": "received|confirmed|preparing|ready|served|cancelled" }`
- `GET /admin/orders` — list all orders
- `GET /admin/bill-requests` — list bill requests
- `GET /admin/feedback` — list customer feedback

## How staff updates reach customers

The router reads order status from `OrderStore` on every `Track Order` and
`Request Bill` request. When your backend updates a status, the customer's
next WhatsApp message will reflect it automatically — no extra work needed.

## Data your backend should persist (per customer phone number)

- Conversation stage & cart
- Table assignment (from the QR prefilled message: "Table T01")
- Orders: reference, items, subtotal, tax, total, status, idempotency key
- Bill requests (table, order reference, requested at)
- Feedback: rating, comment, table

## Idempotency / duplicate protection

When confirming an order, generate an idempotency key (e.g.
`cart:<phone>:<timestamp>`) and store it with the order. If the same key is
sent again (duplicate webhook event or double-tap), reject it and return the
existing order reference instead of creating a duplicate. The demo does this
in `src/orders.ts` (`createOrder` returns `null` for a repeated key).

## Environment variables (see `.env.example`)

| Variable | Purpose |
|---|---|
| `DEMO_MODE` | `true` = simulation (no WhatsApp credentials needed); `false` = live WhatsApp API |
| `WHATSAPP_TOKEN` | WhatsApp Cloud API access token |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp business phone number ID |
| `WHATSAPP_PHONE_NUMBER` | Restaurant WhatsApp number, international format, no "+" |
| `WHATSAPP_APP_SECRET` | App secret for webhook signature validation |
| `WHATSAPP_VERIFY_TOKEN` | Webhook verification token |
| `RESTAURANT_NAME` | Shown in welcome message |
| `TABLES` | Comma-separated table IDs (T01,T02,…) |
| `TAX_RATE` | Decimal, e.g. `0.05` for 5% |
| `CURRENCY` / `CURRENCY_SYMBOL` | e.g. `INR` / `₹` |
| `PORT` | Server port (default 3000) |
| `STATE_FILE` | Session persistence path |

Never commit `.env` — it holds secrets. `.env.example` is safe to commit.

## Running

```
npm install          # install dependencies
cp .env.example .env # fill in WhatsApp credentials (or leave DEMO_MODE=true)
npm run build        # compile TypeScript
npm start            # start the server
```

In demo mode, use `POST /simulate/message` to send test customer messages
without any WhatsApp credentials. See `smoke.mjs` for an example.

## QR codes

```
npm run qr:generate   # creates qr-codes/qr-T01.png ... and qr-codes/index.html
```

Each QR encodes `https://wa.me/<PHONE>?text=Hi, I want to order food. Table T01.`

Customers scan → WhatsApp opens → customer sends the prefilled message → bot replies.

## Demo vs live vs simulated

- **Working (no credentials):** All conversation flows, menu, cart, order,
  confirm/cancel, track, bill, feedback, QR generation, duplicate protection.
- **Simulated (no credentials):** Outgoing WhatsApp messages are logged to the
  console and stored in an in-memory outbox. Clearly labeled as simulation.
- **Requires credentials:** Real WhatsApp message delivery via the Cloud API
  (`DEMO_MODE=false` + valid `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
  `WHATSAPP_PHONE_NUMBER`).
