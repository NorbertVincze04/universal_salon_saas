import express from "express";
import cors from "cors";
import morgan from "morgan";
import { CORS_ORIGINS, TRUST_PROXY } from "./config.ts";
import { authRouter } from "./routes/auth.routes.ts";
import { tenantRouter } from "./routes/tenant.routes.ts";
import { errorHandler } from "./middleware/error.middleware.ts";
import { userRouter } from "./routes/user.routes.ts";
import { appointmentRouter } from "./routes/appointment.routes.ts";
import { publicRouter } from "./routes/public.routes.ts";
import { reviewRouter } from "./routes/review.routes.ts";
import { notificationRouter } from "./routes/notification.routes.ts";
import { apiRateLimiter } from "./middleware/rateLimit.middleware.ts";
import { managementRouter } from "./routes/management.routes.ts";

export function createApp() {
  const app = express(); // create express server

  app.disable("x-powered-by");
  // Behind a reverse proxy / load balancer, trust it so rate limiting keys on
  // the real client IP instead of the proxy's. Configure via TRUST_PROXY.
  if (TRUST_PROXY !== false) {
    app.set("trust proxy", TRUST_PROXY);
  }

  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cross-Origin-Resource-Policy", "same-site");
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  app.use(
    cors({
      origin: CORS_ORIGINS,
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "X-Tenant-Slug",
        "X-Tenant-Domain",
      ],
    }),
  );

  app.use(express.json({ limit: "5mb" })); // profile images are sent as resized data URLs
  app.use(morgan("dev"));

  app.use("/api", apiRateLimiter);
  app.use("/api/auth", authRouter);
  app.use("/api/tenant", tenantRouter);
  app.use("/api/users", userRouter);
  app.use("/api/appointments", appointmentRouter);
  app.use("/api/public", publicRouter);
  app.use("/api/reviews", reviewRouter);
  app.use("/api/notifications", notificationRouter);
  app.use("/api/management", managementRouter);
  app.use(errorHandler);

  return app;
}
