/**
 * Shopping cart helpers — pure operations on cart line items.
 */

import { MenuItem } from './menu';

export interface CartEntry {
  itemId: string;
  name: string;
  price: number;
  qty: number;
}

export function emptyCart(): CartEntry[] {
  return [];
}

export function addToCart(cart: CartEntry[], item: MenuItem, qty: number): CartEntry[] {
  const next = cart.slice();
  const existing = next.find((entry) => entry.itemId === item.id);
  if (existing) {
    existing.qty += qty;
  } else {
    next.push({ itemId: item.id, name: item.name, price: item.price, qty });
  }
  return next;
}

export function setQty(cart: CartEntry[], itemId: string, qty: number): CartEntry[] {
  const next = cart.slice();
  const entry = next.find((e) => e.itemId === itemId);
  if (!entry) return next;
  if (qty <= 0) {
    return next.filter((e) => e.itemId !== itemId);
  }
  entry.qty = qty;
  return next;
}

export function removeFromCart(cart: CartEntry[], itemId: string): CartEntry[] {
  return cart.filter((e) => e.itemId !== itemId);
}

export function cartSubtotal(cart: CartEntry[]): number {
  return cart.reduce((sum, e) => sum + e.price * e.qty, 0);
}

export function cartItemCount(cart: CartEntry[]): number {
  return cart.reduce((sum, e) => sum + e.qty, 0);
}

export function cartSummaryText(cart: CartEntry[], table: string): string {
  if (cart.length === 0) {
    return `Your cart (Table ${table}) is empty.`;
  }
  const lines = cart.map((e) => `${e.qty} × ${e.name} — ₹${(e.price * e.qty).toFixed(0)}`);
  const subtotal = cartSubtotal(cart);
  lines.push('', `Subtotal: ₹${subtotal.toFixed(0)}`);
  return `Your cart (Table ${table}):\n${lines.join('\n')}`;
}
