const express = require("express");
const router = express.Router();

const asyncHandler = require("../../../common/asyncHandler");
const validate = require("../../../common/validate");
const cacheMiddleware = require("../../../common/cache.middleware");
const { verifyToken } = require("../../auth/middleware/authMiddleware");

const {
  projectConsumptionQuerySchema,
  siteConsumptionQuerySchema,
} = require("../validators/consumptionReport.validator");

const { consumptionReportController } = require("../reports.module");

/**
 * @route GET /v2/api/inventory/reports/project-consumption
 * @desc Get Project-wise material consumption report (Opening, Received, Distributed, Returned, Consumed, Closing)
 */
router.get(
  "/project-consumption",
  verifyToken,
  validate(projectConsumptionQuerySchema, { withSuccess: true, queryOnly: true }),
  cacheMiddleware({ ttl: 7200 }),
  asyncHandler((req, res, next) =>
    consumptionReportController.getProjectConsumptionReport(req, res, next)
  )
);

/**
 * @route GET /v2/api/inventory/reports/site-consumption
 * @desc Get Site-wise material consumption report
 */
router.get(
  "/site-consumption",
  verifyToken,
  validate(siteConsumptionQuerySchema, { withSuccess: true, queryOnly: true }),
  cacheMiddleware({ ttl: 7200 }),
  asyncHandler((req, res, next) =>
    consumptionReportController.getSiteConsumptionReport(req, res, next)
  )
);

module.exports = router;
