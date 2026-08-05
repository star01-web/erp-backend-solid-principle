const express = require("express");
const router = express.Router();

const asyncHandler = require("../../../common/asyncHandler");
const validate = require("../../../common/validate");
const {
  verifyToken,
  authorizeRoles,
} = require("../../auth/middleware/authMiddleware");
const { createSiteSchema } = require("../validators/inventory.validator");

// Controller instance comes from the composition root (repo -> service ->
// controller already wired with its dependencies via Dependency Injection).
const { siteController } = require("../inventory.module");

// Write-guard: site master data mutations are limited to management roles,
// same policy as the dispatch ledger routes.
const canManageInventory = authorizeRoles(
  "ADMIN",
  "INVENTORY_MANAGER",
  "FACTORY_MANAGER",
);

/**
 * @route   POST /v2/api/inventory/site/create
 * @desc    Create a site in BOTH tables atomically:
 *          inventory_sites (stock anchor) + ProjectSite (HRM geofence).
 *          Either both rows commit or the whole transaction rolls back.
 */
router.post(
  "/create",
  verifyToken,
  canManageInventory,
  validate(createSiteSchema, { withSuccess: true }),
  asyncHandler((req, res, next) => siteController.createSite(req, res, next)),
);

/**
 * @route   GET /v2/api/inventory/site?active=true|false
 * @desc    List all inventory sites (optional is_active filter).
 */
router.get(
  "/",
  verifyToken,
  asyncHandler((req, res, next) => siteController.getAllSites(req, res, next)),
);

/**
 * @route   GET /v2/api/inventory/site/:id
 * @desc    Fetch one site by id.
 */
router.get(
  "/:id",
  verifyToken,
  asyncHandler((req, res, next) => siteController.getSiteById(req, res, next)),
);

/**
 * @route   PUT /v2/api/inventory/site/update/:id
 * @desc    Update inventory site details.
 */
router.put(
  "/update/:id",
  verifyToken,
  canManageInventory,
  asyncHandler((req, res, next) => siteController.updateSite(req, res, next)),
);

/**
 * @route   DELETE /v2/api/inventory/site/delete/:id
 * @desc    Soft-delete a site (paranoid model).
 */
router.delete(
  "/delete/:id",
  verifyToken,
  canManageInventory,
  asyncHandler((req, res, next) => siteController.deleteSite(req, res, next)),
);

module.exports = router;
