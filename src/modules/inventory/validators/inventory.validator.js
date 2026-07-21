const { z } = require("zod");

/**
 * Zod schemas for the inventory module. Presence/shape checks live here so the
 * controllers can focus on business rules (duplicate checks, stock math). Each
 * schema reproduces the exact message the controller used, and routes pass
 * `{ withSuccess: true }` so the error body keeps the `{ success:false }` shape.
 */

const nonEmpty = (message) =>
  z.string({ error: message }).trim().min(1, { message });

// --- Product ---
const createProductSchema = z
  .object({
    sku_code: nonEmpty("SKU Code aur Product Name mandatory hain."),
    name: nonEmpty("SKU Code aur Product Name mandatory hain."),
  })
  .loose();

const bulkCreateProductsSchema = z
  .object({
    products: z
      .array(z.any(), { error: "Products ka array required hai." })
      .min(1, "Products ka array required hai."),
  })
  .loose();

// --- Warehouse ---
const createWarehouseSchema = z
  .object({
    name: nonEmpty("Warehouse name zaroori hai."),
  })
  .loose();

// --- Partner ---
const createPartnerSchema = z
  .object({
    name: nonEmpty(
      "Partner Name aur Type (SUPPLIER/MANUFACTURER/etc.) zaroori hain.",
    ),
    type: nonEmpty(
      "Partner Name aur Type (SUPPLIER/MANUFACTURER/etc.) zaroori hain.",
    ),
  })
  .loose();

// --- Stock movement ---
const MOVE_MSG = "Missing required fields.";
const createMovementSchema = z
  .object({
    productId: nonEmpty(MOVE_MSG),
    warehouseId: nonEmpty(MOVE_MSG),
    type: nonEmpty(MOVE_MSG),
    quantity: z
      .union([z.number(), z.string().min(1)], { error: MOVE_MSG })
      .refine((v) => v !== undefined && v !== null, { message: MOVE_MSG }),
  })
  .loose();

const bulkMovementSchema = z
  .object({
    movements: z
      .array(z.any(), { error: "Invalid data format." })
      .min(1, "Invalid data format."),
  })
  .loose();

// --- Site material return ---
const RETURN_MSG = "siteId, ProductId, WarehouseId aur returnQty required hain.";
const siteReturnSchema = z
  .object({
    siteId: nonEmpty(RETURN_MSG),
    ProductId: nonEmpty(RETURN_MSG),
    WarehouseId: nonEmpty(RETURN_MSG),
    returnQty: z.union([z.number(), z.string().min(1)], { error: RETURN_MSG }),
  })
  .loose();

module.exports = {
  createProductSchema,
  bulkCreateProductsSchema,
  createWarehouseSchema,
  createPartnerSchema,
  createMovementSchema,
  bulkMovementSchema,
  siteReturnSchema,
};
