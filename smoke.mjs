/**
 * End-to-end smoke test through the simulator endpoints.
 * Run: rm -rf /home/user/Bot/data && node /home/user/Bot/smoke.mjs
 */

import fs from 'fs';

const BASE = 'http://localhost:3000';
let phone = '+91999999' + String(Date.now() % 100000000).padStart(8, '0');
let msgId = 0;
let orderRef = null;

// Clear persisted state so each smoke run starts fresh.
const dataDir = '/home/user/Bot/data';
if (fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true });

function msg(text, interactive, messageId) {
  return { messageId: messageId ?? `s${++msgId}`, from: phone, text, interactive };
}

async function post(path, body) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function get(path) {
  const r = await fetch(BASE + path);
  return r.json();
}

let fails = 0;
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + ' - ' + name);
  if (!cond) fails++;
}

(async () => {
  const health = await get('/health');
  check('health ok', health.status === 'ok' && health.demoMode === true);

  // 1. Customer scans QR T01 and sends prefilled message
  let r = await post('/simulate/message', msg('Hi, I want to order food. Table T01.'));
  check('welcome: 2 responses', r.responses.length === 2);
  check('welcome mentions restaurant', /VEYORA Demo Restaurant/.test(r.outbox[0].body));
  check('welcome mentions table T01', /Your table: T01/.test(r.outbox[0].body));
  check('main menu is a list with 5 rows', r.outbox[1].type === 'list' && r.outbox[1].sections[0].rows.length === 5);

  // 2. View Menu
  r = await post('/simulate/message', msg('', { type: 'list_reply', list_reply: { id: 'cb_view_menu', title: 'View Menu' } }));
  check('categories list', r.outbox.some((m) => m.type === 'list' && m.body.includes('menu categories')));

  // 3. Starters
  r = await post('/simulate/message', msg('', { type: 'list_reply', list_reply: { id: 'cat_starters', title: 'Starters' } }));
  check('starter items listed', r.outbox.some((m) => m.type === 'list' && m.body.includes('Starters — tap an item')));
  check('add row exists', r.outbox.some((m) => m.sections?.[0]?.rows.some((x) => x.id === 'add_item_paneer_tikka')));

  // 4. Add 2 x Paneer Tikka
  r = await post('/simulate/message', msg('', { type: 'list_reply', list_reply: { id: 'add_item_paneer_tikka', title: 'Paneer Tikka' } }));
  r = await post('/simulate/message', msg('', { type: 'list_reply', list_reply: { id: 'qty_item_paneer_tikka_2', title: '2 items' } }));
  check('added to cart', /Added 2 × Paneer Tikka/.test(r.outbox[r.outbox.length - 2].body));

  // 5. View cart
  r = await post('/simulate/message', msg('', { type: 'list_reply', list_reply: { id: 'cb_cart', title: '🛒 View cart' } }));
  check('cart shows ₹500', r.outbox.some((m) => m.type === 'text' && m.body.includes('₹500')));

  // 6. Checkout + confirm
  r = await post('/simulate/message', msg('', { type: 'list_reply', list_reply: { id: 'cb_checkout', title: 'Proceed to checkout' } }));
  check('confirm screen', r.outbox.some((m) => m.body.includes('Please confirm your order')));
  r = await post('/simulate/message', msg('', { type: 'button_reply', button_reply: { id: 'cb_confirm_order', title: 'Confirm Order' } }));
  const confirmBodies = r.outbox.map((m) => m.body).join('\n');
  const m = confirmBodies.match(/ORD-\d+/);
  check('order confirmed with reference', !!m);
  orderRef = m ? m[0] : null;

  // 7. Track order
  r = await post('/simulate/message', msg('', { type: 'list_reply', list_reply: { id: 'cb_track_order', title: 'Track Order' } }));
  check('track shows Order received', r.outbox.some((m) => m.body.includes('Order received')));

  // 8. Staff updates status via backend
  const up = await fetch(BASE + `/admin/orders/${orderRef}/status`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'preparing' }),
  });
  check('staff status update accepted', up.status === 200);

  // 9. Track again → Preparing
  r = await post('/simulate/message', msg('', { type: 'list_reply', list_reply: { id: 'cb_track_order', title: 'Track Order' } }));
  check('track shows Preparing', r.outbox.some((m) => m.body.includes('Preparing')));

  // 10. Request bill
  r = await post('/simulate/message', msg('', { type: 'list_reply', list_reply: { id: 'cb_request_bill', title: 'Request Bill' } }));
  const billBodies = r.outbox.map((m) => m.body).join('\n');
  check('bill shows table', billBodies.includes('Table T01'));
  check('bill shows subtotal', billBodies.includes('Subtotal: ₹500'));
  check('bill shows total', /Total amount: ₹/.test(billBodies));
  check('bill notifies staff', billBodies.includes('notified the restaurant staff'));
  check('no payment completion claim', !/payment (is |has been )?completed/i.test(billBodies));

  const br = await get('/admin/bill-requests');
  check('bill request recorded', Array.isArray(br) && br.some((x) => x.orderReference === orderRef));

  // 11. Feedback
  r = await post('/simulate/message', msg('', { type: 'list_reply', list_reply: { id: 'cb_give_feedback', title: 'Give Feedback' } }));
  r = await post('/simulate/message', msg('', { type: 'list_reply', list_reply: { id: 'feedback_5', title: '5 stars' } }));
  r = await post('/simulate/message', msg('Amazing food, will return!'));
  check('feedback thanked', r.outbox.some((m) => m.body.includes('Thank you for your feedback')));
  const fb = await get('/admin/feedback');
  check('feedback saved', Array.isArray(fb) && fb.some((x) => x.rating === 5 && x.comment === 'Amazing food, will return!'));

  // 12. Duplicate event protection (fresh id)
  r = await post('/simulate/message', msg('Table T02', undefined, 'smoke-dup-1'));
  check('first dup request gets response', r.responses.length > 0);
  r = await post('/simulate/message', msg('Table T02', undefined, 'smoke-dup-1'));
  check('duplicate ignored', r.responses.length === 0);

  // 13. Invalid message helpful
  r = await post('/simulate/message', msg('asdfghjk'));
  const anyBody = r.outbox.map((m) => m.body || '').join(' ');
  const hasHelpfulText = /understood|order|menu|bill|track|feedback/i.test(anyBody);
  check('helpful invalid response', r.responses.length > 0 && r.outbox.length > 0 && hasHelpfulText);

  console.log(fails === 0 ? '\n✅ ALL SMOKE TESTS PASSED' : `\n❌ ${fails} SMOKE TESTS FAILED`);
  process.exit(fails === 0 ? 0 : 1);
})();
