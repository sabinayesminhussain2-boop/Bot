/**
 * Order, bill-request and feedback store.
 *
 * This is the in-memory "backend" used by the demo. In production your friend's
 * custom backend replaces this layer — see docs/BACKEND_SETUP.md.
 */

import fs from 'fs';
import path from 'path';
import { config } from './config';
import { CartEntry } from './cart';
import { formatPrice } from './menu';

export type OrderStatus = 'received' | 'confirmed' | 'preparing' | 'ready' | 'served' | 'cancelled';

export interface Order {
  reference: string;
  phone: string;
  table: string;
  items: CartEntry[];
  subtotal: number;
  tax: number;
  total: number;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
  idempotencyKey: string | null;
}

export interface BillRequest {
  id: string;
  phone: string;
  table: string;
  orderReference: string | null;
  requestedAt: string;
  notified: boolean;
}

export interface Feedback {
  id: string;
  phone: string;
  table: string | null;
  rating: number;
  comment: string | null;
  createdAt: string;
}

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  received: 'Order received',
  confirmed: 'Confirmed by restaurant',
  preparing: 'Preparing',
  ready: 'Ready to serve',
  served: 'Served',
  cancelled: 'Cancelled',
};

const ACTIVE_STATUSES: OrderStatus[] = ['received', 'confirmed', 'preparing', 'ready'];

function nextRef(store: OrderStore): string {
  return `ORD-${String(1000 + store.orders.size + 1)}`;
}

export class OrderStore {
  orders = new Map<string, Order>();
  ordersByPhone = new Map<string, string[]>();
  idempotencyKeys = new Map<string, string>(); // idempotency key -> order reference
  billRequests: BillRequest[] = [];
  feedback: Feedback[] = [];

  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
    this.load();
  }

  private file(name: string): string {
    return path.join(this.dir, name);
  }

  private load(): void {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const rawOrders = this.loadJson(this.file('orders.json'), new Map<string, Order>()) as unknown;
      this.orders = new Map<string, Order>();
      if (Array.isArray(rawOrders)) {
        // Backward-compatible: older saves stored orders as a plain array.
        for (const order of rawOrders) {
          this.orders.set(order.reference, order);
        }
      } else if (rawOrders && typeof rawOrders === 'object' && !(rawOrders instanceof Map)) {
        for (const [reference, order] of Object.entries(rawOrders as Record<string, Order>)) {
          this.orders.set(reference, order);
        }
      } else if (rawOrders instanceof Map) {
        for (const [reference, order] of rawOrders) {
          this.orders.set(reference, order);
        }
      }
      for (const order of this.orders.values()) {
        const refs = this.ordersByPhone.get(order.phone) || [];
        refs.push(order.reference);
        this.ordersByPhone.set(order.phone, refs);
      }
      this.billRequests = this.loadJson(this.file('bill-requests.json'), []);
      this.feedback = this.loadJson(this.file('feedback.json'), []);
    } catch (error) {
      console.warn('[orders] failed to load store:', (error as Error).message);
    }
  }

  private loadJson<T>(file: string, fallback: T): T {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  }

  private saveOrders(): void {
    try {
      fs.writeFileSync(this.file('orders.json'), JSON.stringify(Array.from(this.orders.values()), null, 2));
      fs.writeFileSync(this.file('bill-requests.json'), JSON.stringify(this.billRequests, null, 2));
      fs.writeFileSync(this.file('feedback.json'), JSON.stringify(this.feedback, null, 2));
    } catch (error) {
      console.error('[orders] failed to save store:', (error as Error).message);
    }
  }

  /**
   * Create an order. Returns null if the idempotency key was already used
   * (duplicate submission protection).
   */
  createOrder(
    phone: string,
    table: string,
    items: CartEntry[],
    subtotal: number,
    tax: number,
    total: number,
    idempotencyKey: string | null,
  ): Order | null {
    if (idempotencyKey && this.idempotencyKeys.has(idempotencyKey)) {
      return null; // duplicate submission — order already exists
    }

    const reference = nextRef(this);
    const now = new Date().toISOString();
    const order: Order = {
      reference,
      phone,
      table,
      items: items.slice(),
      subtotal,
      tax,
      total,
      status: 'received',
      createdAt: now,
      updatedAt: now,
      idempotencyKey: idempotencyKey || null,
    };

    if (idempotencyKey) this.idempotencyKeys.set(idempotencyKey, reference);
    this.orders.set(reference, order);

    const refs = this.ordersByPhone.get(phone) || [];
    refs.push(reference);
    this.ordersByPhone.set(phone, refs);

    this.saveOrders();
    return order;
  }

  updateStatus(reference: string, status: OrderStatus): Order | undefined {
    const order = this.orders.get(reference);
    if (!order) return undefined;
    order.status = status;
    order.updatedAt = new Date().toISOString();
    this.orders.set(reference, order);
    this.saveOrders();
    return order;
  }

  get(reference: string): Order | undefined {
    return this.orders.get(reference);
  }

  list(): Order[] {
    return Array.from(this.orders.values());
  }

  // Keep TypeScript happy about possible undefined from Map.get.
  private assertOrder(o: Order | undefined): o is Order {
    return Boolean(o);
  }

  /**
   * Orders visible to the customer for tracking/billing (excludes cancelled).
   */
  activeByPhone(phone: string): Order[] {
    const refs = this.ordersByPhone.get(phone) || [];
    return refs
      .map((ref) => this.orders.get(ref))
      .filter((o): o is Order => o !== undefined && o.status !== 'cancelled');
  }

  addBillRequest(phone: string, table: string, orderReference: string | null): BillRequest {
    const request: BillRequest = {
      id: `BR-${String(1000 + this.billRequests.length + 1)}`,
      phone,
      table,
      orderReference,
      requestedAt: new Date().toISOString(),
      notified: false,
    };
    this.billRequests.push(request);
    this.saveOrders();
    return request;
  }

  listBillRequests(): BillRequest[] {
    return this.billRequests.slice();
  }

  addFeedback(phone: string, table: string | null, rating: number, comment: string | null): Feedback {
    const entry: Feedback = {
      id: `FB-${String(1000 + this.feedback.length + 1)}`,
      phone,
      table,
      rating,
      comment,
      createdAt: new Date().toISOString(),
    };
    this.feedback.push(entry);
    this.saveOrders();
    return entry;
  }

  listFeedback(): Feedback[] {
    return this.feedback.slice();
  }
}

export function formatOrderSummary(order: Order): string {
  const lines = order.items.map((e) => `${e.qty} × ${e.name} — ₹${(e.price * e.qty).toFixed(0)}`);
  lines.push('', `Subtotal: ${formatPrice(order.subtotal)}`, `Tax (${(config.restaurant.taxRate * 100).toFixed(0)}%): ${formatPrice(order.tax)}`, `Total: ${formatPrice(order.total)}`, `Table: ${order.table}`);
  return lines.join('\n');
}
