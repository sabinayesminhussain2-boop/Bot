/**
 * Per-customer conversation state.
 * Keyed by WhatsApp phone number ("from" address). Optionally persisted to JSON.
 */

import fs from 'fs';
import path from 'path';

export type SessionStage =
  | 'new'
  | 'main_menu'
  | 'menu_categories'
  | 'viewing_category'
  | 'ordering'
  | 'confirming_order'
  | 'tracking'
  | 'billing'
  | 'feedback_rating'
  | 'feedback_comment'
  | 'completed';

import { CartEntry } from './cart';

export interface CustomerSession {
  phone: string;
  table: string | null;
  stage: SessionStage;
  cart: CartEntry[];
  confirmationKey: string | null;
  selectedCategory: string | null;
  selectedOrderReference: string | null;
  feedbackRating: number | null;
  feedbackAwaitingComment: boolean;
  pendingItemId: string | null;
  processedMessageIds: string[];
  idempotencyKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export function newSession(phone: string): CustomerSession {
  const now = new Date().toISOString();
  return {
    phone,
    table: null,
    stage: 'new',
    cart: [],
    confirmationKey: null,
    selectedCategory: null,
    selectedOrderReference: null,
  feedbackRating: null,
  feedbackAwaitingComment: false,
  pendingItemId: null,
  processedMessageIds: [],
    idempotencyKey: null,
    createdAt: now,
    updatedAt: now,
  };
}

export class SessionStore {
  private sessions = new Map<string, CustomerSession>();
  private readonly file: string;
  private readonly enabled: boolean;

  constructor(file: string, enabled: boolean) {
    this.file = file;
    this.enabled = enabled;
    if (enabled) this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.file)) {
        const data = JSON.parse(fs.readFileSync(this.file, 'utf8')) as CustomerSession[];
        for (const s of data) this.sessions.set(s.phone, s);
      }
    } catch (error) {
      console.warn('[state] failed to load session store:', (error as Error).message);
    }
  }

  private save(): void {
    if (!this.enabled) return;
    try {
      const dir = path.dirname(this.file);
      if (dir) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(Array.from(this.sessions.values()), null, 2));
    } catch (error) {
      console.error('[state] failed to save session store:', (error as Error).message);
    }
  }

  get(phone: string): CustomerSession | undefined {
    return this.sessions.get(phone);
  }

  getOrCreate(phone: string): CustomerSession {
    const existing = this.sessions.get(phone);
    if (existing) return existing;
    const session = newSession(phone);
    this.sessions.set(phone, session);
    this.save();
    return session;
  }

  set(session: CustomerSession): void {
    session.updatedAt = new Date().toISOString();
    this.sessions.set(session.phone, session);
    this.save();
  }

  all(): CustomerSession[] {
    return Array.from(this.sessions.values());
  }
}
