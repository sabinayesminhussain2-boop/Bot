/**
 * WhatsApp messaging adapter.
 *
 * Two implementations:
 *  - RealWhatsAppAdapter: calls the WhatsApp Business Platform Cloud API (Meta).
 *  - SimulatedWhatsAppAdapter: logs every outgoing message to the console and
 *    stores it in an outbox so the demo can be verified without credentials.
 *
 * The conversation router never knows which one is in use.
 */

import crypto from 'node:crypto';

export interface ReplyButton {
  id: string;
  title: string;
}

export interface ListSection {
  title: string;
  rows: { id: string; title: string; description?: string }[];
}

export interface OutboundMessage {
  to: string;
  type: 'text' | 'buttons' | 'list';
  body?: string;
  buttons?: ReplyButton[];
  sections?: ListSection[];
  buttonText?: string;
  sentAt: string;
}

export interface SendResult {
  ok: boolean;
  error?: string;
  whatsappMessageId?: string;
}

export interface WhatsAppAdapter {
  sendText(to: string, text: string): Promise<SendResult>;
  sendReplyButtons(to: string, text: string, buttons: ReplyButton[]): Promise<SendResult>;
  sendList(to: string, text: string, buttonText: string, sections: ListSection[]): Promise<SendResult>;
  validateSignature(rawBody: Buffer, signature: string | undefined): boolean;
  getOutbox?(): OutboundMessage[];
}

const MAX_REPLY_BUTTONS = 3;
const MAX_LIST_SECTIONS = 10;

export class SimulatedWhatsAppAdapter implements WhatsAppAdapter {
  private outbox: OutboundMessage[] = [];

  async sendText(to: string, text: string): Promise<SendResult> {
    const message: OutboundMessage = { to, type: 'text', body: text, sentAt: new Date().toISOString() };
    this.outbox.push(message);
    console.log(`[SIMULATED WHATSAPP → ${to}] TEXT: ${text}`);
    return { ok: true };
  }

  async sendReplyButtons(to: string, text: string, buttons: ReplyButton[]): Promise<SendResult> {
    if (buttons.length > MAX_REPLY_BUTTONS) {
      return { ok: false, error: `WhatsApp allows at most ${MAX_REPLY_BUTTONS} reply buttons` };
    }
    const message: OutboundMessage = { to, type: 'buttons', body: text, buttons, sentAt: new Date().toISOString() };
    this.outbox.push(message);
    console.log(`[SIMULATED WHATSAPP → ${to}] BUTTONS: ${text} | ${buttons.map((b) => b.title).join(' | ')}`);
    return { ok: true };
  }

  async sendList(to: string, text: string, buttonText: string, sections: ListSection[]): Promise<SendResult> {
    if (sections.length > MAX_LIST_SECTIONS) {
      return { ok: false, error: `WhatsApp allows at most ${MAX_LIST_SECTIONS} list sections` };
    }
    const message: OutboundMessage = { to, type: 'list', body: text, sections, buttonText, sentAt: new Date().toISOString() };
    this.outbox.push(message);
    console.log(`[SIMULATED WHATSAPP → ${to}] LIST: ${text} | button: ${buttonText} | sections: ${sections.length}`);
    return { ok: true };
  }

  validateSignature(_rawBody: Buffer, _signature: string | undefined): boolean {
    // Simulation mode: no app secret configured, so signature validation is not applicable.
    return true;
  }

  getOutbox(): OutboundMessage[] {
    return this.outbox.slice();
  }

  clearOutbox(): void {
    this.outbox = [];
  }
}

export class RealWhatsAppAdapter implements WhatsAppAdapter {
  constructor(
    private readonly accessToken: string,
    private readonly phoneNumberId: string,
    private readonly appSecret: string,
    private readonly apiVersion: string,
  ) {}

  private baseUrl(): string {
    return `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;
  }

  async sendText(to: string, text: string): Promise<SendResult> {
    return this.post({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { body: text } });
  }

  async sendReplyButtons(to: string, text: string, buttons: ReplyButton[]): Promise<SendResult> {
    if (buttons.length > MAX_REPLY_BUTTONS) {
      return { ok: false, error: `WhatsApp allows at most ${MAX_REPLY_BUTTONS} reply buttons` };
    }
    return this.post({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text },
        action: { buttons: buttons.map((b) => ({ type: 'reply', reply: b })) },
      },
    });
  }

  async sendList(to: string, text: string, buttonText: string, sections: ListSection[]): Promise<SendResult> {
    if (sections.length > MAX_LIST_SECTIONS) {
      return { ok: false, error: `WhatsApp allows at most ${MAX_LIST_SECTIONS} list sections` };
    }
    return this.post({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text },
        action: { button: buttonText, sections: sections.map((s) => ({ title: s.title, rows: s.rows })) },
      },
    });
  }

  validateSignature(rawBody: Buffer, signature: string | undefined): boolean {
    if (!this.appSecret || !signature) return false;
    const expected = crypto.createHmac('sha256', this.appSecret).update(rawBody).digest('hex');
    return signature === `sha256=${expected}`;
  }

  private async post(body: unknown): Promise<SendResult> {
    try {
      const response = await fetch(this.baseUrl(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { error?: unknown } & Record<string, unknown>;
      if (!response.ok) {
        return { ok: false, error: JSON.stringify(payload.error ?? payload) };
      }
      const messages = payload.messages as { id?: string }[] | undefined;
      return { ok: true, whatsappMessageId: messages?.[0]?.id };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }
}
