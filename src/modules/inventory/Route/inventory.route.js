const express = require("express");
const router = express.Router();

// Controllers Import
const invCtrl = require("../inventory_controller/inventory.controller");
const prodCtrl = require("../inventory_controller/product.controller");
const whCtrl = require("../inventory_controller/warehouse.controller");
const partnerCtrl = require("../inventory_controller/Partner");

// Middleware Import
const { verifyToken } = require("../../auth/middleware/authMiddleware");

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

// ==========================================
// 1. STOCK MOVEMENT & DASHBOARD (Protected)
// ==========================================
router.post(
  "/movement",
  verifyToken,
  asyncHandler(invCtrl.processStockMovement),
);
router.put(
  "/movement/:id",
  verifyToken,
  asyncHandler(invCtrl.updateStockMovement),
);

router.post(
  "/bulkmovement",
  verifyToken,
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
router.post("/products", verifyToken, asyncHandler(prodCtrl.createProduct));
router.get("/products", verifyToken, asyncHandler(prodCtrl.getAllProducts));
router.put("/products/:id", verifyToken, asyncHandler(prodCtrl.updateProduct));
router.post(
  "/bulkproducts",
  verifyToken,
  asyncHandler(prodCtrl.bulkCreateProducts),
);
// Industrial alternative for delete
router.patch(
  "/products/:id/toggle-status",
  verifyToken,
  asyncHandler(prodCtrl.toggleProductStatus),
);

// ==========================================
// 3. WAREHOUSE MANAGEMENT
// ==========================================
router.post("/warehouses", verifyToken, asyncHandler(whCtrl.createWarehouse));
router.get("/warehouses", verifyToken, asyncHandler(whCtrl.getWarehouses));
router.put(
  "/warehouses/:id",
  verifyToken,
  asyncHandler(whCtrl.updateWarehouse),
);
// Industrial alternative for delete
router.patch(
  "/warehouses/:id/toggle-status",
  verifyToken,
  asyncHandler(whCtrl.toggleWarehouseStatus),
);

// ==========================================
// 4. PARTNER MANAGEMENT (Supplier/Manufacturer)
// ==========================================
router.post("/partners", verifyToken, asyncHandler(partnerCtrl.createPartner));
router.get("/partners", verifyToken, asyncHandler(partnerCtrl.getPartners));
router.put(
  "/partners/:id",
  verifyToken,
  asyncHandler(partnerCtrl.updatePartner),
);
// Industrial alternative for delete
router.patch(
  "/partners/:id/toggle-status",
  verifyToken,
  asyncHandler(partnerCtrl.togglePartnerStatus),
);

module.exports = router;
