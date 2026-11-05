import { Router } from "express";
import { PublicController } from "../controllers/PublicController.ts";
import { BarberRatingController } from "../controllers/BarberRatingController.ts";
import { BarberGalleryController } from "../controllers/BarberGalleryController.ts";
import { BugReportController } from "../controllers/BugReportController.ts";
import { tenantMiddleware } from "../middleware/tenant.middleware.ts";
import { authMiddleware } from "../middleware/auth.middleware.ts";
import { publicWriteRateLimiter } from "../middleware/rateLimit.middleware.ts";

export const publicRouter = Router();
publicRouter.use(tenantMiddleware);
publicRouter.get("/barbers", (req, res) =>
  PublicController.listBarbers(req, res),
);
publicRouter.get("/barbers/me/gallery", authMiddleware, (req, res) =>
  BarberGalleryController.listMine(req, res),
);
publicRouter.post("/barbers/me/gallery", authMiddleware, (req, res) =>
  BarberGalleryController.createMine(req, res),
);
publicRouter.delete(
  "/barbers/me/gallery/:photoId",
  authMiddleware,
  (req, res) => BarberGalleryController.deleteMine(req, res),
);
publicRouter.get("/barbers/:barberId", (req, res) =>
  PublicController.getBarber(req, res),
);
publicRouter.get("/barbers/:barberId/gallery", (req, res) =>
  BarberGalleryController.list(req, res),
);
publicRouter.get("/barbers/:barberId/rating", (req, res) =>
  BarberRatingController.summary(req, res),
);
publicRouter.get("/barbers/me/ratings", authMiddleware, (req, res) =>
  BarberRatingController.mineReceived(req, res),
);
publicRouter.get("/barbers/:barberId/ratings", (req, res) =>
  BarberRatingController.list(req, res),
);
publicRouter.get("/barbers/:barberId/rating/mine", authMiddleware, (req, res) =>
  BarberRatingController.mine(req, res),
);
publicRouter.post("/barbers/:barberId/rating", authMiddleware, (req, res) =>
  BarberRatingController.rate(req, res),
);
publicRouter.delete("/barbers/:barberId/rating", authMiddleware, (req, res) =>
  BarberRatingController.remove(req, res),
);
publicRouter.get("/services", (req, res) =>
  PublicController.listServices(req, res),
);
publicRouter.get("/availability", (req, res) =>
  PublicController.availability(req, res),
);
publicRouter.post("/appointments", publicWriteRateLimiter, (req, res) =>
  PublicController.createGuestAppointment(req, res),
);
publicRouter.post("/appointments/account", authMiddleware, (req, res) =>
  PublicController.createAccountAppointment(req, res),
);
publicRouter.post("/bug-reports", publicWriteRateLimiter, (req, res) =>
  BugReportController.create(req, res),
);
publicRouter.get("/schedule", authMiddleware, (req, res) =>
  PublicController.getSchedule(req, res),
);
publicRouter.put("/schedule", authMiddleware, (req, res) =>
  PublicController.saveSchedule(req, res),
);
publicRouter.post("/schedule/blocked", authMiddleware, (req, res) =>
  PublicController.blockTime(req, res),
);
publicRouter.patch("/schedule/blocked/:id", authMiddleware, (req, res) =>
  PublicController.updateBlockedTime(req, res),
);
publicRouter.delete("/schedule/blocked/:id", authMiddleware, (req, res) =>
  PublicController.unblockTime(req, res),
);
publicRouter.post("/services", authMiddleware, (req, res) =>
  PublicController.createService(req, res),
);
publicRouter.patch("/services/:id", authMiddleware, (req, res) =>
  PublicController.updateService(req, res),
);
publicRouter.delete("/services/:id", authMiddleware, (req, res) =>
  PublicController.deleteService(req, res),
);
publicRouter.get("/services/mine", authMiddleware, (req, res) =>
  PublicController.listMyServices(req, res),
);
