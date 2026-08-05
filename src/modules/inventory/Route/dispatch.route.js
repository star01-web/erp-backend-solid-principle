const express = require("express");
const router = express.Router();

const asyncHandler = require("../../../common/asyncHandler");
const validate = require("../../../common/validate");
const {
  verifyToken,
  authorizeRoles,
} = require("../../auth/middleware/authMiddleware");
const { dispatchLedgerSchema } = require("../validators/inventory.validator");

// Controller instance comes from the composition root (repo -> service ->
// controller already wired with its dependencies via Dependency Injection).
const { dispatchController } = require("../inventory.module");

// Write-guard middleware: strictly limits stock movement and ledger mutations
// to authorized management roles. Reports remain accessible to any authenticated user.
const canManageInventory = authorizeRoles(
  "ADMIN",
  "INVENTORY_MANAGER",
  "FACTORY_MANAGER",
);

// ==========================================
// SITE DISPATCH LEDGER & STOCK ROUTES
// ==========================================

/**
 * @route   POST /v2/api/inventory/ledger/dispatch
 * @desc    Issue material from warehouse stock to a site.
 *          Deducts warehouse stock, increases site stock, and logs a DISPATCH transaction.
 * @access  Private (Admin, Inventory Manager, Factory Manager)
 */
router.post(
  "/ledger/dispatch",
  verifyToken,
  canManageInventory,
  validate(dispatchLedgerSchema, { withSuccess: true }),
  asyncHandler((req, res, next) =>
    dispatchController.dispatchItem(req, res, next),
  ),
);

/**
 * @route   POST /v2/api/inventory/ledger/return
 * @desc    Return material from a site back into warehouse stock.
 *          Deducts site stock, increases warehouse stock, and logs a RETURN transaction.
 * @access  Private (Admin, Inventory Manager, Factory Manager)
 */
router.post(
  "/ledger/return",
  verifyToken,
  canManageInventory,
  validate(dispatchLedgerSchema, { withSuccess: true }),
  asyncHandler((req, res, next) =>
    dispatchController.returnItem(req, res, next),
  ),
);

/**
 * @route   GET /v2/api/inventory/ledger/consumption/:siteId
 * @desc    Get aggregated net consumption report (Dispatched - Returned) in Base UOM for a site.
 * @access  Private (Any Authenticated User)
 */
router.get(
  "/ledger/consumption/:siteId",
  verifyToken,
  asyncHandler((req, res, next) =>
    dispatchController.getConsumptionReport(req, res, next),
  ),
);

/**
 * @route   GET /v2/api/inventory/ledger/site-stock/:siteId
 * @desc    Site-specific stock visibility — live balances (base UOM) of every
 *          item currently held at one site (from inventory_site_stock_levels).
 * @access  Private (Any Authenticated User)
 */
router.get(
  "/ledger/site-stock/:siteId",
  verifyToken,
  asyncHandler((req, res, next) =>
    dispatchController.getSiteStock(req, res, next),
  ),
);

/**
 * @route   GET /v2/api/inventory/ledger/history
 * @desc    Fetch dispatch/return history logs with populated site_name and item_name.
 *          Optional query params: site_id, item_id, transaction_type ('DISPATCH' | 'RETURN')
 * @access  Private (Any Authenticated User)
 */
router.get(
  "/ledger/history",
  verifyToken,
  asyncHandler((req, res, next) =>
    dispatchController.getDispatchLogs(req, res, next),
  ),
);

module.exports = router;
