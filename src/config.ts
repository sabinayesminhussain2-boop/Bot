import dotenv from 'dotenv';
dotenv.config();

export interface WhatsAppConfig {
  token: string;
  phoneNumberId: string;
  phoneNumber: string;
  appSecret: string;
  verifyToken: string;
  apiVersion: string;
  baseUrl(): string;
}

export interface RestaurantConfig {
  name: string;
  tables: string[];
  taxRate: number;
  currency: string;
  currencySymbol: string;
}

export interface AppConfig {
  port: number;
  demoMode: boolean;
  stateDir: string;
  stateFile: string;
  whatsapp: WhatsAppConfig;
  restaurant: RestaurantConfig;
  isVercel: boolean;
}

function parseTables(raw: string | undefined): string[] {
  if (!raw) return ['T01', 'T02', 'T03'];
  return raw.split(',').map((t) => t.trim()).filter(Boolean);
}

export const config: AppConfig = {
  port: Number(process.env.PORT) || 3000,
  demoMode: process.env.DEMO_MODE !== 'false',
  stateDir: process.env.STATE_DIR || './data',
  stateFile: process.env.STATE_FILE || './data/sessions.json',
  isVercel: process.env.VERCEL === '1',
  whatsapp: {
    token: process.env.WHATSAPP_TOKEN || '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    phoneNumber: process.env.WHATSAPP_PHONE_NUMBER || '',
    appSecret: process.env.WHATSAPP_APP_SECRET || '',
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || 'veyora_webhook_verify',
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v22.0',
    baseUrl(): string {
      return `https://graph.facebook.com/${this.apiVersion}`;
    },
  },
  restaurant: {
    name: process.env.RESTAURANT_NAME || 'VEYORA Demo Restaurant',
    tables: parseTables(process.env.TABLES),
    taxRate: Number(process.env.TAX_RATE) || 0.05,
    currency: process.env.CURRENCY || 'INR',
    currencySymbol: process.env.CURRENCY_SYMBOL || '₹',
  },
};

export function credentialStatus(): { configured: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!config.whatsapp.token) missing.push('WHATSAPP_TOKEN');
  if (!config.whatsapp.phoneNumberId) missing.push('WHATSAPP_PHONE_NUMBER_ID');
  if (!config.whatsapp.phoneNumber) missing.push('WHATSAPP_PHONE_NUMBER');
  return { configured: missing.length === 0, missing };
}

export function hasRealCredentials(): boolean {
  return credentialStatus().configured;
}
