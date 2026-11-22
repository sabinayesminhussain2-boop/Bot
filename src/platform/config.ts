
import type { AppMode, ModuleName } from "./types";

export const PLATFORM_NAME = "Code Builds One";

export const DEFAULT_MODE: AppMode = "demo";

export const AVAILABLE_MODULES: ModuleName[] = [
  "ai-receptionist",
  "automation",
  "bookings",
  "whatsapp",
  "analytics",
];

export const DEFAULT_TIMEZONE = "Asia/Kolkata";

export const DEMO_BUSINESS = {
  id: "demo-business-001",
  name: "Demo Business",
  email: "demo@codebuilds.local",
  timezone: DEFAULT_TIMEZONE,
  mode: DEFAULT_MODE,
  enabledModules: AVAILABLE_MODULES,
  createdAt: new Date().toISOString(),
};
