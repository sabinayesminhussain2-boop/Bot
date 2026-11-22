
export type AppMode = "demo" | "live";

export type ModuleName =
  | "ai-receptionist"
  | "automation"
  | "bookings"
  | "whatsapp"
  | "analytics";

export type CallChannel = "phone" | "browser";

export interface Business {
  id: string;
  name: string;
  email: string;
  timezone: string;
  mode: AppMode;
  enabledModules: ModuleName[];
  createdAt: string;
}

export interface Customer {
  id: string;
  businessId: string;
  name: string;
  phone?: string;
  email?: string;
  createdAt: string;
}

export interface Booking {
  id: string;
  businessId: string;
  customerId: string;
  service: string;
  startTime: string;
  endTime: string;
  status: "pending" | "confirmed" | "cancelled";
}

export interface CallSession {
  id: string;
  businessId: string;
  channel: CallChannel;
  mode: AppMode;
  callerPhone?: string;
  status: "ringing" | "active" | "completed" | "failed";
  startedAt: string;
  endedAt?: string;
}

export type WorkflowNodeType =
  | "trigger"
  | "condition"
  | "action";

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  name: string;
  config: Record<string, unknown>;
}

export interface WorkflowConnection {
  id: string;
  source: string;
  target: string;
}

export interface Workflow {
  id: string;
  businessId: string;
  name: string;
  enabled: boolean;
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
}

export interface Activity {
  id: string;
  businessId: string;
  type: string;
  description: string;
  createdAt: string;
}
