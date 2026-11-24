import * as crypto from "node:crypto";
import { DEMO_BUSINESS } from "./config";
import { platformStore } from "./store";
import type {
  Activity,
  Booking,
  Business,
  Customer,
  Workflow,
} from "./types";

export function initializeDemoBusiness(): Business {
  const existing = platformStore.businesses.find(
    (business) => business.id === DEMO_BUSINESS.id
  );

  if (existing) return existing;

  const business: Business = { ...DEMO_BUSINESS };
  platformStore.businesses.push(business);

  addActivity(
    business.id,
    "system",
    "Demo business initialized"
  );

  return business;
}

export function addActivity(
  businessId: string,
  type: string,
  description: string
): Activity {
  const activity: Activity = {
    id: crypto.randomUUID(),
    businessId,
    type,
    description,
    createdAt: new Date().toISOString(),
  };

  platformStore.activities.push(activity);
  return activity;
}

export function addCustomer(
  customer: Customer
): Customer {
  platformStore.customers.push(customer);

  addActivity(
    customer.businessId,
    "customer",
    `New customer added: ${customer.name}`
  );

  return customer;
}

export function addBooking(
  booking: Booking
): Booking {
  platformStore.bookings.push(booking);

  addActivity(
    booking.businessId,
    "booking",
    `Booking created for ${booking.service}`
  );

  return booking;
}

export function addWorkflow(
  workflow: Workflow
): Workflow {
  platformStore.workflows.push(workflow);

  addActivity(
    workflow.businessId,
    "automation",
    `Workflow created: ${workflow.name}`
  );

  return workflow;
}
