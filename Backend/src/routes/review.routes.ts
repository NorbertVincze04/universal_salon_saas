import { Router } from "express";
import { ReviewController } from "../controllers/ReviewController.ts";
import { tenantMiddleware } from "../middleware/tenant.middleware.ts";
import { publicWriteRateLimiter } from "../middleware/rateLimit.middleware.ts";

export const reviewRouter = Router();
reviewRouter.use(tenantMiddleware);
reviewRouter.get("/", (req, res) => ReviewController.list(req, res));
reviewRouter.post("/", publicWriteRateLimiter, (req, res) =>
  ReviewController.create(req, res),
);
