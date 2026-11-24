import { Router } from "express";
import { PLATFORM_NAME } from "./config";
import { initializeDemoBusiness } from "./service";
import {
  getActivitiesByBusiness,
  getBookingsByBusiness,
  getCallsByBusiness,
  getCustomersByBusiness,
  getWorkflowsByBusiness,
} from "./store";

export function createPlatformRouter(): Router {
  const router = Router();
  const business = initializeDemoBusiness();

  router.get("/overview", (_req, res) => {
    res.json({
      platform: PLATFORM_NAME,
      mode: business.mode,
      storage: "in-memory demo data (resets on restart)",
      business: {
        id: business.id,
        name: business.name,
        timezone: business.timezone,
        enabledModules: business.enabledModules,
      },
      counts: {
        customers: getCustomersByBusiness(business.id).length,
        bookings: getBookingsByBusiness(business.id).length,
        calls: getCallsByBusiness(business.id).length,
        workflows: getWorkflowsByBusiness(business.id).length,
        activities: getActivitiesByBusiness(business.id).length,
      },
    });
  });

  router.get("/activities", (_req, res) => {
    res.json(getActivitiesByBusiness(business.id).slice().reverse());
  });

  return router;
}
