const express = require("express");
const router = express.Router();

const asyncHandler = require("../../../common/asyncHandler");
const validate = require("../../../common/validate");
const cacheMiddleware = require("../../../common/cache.middleware");
const { verifyToken } = require("../../auth/middleware/authMiddleware");
const {
  siteMaterialSummaryQuerySchema,
} = require("../validators/siteReport.validator");
const { siteReportController } = require("../reports.module");

/**
 * @route   GET /api/v1/reports/site-material-summary
 * @desc    Generate summarized site wise material report
 * @access  Private (Authenticated Users)
 */
router.get(
  "/site-material-summary",
  verifyToken,
  validate(siteMaterialSummaryQuerySchema, {
    source: "query",
    withSuccess: true,
  }),
  cacheMiddleware({ ttl: 7200 }),
  asyncHandler((req, res, next) =>
    siteReportController.getSiteMaterialSummary(req, res, next),
  ),
);

module.exports = router;
