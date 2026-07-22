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
// controller already wired with its dependencies).
const { dispatchController } = require("../inventory.module");

// Same write-guard used across the inventory module: only managers/admin can
// move stock; reports stay open to any authenticated user.
const canManageInventory = authorizeRoles(
  "ADMIN",
  "INVENTORY_MANAGER",
  "FACTORY_MANAGER",
);

// ==========================================
// SITE DISPATCH LEDGER
// ==========================================

// Issue material from stock to a site (deducts stock, logs DISPATCH).
router.post(
  "/ledger/dispatch",
  verifyToken,
  canManageInventory,
  validate(dispatchLedgerSchema, { withSuccess: true }),
  asyncHandler(dispatchController.dispatchItem),
);

// Return material from a site back into stock (adds stock, logs RETURN).
router.post(
  "/ledger/return",
  verifyToken,
  canManageInventory,
  validate(dispatchLedgerSchema, { withSuccess: true }),
  asyncHandler(dispatchController.returnItem),
);

// Net consumption report per item for a given site.
router.get(
  "/ledger/consumption/:siteId",
  verifyToken,
  asyncHandler(dispatchController.getConsumptionReport),
);

module.exports = router;
