
import type {
  Activity,
  Booking,
  Business,
  CallSession,
  Customer,
  Workflow,
} from "./types";

export interface PlatformStore {
  businesses: Business[];
  customers: Customer[];
  bookings: Booking[];
  calls: CallSession[];
  workflows: Workflow[];
  activities: Activity[];
}

export const platformStore: PlatformStore = {
  businesses: [],
  customers: [],
  bookings: [],
  calls: [],
  workflows: [],
  activities: [],
};

export function getBusinessById(id: string) {
  return platformStore.businesses.find(
    (business) => business.id === id
  );
}

export function getBookingsByBusiness(businessId: string) {
  return platformStore.bookings.filter(
    (booking) => booking.businessId === businessId
  );
}

export function getCustomersByBusiness(businessId: string) {
  return platformStore.customers.filter(
    (customer) => customer.businessId === businessId
  );
}

export function getCallsByBusiness(businessId: string) {
  return platformStore.calls.filter(
    (call) => call.businessId === businessId
  );
}

export function getWorkflowsByBusiness(businessId: string) {
  return platformStore.workflows.filter(
    (workflow) => workflow.businessId === businessId
  );
}

export function getActivitiesByBusiness(businessId: string) {
  return platformStore.activities.filter(
    (activity) => activity.businessId === businessId
  );
}
