/**
 * Conversation router — implements the restaurant customer journey inside WhatsApp.
 *
 * Stages: new -> main_menu -> (menu_categories | ordering | tracking | billing |
 * feedback_rating | feedback_comment) -> main_menu / completed.
 *
 * The router is transport-agnostic: it receives normalized incoming messages and
 * calls a WhatsAppAdapter (real or simulated). It never touches the network itself.
 */

import { config } from './config';
import { CustomerSession, SessionStore, newSession } from './state';
import { OrderStore } from './orders';
import { WhatsAppAdapter, SendResult } from './whatsapp';
import {
  MENU,
  MenuCategory,
  categoryById,
  findItem,
  formatPrice,
  itemTypeLabel,
} from './menu';
import {
  emptyCart,
  addToCart,
  cartSubtotal,
  cartItemCount,
  cartSummaryText,
} from './cart';

/* Callback ids used in interactive messages. */
const CB = {
  MAIN_MENU: 'cb_main_menu',
  VIEW_MENU: 'cb_view_menu',
  PLACE_ORDER: 'cb_place_order',
  TRACK_ORDER: 'cb_track_order',
  REQUEST_BILL: 'cb_request_bill',
  GIVE_FEEDBACK: 'cb_give_feedback',
  BACK: 'cb_back',
  CART: 'cb_cart',
  CLEAR_CART: 'cb_clear_cart',
  CHECKOUT: 'cb_checkout',
  CONFIRM_ORDER: 'cb_confirm_order',
  EDIT_ORDER: 'cb_edit_order',
  CANCEL_ORDER: 'cb_cancel_order',
  ADD_MORE: 'cb_add_more',
} as const;

function section(
  title: string,
  rows: { id: string; title: string; description?: string }[],
) {
  return { title, rows };
}

function taxAmount(subtotal: number): number {
  return Math.round(subtotal * config.restaurant.taxRate * 100) / 100;
}

function tableLabel(table: string | null): string {
  return table || 'not set';
}

export interface IncomingMessage {
  id?: string;
  from: string;
  text?: string;
  interactive?: {
    type: 'button_reply' | 'list_reply';
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string };
  };
}

type Send = () => Promise<SendResult[]>;

export class ConversationRouter {
  private readonly sessions: SessionStore;
  private readonly orders: OrderStore;
  private readonly adapter: WhatsAppAdapter;

  constructor(sessions: SessionStore, orders: OrderStore, adapter: WhatsAppAdapter) {
    this.sessions = sessions;
    this.orders = orders;
    this.adapter = adapter;
  }

  /* ------------------------------------------------------------------ */
  /* Entry point                                                        */
  /* ------------------------------------------------------------------ */

