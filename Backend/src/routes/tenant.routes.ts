import { Router } from "express";
import { tenantMiddleware } from "../middleware/tenant.middleware.ts";
import { authMiddleware } from "../middleware/auth.middleware.ts";
import { ShopRepository } from "../repositories/ShopRepository.ts";
import { hasRole } from "../types/user.types.ts";

export const tenantRouter = Router();

const MAX_CONTENT_JSON_LENGTH = 4_000_000;

function normalizeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length && trimmed.length <= maxLength ? trimmed : null;
}

tenantRouter.get("/config", tenantMiddleware, (req, res) => {
  const shop = req.shop!;

  res.json({
    success: true,
    payload: {
      ...shop.config,
      tenantId: shop.slug,
      name: shop.config.name ?? shop.name,
    },
  });
});

tenantRouter.patch(
  "/content",
  tenantMiddleware,
  authMiddleware,
  async (req, res) => {
    if (!hasRole(req.user!, "ADMIN")) {
      return res.status(403).json({
        success: false,
        message: "Only admins can update salon content.",
      });
    }

    const body = req.body || {};
    const sections: Record<string, unknown> = {};
    for (const section of [
      "heroSection",
      "aboutUs",
      "contactDetails",
      "pricing",
    ]) {
      if (
        body[section] &&
        typeof body[section] === "object" &&
        !Array.isArray(body[section])
      ) {
        sections[section] = body[section];
      }
    }

    // Hero images may be embedded as data URLs, so allow a generous but bounded size.
    if (JSON.stringify(sections).length > MAX_CONTENT_JSON_LENGTH) {
      return res.status(413).json({
        success: false,
        message: "Salon content is too large.",
      });
    }

    const config = await ShopRepository.updateContent(req.shop!.id, sections);
    return res.json({
      success: true,
      payload: {
        ...config,
        tenantId: req.shop!.slug,
        name: config.name ?? req.shop!.name,
      },
    });
  },
);

tenantRouter.patch(
  "/pricing",
  tenantMiddleware,
  authMiddleware,
  async (req, res) => {
    if (!hasRole(req.user!, "ADMIN")) {
      return res.status(403).json({
        success: false,
        message: "Only admins can update home page services.",
      });
    }

    const plans = Array.isArray(req.body?.plans) ? req.body.plans : [];
    if (plans.length > 6) {
      return res.status(400).json({
        success: false,
        message: "You can show up to 6 home page services.",
      });
    }

    const normalizedPlans = plans.map((plan: Record<string, unknown>) => {
      const name = normalizeText(plan.name, 120);
      const price = normalizeText(plan.price, 60);
      const description = normalizeText(plan.description, 300);
      const ctaText = normalizeText(plan.ctaText, 80);
      const ctaLink = normalizeText(plan.ctaLink, 300);
      const features = Array.isArray(plan.features)
        ? plan.features
            .map((feature) => normalizeText(feature, 140))
            .filter((feature): feature is string => !!feature)
            .slice(0, 8)
        : [];
      return {
        name,
        price,
        description,
        features,
        ctaText,
        ctaLink,
        featured: plan.featured === true,
      };
    });

    if (
      normalizedPlans.some(
        (plan: { name: string | null; price: string | null }) =>
          !plan.name || !plan.price,
      )
    ) {
      return res.status(400).json({
        success: false,
        message: "Each home page service needs a name and price.",
      });
    }

    const pricing = {
      sectionLabel:
        normalizeText(req.body?.sectionLabel, 80) || "Services & pricing",
      title:
        normalizeText(req.body?.title, 160) ||
        "Care that meets you where you are.",
      description:
        normalizeText(req.body?.description, 400) ||
        "Choose the appointment that fits your goals.",
      plans: normalizedPlans,
    };

    const config = await ShopRepository.updatePricing(req.shop!.id, pricing);
    return res.json({
      success: true,
      payload: {
        ...config,
        tenantId: req.shop!.slug,
        name: config.name ?? req.shop!.name,
      },
    });
  },
);
