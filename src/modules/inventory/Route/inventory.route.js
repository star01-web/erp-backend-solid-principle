const express = require("express");
const router = express.Router();

// Controllers Import
const invCtrl = require("../inventory_controller/inventory.controller");
const prodCtrl = require("../inventory_controller/product.controller");
const whCtrl = require("../inventory_controller/warehouse.controller");
const partnerCtrl = require("../inventory_controller/Partner");

// Middleware Import
const {
  verifyToken,
  authorizeRoles,
} = require("../../auth/middleware/authMiddleware");
const validate = require("../../../common/validate");
const {
  createProductSchema,
  bulkCreateProductsSchema,
  createWarehouseSchema,
  createPartnerSchema,
  createMovementSchema,
  bulkMovementSchema,
} = require("../validators/inventory.validator");

/**
 * asyncHandler: Try-catch ke jhanjhat se bachne ke liye
 * (Agar controller mein koi error aayegi, toh ye use next() tak pahuncha dega)
 */
const asyncHandler = (fn) => (req, res, next) => {
  if (typeof fn !== "function") {
    console.error(
      "CRITICAL: Route handler is undefined. Check your controller exports!",
    );
  }
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Roles allowed to mutate inventory data. Reads stay open to any authenticated
 * user; writes (stock movements, product/warehouse/partner CRUD) are limited to
 * inventory/factory managers and admins.
 */
const canManageInventory = authorizeRoles(
  "ADMIN",
  "INVENTORY_MANAGER",
  "FACTORY_MANAGER",
);

// ==========================================
// 1. STOCK MOVEMENT & DASHBOARD (Protected)
// ==========================================
router.post(
  "/movement",
  verifyToken,
  canManageInventory,
  validate(createMovementSchema, { withSuccess: true }),
  asyncHandler(invCtrl.processStockMovement),
);
router.put(
  "/movement/:id",
  verifyToken,
  canManageInventory,
  asyncHandler(invCtrl.updateStockMovement),
);

router.post(
  "/bulkmovement",
  verifyToken,
  canManageInventory,
  validate(bulkMovementSchema, { withSuccess: true }),
  asyncHandler(invCtrl.bulkProcessStockMovement),
);
router.get(
  "/alltransactions",
  verifyToken,
  asyncHandler(invCtrl.getTransactionHistory),
);

router.get(
  "/dashboard",
  verifyToken,
  asyncHandler(invCtrl.getInventoryDashboard),
);

// ==========================================
// 2. PRODUCT MANAGEMENT
// ==========================================
router.post(
  "/products",
  verifyToken,
  canManageInventory,
  validate(createProductSchema, { withSuccess: true }),
  asyncHandler(prodCtrl.createProduct),
);
router.get("/products", verifyToken, asyncHandler(prodCtrl.getAllProducts));
router.put(
  "/products/:id",
  verifyToken,
  canManageInventory,
  asyncHandler(prodCtrl.updateProduct),
);
router.post(
  "/bulkproducts",
  verifyToken,
  canManageInventory,
  validate(bulkCreateProductsSchema, { withSuccess: true }),
  asyncHandler(prodCtrl.bulkCreateProducts),
);
// Industrial alternative for delete
router.patch(
  "/products/:id/toggle-status",
  verifyToken,
  canManageInventory,
  asyncHandler(prodCtrl.toggleProductStatus),
);

// ==========================================
// 3. WAREHOUSE MANAGEMENT
// ==========================================
router.post(
  "/warehouses",
  verifyToken,
  canManageInventory,
  validate(createWarehouseSchema, { withSuccess: true }),
  asyncHandler(whCtrl.createWarehouse),
);
router.get("/warehouses", verifyToken, asyncHandler(whCtrl.getWarehouses));
router.put(
  "/warehouses/:id",
  verifyToken,
  canManageInventory,
  asyncHandler(whCtrl.updateWarehouse),
);
// Industrial alternative for delete
router.patch(
  "/warehouses/:id/toggle-status",
  verifyToken,
  canManageInventory,
  asyncHandler(whCtrl.toggleWarehouseStatus),
);

// ==========================================
// 4. PARTNER MANAGEMENT (Supplier/Manufacturer)
// ==========================================
router.post(
  "/partners",
  verifyToken,
  canManageInventory,
  validate(createPartnerSchema, { withSuccess: true }),
  asyncHandler(partnerCtrl.createPartner),
);
router.get("/partners", verifyToken, asyncHandler(partnerCtrl.getPartners));
router.put(
  "/partners/:id",
  verifyToken,
  canManageInventory,
  asyncHandler(partnerCtrl.updatePartner),
);
// Industrial alternative for delete
router.patch(
  "/partners/:id/toggle-status",
  verifyToken,
  canManageInventory,
  asyncHandler(partnerCtrl.togglePartnerStatus),
);

module.exports = router;