  async handleIncoming(raw: IncomingMessage): Promise<SendResult[]> {
    const session = this.sessions.getOrCreate(raw.from);

    // Duplicate-event protection: ignore message ids we already processed.
    if (raw.id && session.processedMessageIds.includes(raw.id)) {
      return [];
    }
    if (raw.id) {
      session.processedMessageIds.push(raw.id);
      if (session.processedMessageIds.length > 50) {
        session.processedMessageIds.shift();
      }
    }

    // Table identification from the prefilled QR message: "Table T01".
    const tableMatch = (raw.text || '').match(/\btable\s*([A-Za-z0-9#-]{2,})\b/i);
    if (tableMatch && !session.table) {
      session.table = tableMatch[1].toUpperCase();
      this.sessions.set(session);
    }

    return this.dispatch(session, raw);
  }

  private async dispatch(
    session: CustomerSession,
    raw: IncomingMessage,
  ): Promise<SendResult[]> {
    const callbackId =
      raw.interactive?.button_reply?.id ?? raw.interactive?.list_reply?.id ?? null;

    // Global navigation.
    if (callbackId === CB.MAIN_MENU) {
      session.stage = 'main_menu';
      session.selectedCategory = null;
      session.selectedOrderReference = null;
      session.pendingItemId = null;
      this.sessions.set(session);
      return this.showMainMenu(session);
    }
    if (callbackId === CB.BACK) {
      session.stage = 'menu_categories';
      session.pendingItemId = null;
      this.sessions.set(session);
      return this.showMenuCategories(session);
    }

    switch (session.stage) {
      case 'new':
        return this.welcome(session);
      case 'main_menu':
        return this.onMainMenu(session, raw, callbackId);
      case 'menu_categories':
        return this.onMenuCategories(session, callbackId);
      case 'viewing_category':
        return this.onViewingCategory(session, raw, callbackId);
      case 'ordering':
        return this.onOrdering(session, raw, callbackId);
      case 'confirming_order':
        return this.onConfirmingOrder(session, callbackId);
      case 'tracking':
        return this.onTracking(session, raw, callbackId);
      case 'billing':
        return this.onBilling(session, callbackId);
      case 'feedback_rating':
        return this.onFeedbackRating(session, callbackId);
      case 'feedback_comment':
        return this.onFeedbackComment(session, raw);
      default:
        return this.welcome(session);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Helpers: queue a send and collect its result                       */
  /* ------------------------------------------------------------------ */

  private collect(sends: Send[]): Promise<SendResult[]> {
    return Promise.all(sends.map((send) => send())).then((batches) =>
      batches.flat(),
    );
  }

  /* ------------------------------------------------------------------ */
  /* Welcome                                                            */
  /* ------------------------------------------------------------------ */

  private async welcome(session: CustomerSession): Promise<SendResult[]> {
    return this.collect([
      async () => [
        await this.adapter.sendText(
          session.phone,
          `Welcome to ${config.restaurant.name}! 🍽️\n\n` +
            `We're happy to serve you.\n` +
            `Your table: ${tableLabel(session.table)}\n\n` +
            `How can we help you today?`,
        ),
      ],
      () => this.showMainMenu(session),
    ]).then((results) => {
      session.stage = 'main_menu';
      this.sessions.set(session);
      return results;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Main menu (5 options > 3 reply-button limit → WhatsApp list)       */
  /* ------------------------------------------------------------------ */

  private async showMainMenu(session: CustomerSession): Promise<SendResult[]> {
    return [await this.adapter.sendList(
      session.phone,
      'Main menu — what would you like to do?',
      'Choose an option',
      [
        section('Main Menu', [
          { id: CB.VIEW_MENU, title: 'View Menu', description: 'Browse food categories' },
          { id: CB.PLACE_ORDER, title: 'Place Order', description: 'Order food for your table' },
          { id: CB.TRACK_ORDER, title: 'Track Order', description: 'Check your order status' },
          { id: CB.REQUEST_BILL, title: 'Request Bill', description: 'Ask for the bill' },
          { id: CB.GIVE_FEEDBACK, title: 'Give Feedback', description: 'Rate your experience' },
        ]),
      ],
    )];
  }

  private async onMainMenu(
    session: CustomerSession,
    raw: IncomingMessage,
    callbackId: string | null,
  ): Promise<SendResult[]> {
    if (callbackId) {
      switch (callbackId) {
        case CB.VIEW_MENU:
          session.stage = 'menu_categories';
          this.sessions.set(session);
          return this.showMenuCategories(session);
        case CB.PLACE_ORDER:
          if (session.cart.length > 0) {
            return this.showCart(session);
          }
          session.stage = 'menu_categories';
          this.sessions.set(session);
          return this.showMenuCategories(session);
        case CB.TRACK_ORDER:
          session.stage = 'tracking';
          this.sessions.set(session);
          return this.showOrdersForTracking(session);
        case CB.REQUEST_BILL:
          return this.startBilling(session);
        case CB.GIVE_FEEDBACK:
          session.stage = 'feedback_rating';
          this.sessions.set(session);
          return this.askFeedbackRating(session);
        default:
          return this.unknown(session);
      }
    }

    // Free text at the main menu: understand simple keywords.
    const text = (raw.text || '').toLowerCase();
    if (text.includes('menu') || text.includes('1')) {
      session.stage = 'menu_categories';
      this.sessions.set(session);
      return this.showMenuCategories(session);
    }
    if (text.includes('order') || text.includes('2')) {
      if (session.cart.length > 0) return this.showCart(session);
      session.stage = 'menu_categories';
      this.sessions.set(session);
      return this.showMenuCategories(session);
    }
    if (text.includes('track') || text.includes('3')) {
      session.stage = 'tracking';
      this.sessions.set(session);
      return this.showOrdersForTracking(session);
    }
    if (text.includes('bill') || text.includes('4')) {
      return this.startBilling(session);
    }
    if (text.includes('feedback') || text.includes('5')) {
      session.stage = 'feedback_rating';
      this.sessions.set(session);
      return this.askFeedbackRating(session);
    }

    const results: SendResult[] = [];
    results.push(
      await this.adapter.sendText(
        session.phone,
        "I'm not sure I understood. Please pick an option from the menu below 👇",
      ),
    );
    results.push(...(await this.showMainMenu(session)));
    return results;
  }

  /* ------------------------------------------------------------------ */
  /* View Menu                                                          */
  /* ------------------------------------------------------------------ */

  private async showMenuCategories(session: CustomerSession): Promise<SendResult[]> {
    const rows = MENU.map((category) => ({
      id: `cat_${category.id}`,
      title: category.name,
      description: `${category.items.length} items`,
    }));
    return [await this.adapter.sendList(
      session.phone,
      'Our menu categories — pick one to browse:',
      'Browse categories',
      [section('Menu Categories', rows)],
    )];
  }

  private async onMenuCategories(
    session: CustomerSession,
    callbackId: string | null,
  ): Promise<SendResult[]> {
    if (!callbackId || !callbackId.startsWith('cat_')) {
      return this.unknown(session);
    }
    const categoryId = callbackId.slice(4);
    const category = categoryById(categoryId);
    if (!category) return this.unknown(session);

    session.selectedCategory = categoryId;
    session.stage = 'viewing_category';
    this.sessions.set(session);
    return this.showCategoryItems(session, category);
  }

  private async showCategoryItems(
    session: CustomerSession,
    category: MenuCategory,
  ): Promise<SendResult[]> {
    const availableItems = category.items.filter((i) => i.available);
    if (availableItems.length === 0) {
      const results: SendResult[] = [];
      results.push(
        await this.adapter.sendText(
          session.phone,
          `Sorry, everything in ${category.name} is currently unavailable.`,
        ),
      );
      results.push(...(await this.showMainMenu(session)));
      return results;
    }

    const rows = availableItems.map((item) => ({
      id: `add_${item.id}`,
      title: item.name.slice(0, 24),
      description: `${formatPrice(item.price)} · ${itemTypeLabel(item)}`,
    }));
    rows.push({ id: CB.BACK, title: '← Back to categories', description: '' });
    rows.push({
      id: CB.CART,
      title: '🛒 View cart',
      description: `${cartItemCount(session.cart)} item(s)`,
    });

    return [await this.adapter.sendList(
      session.phone,
      `${category.name} — tap an item to add it:`,
      'Add to cart',
      [section(category.name, rows)],
    )];
  }

  private async onViewingCategory(
    session: CustomerSession,
    raw: IncomingMessage,
    callbackId: string | null,
  ): Promise<SendResult[]> {
    if (callbackId === CB.BACK) {
      session.stage = 'menu_categories';
      session.pendingItemId = null;
      this.sessions.set(session);
      return this.showMenuCategories(session);
    }
    if (callbackId === CB.CART) {
      session.pendingItemId = null;
      return this.showCart(session);
    }
    if (callbackId && callbackId.startsWith('add_')) {
      const itemId = callbackId.slice(4);
      const item = findItem(itemId);
      if (!item) return this.unknown(session);
      if (!item.available) {
        const results: SendResult[] = [];
        results.push(
          await this.adapter.sendText(
            session.phone,
            `Sorry, ${item.name} is currently unavailable.`,
          ),
        );
        const category = session.selectedCategory
          ? categoryById(session.selectedCategory)
          : undefined;
        if (category) {
          results.push(...(await this.showCategoryItems(session, category)));
        } else {
          results.push(...(await this.showMainMenu(session)));
        }
        return results;
      }

      // Ask for quantity before adding (WhatsApp list, up to 5 options).
      session.pendingItemId = itemId;
      this.sessions.set(session);

      const rows = [1, 2, 3, 4, 5].map((n) => ({
        id: `qty_${item.id}_${n}`,
        title: `${n} ${n === 1 ? 'item' : 'items'}`,
        description: formatPrice(item.price * n),
      }));
      rows.push({ id: CB.BACK, title: '← Back', description: '' });

      return [await this.adapter.sendList(
        session.phone,
        `How many ${item.name} would you like?`,
        'Choose quantity',
        [section('Quantity', rows)],
      )];
    }
    if (callbackId && callbackId.startsWith('qty_')) {
      const match = callbackId.match(/^qty_(.+)_(\d+)$/);
      if (!match) return this.unknown(session);
      const itemId = match[1];
      const qty = Number(match[2]);
      const item = findItem(itemId);
      if (!item) return this.unknown(session);

      session.cart = addToCart(session.cart, item, qty);
      session.pendingItemId = null;
      session.stage = 'ordering';
      if (!session.idempotencyKey) {
        session.idempotencyKey = `cart:${session.phone}:${Date.now()}`;
      }
      this.sessions.set(session);

      const results: SendResult[] = [];
      results.push(
        await this.adapter.sendText(
          session.phone,
          `✅ Added ${qty} × ${item.name} (${formatPrice(item.price * qty)}) to your cart.`,
        ),
      );
      results.push(...(await this.orderingOptions(session)));
      return results;
    }

    // Free text while browsing: keywords.
    const text = (raw.text || '').toLowerCase();
    if (text.includes('cart') || text.includes('checkout')) {
      session.pendingItemId = null;
      return this.showCart(session);
    }
    if (text.includes('back') || text.includes('menu') || text.includes('categories')) {
      session.stage = 'menu_categories';
      session.pendingItemId = null;
      this.sessions.set(session);
      return this.showMenuCategories(session);
    }
    return this.unknown(session);
  }

  /* ------------------------------------------------------------------ */
  /* Place Order                                                        */
  /* ------------------------------------------------------------------ */

  private async orderingOptions(session: CustomerSession): Promise<SendResult[]> {
    const rows = [
      { id: CB.ADD_MORE, title: 'Add more items', description: 'Browse the menu again' },
      { id: CB.CART, title: '🛒 View cart', description: `${cartItemCount(session.cart)} item(s)` },
      { id: CB.CHECKOUT, title: 'Proceed to checkout', description: `Total ₹${cartSubtotal(session.cart).toFixed(0)}` },
    ];
    return [await this.adapter.sendList(
      session.phone,
      'What would you like to do next?',
      'Choose an option',
      [section('Your order', rows)],
    )];
  }

  private async onOrdering(
    session: CustomerSession,
    raw: IncomingMessage,
    callbackId: string | null,
  ): Promise<SendResult[]> {
    if (callbackId === CB.ADD_MORE) {
      session.stage = 'menu_categories';
      this.sessions.set(session);
      return this.showMenuCategories(session);
    }
    if (callbackId === CB.CART) return this.showCart(session);
    if (callbackId === CB.CHECKOUT) {
      session.stage = 'confirming_order';
      this.sessions.set(session);
      return this.showConfirmScreen(session);
    }
    if (callbackId === CB.CLEAR_CART) {
      session.cart = emptyCart();
      session.idempotencyKey = null;
      session.confirmationKey = null;
      this.sessions.set(session);
      const results: SendResult[] = [];
      results.push(await this.adapter.sendText(session.phone, '𛀙 Cart cleared.'));
      results.push(...(await this.showMainMenu(session)));
      return results;
    }
    const text = (raw.text || '').toLowerCase();
    if (text.includes('cart') || text.includes('checkout')) {
      return this.showCart(session);
    }
    if (text.includes('menu') || text.includes('add more')) {
      session.stage = 'menu_categories';
      this.sessions.set(session);
      return this.showMenuCategories(session);
    }
    return this.unknown(session);
  }

  private async showCart(session: CustomerSession): Promise<SendResult[]> {
    const results: SendResult[] = [];
    results.push(
      await this.adapter.sendText(
        session.phone,
        cartSummaryText(session.cart, tableLabel(session.table)),
      ),
    );
    if (session.cart.length > 0) {
      results.push(
        await this.adapter.sendReplyButtons(session.phone, 'What next?', [
          { id: CB.CHECKOUT, title: 'Checkout' },
          { id: CB.ADD_MORE, title: 'Add more' },
          { id: CB.CLEAR_CART, title: 'Clear cart' },
        ]),
      );
    } else {
      results.push(...(await this.showMainMenu(session)));
    }
    return results;
  }

  private async showConfirmScreen(session: CustomerSession): Promise<SendResult[]> {
    const subtotal = cartSubtotal(session.cart);
    const tax = taxAmount(subtotal);
    const total = subtotal + tax;
    const results: SendResult[] = [];
    results.push(
      await this.adapter.sendText(
        session.phone,
        `Please confirm your order:\n\n` +
          `${session.cart.map((e) => `${e.qty} × ${e.name}`).join('\n')}\n\n` +
          `Subtotal: ₹${subtotal.toFixed(0)}\n` +
          `Tax (${(config.restaurant.taxRate * 100).toFixed(0)}%): ₹${tax.toFixed(0)}\n` +
          `Total: ₹${total.toFixed(0)}\n` +
          `Table: ${tableLabel(session.table)}\n`,
      ),
    );
    results.push(
      await this.adapter.sendReplyButtons(session.phone, 'Confirm your order:', [
        { id: CB.CONFIRM_ORDER, title: 'Confirm Order' },
        { id: CB.EDIT_ORDER, title: 'Edit Order' },
        { id: CB.CANCEL_ORDER, title: 'Cancel' },
      ]),
    );
    return results;
  }

  private async onConfirmingOrder(
    session: CustomerSession,
    callbackId: string | null,
  ): Promise<SendResult[]> {
    if (callbackId === CB.EDIT_ORDER) {
      session.stage = 'ordering';
      this.sessions.set(session);
      return this.showCart(session);
    }
    if (callbackId === CB.CANCEL_ORDER) {
      session.cart = emptyCart();
      session.confirmationKey = null;
      session.idempotencyKey = null;
      session.stage = 'main_menu';
      this.sessions.set(session);
      const results: SendResult[] = [];
      results.push(
        await this.adapter.sendText(
          session.phone,
          '❌ Order cancelled. Your cart is empty.',
        ),
      );
      results.push(...(await this.showMainMenu(session)));
      return results;
    }
    if (callbackId === CB.CONFIRM_ORDER) {
      return this.submitOrder(session);
    }
    return this.unknown(session);
  }

  private async submitOrder(session: CustomerSession): Promise<SendResult[]> {
    if (session.cart.length === 0) {
      const results: SendResult[] = [];
      results.push(
        await this.adapter.sendText(
          session.phone,
          'Your cart is empty — nothing to confirm.',
        ),
      );
      results.push(...(await this.showMainMenu(session)));
      return results;
    }

    const table = session.table || 'unknown';
    const subtotal = cartSubtotal(session.cart);
    const tax = taxAmount(subtotal);
    const total = subtotal + tax;

    // Idempotency key: created once per cart session. Repeated "Confirm Order"
    // taps or duplicate webhook events therefore do not create duplicate orders.
    const idempotencyKey = session.idempotencyKey || `order:${session.phone}:${Date.now()}`;
    session.confirmationKey = idempotencyKey;
    this.sessions.set(session);

    const order = this.orders.createOrder(
      session.phone,
      table,
      session.cart,
      subtotal,
      tax,
      total,
      idempotencyKey,
    );

    const results: SendResult[] = [];
    if (!order) {
      // Duplicate submission: order was already created for this cart/session.
      const recent = this.findRecentOrderReference(session.phone);
      results.push(
        await this.adapter.sendText(
          session.phone,
          `⚠️ This order was already received.\n` +
            `Reference: ${recent ?? '—'}\n` +
            `Table: ${table}\n` +
            `Status: ${this.statusLabel('received')}`,
        ),
      );
      results.push(...(await this.showMainMenu(session)));
      return results;
    }

    session.cart = emptyCart();
    session.confirmationKey = null;
    session.idempotencyKey = null;
    session.stage = 'main_menu';
    this.sessions.set(session);

    results.push(
      await this.adapter.sendText(
        session.phone,
        `✅ Order received!\n` +
          `Reference: ${order.reference}\n` +
          `Table: ${order.table}\n` +
          `Status: ${this.statusLabel(order.status)}\n` +
          `Total: ₹${order.total.toFixed(0)}\n\n` +
          `We'll update you here as the restaurant prepares your order.`,
      ),
    );
    results.push(...(await this.showMainMenu(session)));
    return results;
  }

  private findRecentOrderReference(phone: string): string | null {
    const orders = this.orders.activeByPhone(phone);
    if (orders.length === 0) return null;
    orders.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return orders[0].reference;
  }

  /* ------------------------------------------------------------------ */
  /* Track Order                                                        */
  /* ------------------------------------------------------------------ */

  private async showOrdersForTracking(session: CustomerSession): Promise<SendResult[]> {
    const orders = this.orders.activeByPhone(session.phone);
    if (orders.length === 0) {
      const results: SendResult[] = [];
      results.push(await this.adapter.sendText(session.phone, 'You have no active orders.'));
      results.push(...(await this.showMainMenu(session)));
      return results;
    }

    if (orders.length === 1) {
      session.selectedOrderReference = orders[0].reference;
      session.stage = 'main_menu';
      this.sessions.set(session);
      return this.showOrderStatus(session, orders[0]);
    }

    const rows = orders.map((o) => ({
      id: `order_${o.reference}`,
      title: o.reference,
      description: `${formatPrice(o.total)} · ${this.statusLabel(o.status)}`,
    }));
    rows.push({ id: CB.MAIN_MENU, title: '← Main menu', description: '' });
    return [await this.adapter.sendList(
      session.phone,
      'You have multiple active orders — select one to track:',
      'Select order',
      [section('Your orders', rows)],
    )];
  }

  private async onTracking(
    session: CustomerSession,
    raw: IncomingMessage,
    callbackId: string | null,
  ): Promise<SendResult[]> {
    if (callbackId && callbackId.startsWith('order_')) {
      const reference = callbackId.slice(6);
      const order = this.orders.get(reference);
      if (!order || order.phone !== session.phone) {
        return this.unknown(session);
      }
      session.selectedOrderReference = reference;
      session.stage = 'main_menu';
      this.sessions.set(session);
      return this.showOrderStatus(session, order);
    }
    if (callbackId === CB.MAIN_MENU) {
      session.stage = 'main_menu';
      this.sessions.set(session);
      return this.showMainMenu(session);
    }
    const text = (raw.text || '').toLowerCase();
    if (text.includes('menu') || text.includes('main')) {
      session.stage = 'main_menu';
      this.sessions.set(session);
      return this.showMainMenu(session);
    }
    return this.showOrdersForTracking(session);
  }

  private async showOrderStatus(
    session: CustomerSession,
    order: { reference: string; table: string; total: number; status: string; createdAt: string },
  ): Promise<SendResult[]> {
    return this.collect([
      async () => [
        await this.adapter.sendText(
          session.phone,
          `Order ${order.reference}\n` +
            `Table: ${order.table}\n` +
            `Status: ${this.statusLabel(order.status)}\n` +
            `Total: ₹${order.total.toFixed(0)}\n\n` +
            `Tap "Track Order" again for the latest status.`,
        ),
      ],
      () => this.showMainMenu(session),
    ]);
  }

  /* ------------------------------------------------------------------ */
  /* Request Bill                                                       */
  /* ------------------------------------------------------------------ */

  private async startBilling(session: CustomerSession): Promise<SendResult[]> {
    const orders = this.orders.activeByPhone(session.phone);
    if (orders.length === 0) {
      const results: SendResult[] = [];
      results.push(await this.adapter.sendText(session.phone, 'You have no active orders to bill.'));
      results.push(...(await this.showMainMenu(session)));
      return results;
    }

    if (orders.length === 1) {
      session.selectedOrderReference = orders[0].reference;
      session.stage = 'main_menu';
      this.sessions.set(session);
      return this.showBill(session, orders[0]);
    }

    const rows = orders.map((o) => ({
      id: `order_${o.reference}`,
      title: o.reference,
      description: `${formatPrice(o.total)} · ${this.statusLabel(o.status)}`,
    }));
    rows.push({ id: CB.MAIN_MENU, title: '← Main menu', description: '' });
    session.stage = 'billing';
    this.sessions.set(session);
    return [await this.adapter.sendList(
      session.phone,
      'Select the order you want the bill for:',
      'Select order',
      [section('Active orders', rows)],
    )];
  }

  private async onBilling(
    session: CustomerSession,
    callbackId: string | null,
  ): Promise<SendResult[]> {
    if (callbackId && callbackId.startsWith('order_')) {
      const reference = callbackId.slice(6);
      const order = this.orders.get(reference);
      if (!order || order.phone !== session.phone) return this.unknown(session);
      session.selectedOrderReference = reference;
      session.stage = 'main_menu';
      this.sessions.set(session);
      return this.showBill(session, order);
    }
    if (callbackId === CB.MAIN_MENU) {
      session.stage = 'main_menu';
      this.sessions.set(session);
      return this.showMainMenu(session);
    }
    return this.showOrdersForTracking(session);
  }

  private async showBill(
    session: CustomerSession,
    order: {
      items: { qty: number; name: string; price: number }[];
      subtotal: number;
      tax: number;
      total: number;
      table: string;
      reference: string;
    },
  ): Promise<SendResult[]> {
    // Notify staff: record the bill request (staff workflow sees it via backend).
    this.orders.addBillRequest(session.phone, order.table, order.reference);

    return this.collect([
      async () => [
        await this.adapter.sendText(
          session.phone,
          `🧾 Bill — Table ${order.table} (${order.reference})\n\n` +
            `${order.items
              .map((e) => `${e.qty} × ${e.name} — ₹${(e.price * e.qty).toFixed(0)}`)
              .join('\n')}\n\n` +
            `Subtotal: ₹${order.subtotal.toFixed(0)}\n` +
            `Tax (${(config.restaurant.taxRate * 100).toFixed(0)}%): ₹${order.tax.toFixed(0)}\n` +
            `Total amount: ₹${order.total.toFixed(0)}\n\n` +
            `We've notified the restaurant staff. They'll bring the bill to your table.\n` +
            `Payment is settled at the table — no payment link is provided here.`,
        ),
      ],
      () => this.showMainMenu(session),
    ]);
  }

  /* ------------------------------------------------------------------ */
  /* Customer Feedback                                                  */
  /* ------------------------------------------------------------------ */

  private async askFeedbackRating(session: CustomerSession): Promise<SendResult[]> {
    const rows = [1, 2, 3, 4, 5].map((n) => ({
      id: `feedback_${n}`,
      title: `${n} star${n === 1 ? '' : 's'}`,
      description: n === 1 ? 'Poor' : n === 5 ? 'Excellent' : '',
    }));
    return [await this.adapter.sendList(
      session.phone,
      'How would you rate your experience? (1–5)',
      'Rate us',
      [section('Rating', rows)],
    )];
  }

  private async onFeedbackRating(
    session: CustomerSession,
    callbackId: string | null,
  ): Promise<SendResult[]> {
    if (!callbackId || !callbackId.startsWith('feedback_')) {
      return this.unknown(session);
    }
    const rating = Number(callbackId.slice('feedback_'.length));
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return this.unknown(session);

    session.feedbackRating = rating;
    session.feedbackAwaitingComment = true;
    session.stage = 'feedback_comment';
    this.sessions.set(session);

    return [
      await this.adapter.sendText(
        session.phone,
        `Thanks for rating us ${rating}/5! Any comments? (Send "skip" if you'd rather not.)`,
      ),
    ];
  }

  private async onFeedbackComment(
    session: CustomerSession,
    raw: IncomingMessage,
  ): Promise<SendResult[]> {
    const text = (raw.text || '').trim();
    let comment: string | null = null;
    if (text.toLowerCase() !== 'skip' && text.length > 0) {
      comment = text;
    }

    const rating = session.feedbackRating ?? 0;
    this.orders.addFeedback(session.phone, session.table, rating, comment);
    session.feedbackRating = null;
    session.feedbackAwaitingComment = false;
    session.stage = 'main_menu';
    this.sessions.set(session);

    const results: SendResult[] = [];
    results.push(
      await this.adapter.sendText(
        session.phone,
        'Thank you for your feedback! 🙏 We hope to serve you again.',
      ),
    );
    results.push(...(await this.showMainMenu(session)));
    return results;
  }

  /* ------------------------------------------------------------------ */
  /* Helpers                                                            */
  /* ------------------------------------------------------------------ */

  private statusLabel(status: string): string {
    const labels: Record<string, string> = {
      received: 'Order received',
      confirmed: 'Confirmed by restaurant',
      preparing: 'Preparing',
      ready: 'Ready to serve',
      served: 'Served',
      cancelled: 'Cancelled',
    };
    return labels[status] || status;
  }

  private async unknown(session: CustomerSession): Promise<SendResult[]> {
    const results: SendResult[] = [];
    results.push(
      await this.adapter.sendText(
        session.phone,
        "I didn't quite understand that. Please choose an option from the menu:",
      ),
    );
    results.push(...(await this.showMainMenu(session)));
    return results;
  }
}
