const { DataTypes } = require("sequelize");
const sequelize = require("../../../common/db.config");

const StockTransaction = sequelize.define(
  "StockTransaction",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    type: {
      type: DataTypes.ENUM(
        "INWARD",
        "OUTWARD",
        "RETURN",
        "DAMAGE",
        "ADJUSTMENT",
        "SCRAP",
        "DISPATCH",
        "PROJECT_TRANSFER",
      ),
      allowNull: false,
    },

    // --- Industrial Links ---
    date: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },

    ProductId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: "ProductId",
      references: { model: "inventory_products", key: "id" },
    },
    WarehouseId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: "WarehouseId",
      references: { model: "inventory_warehouses", key: "id" },
    },
    partner_id: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: "Link to Supplier or Customer",
    },
    project_id: {
      type: DataTypes.UUID,
      allowNull: true,
      references: { model: "inventory_projects", key: "id" },
      comment: "Link to Project for warehouse-to-project outward or transfer",
    },
    manufacturer_id: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: "Track which manufacturer's stock is moving",
    },

    // --- Quantity & Value ---
    // Dual-UOM rule: `quantity` is what the operator TYPED in `uom` (e.g. "2
    // Bundle"); `base_quantity` is that amount converted to the product's
    // base UOM (2 * 100 = 200 mtr) and is the ONLY figure stock math and
    // reconciliation use. `conversion_factor` is FROZEN at transaction time so
    // a later change on the Product never rewrites history.
    // (Columns added by scripts/migrate-dual-uom-transactions.js.)
    quantity: {
      type: DataTypes.DECIMAL(15, 3),
      allowNull: false,
    },
    uom: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: "Unit selected at entry time (base_uom or purchase_uom)",
    },
    conversion_factor: {
      type: DataTypes.DECIMAL(15, 4),
      allowNull: false,
      defaultValue: 1,
      comment: "Base units per entered unit, frozen at transaction time",
    },
    base_quantity: {
      type: DataTypes.DECIMAL(15, 3),
      allowNull: true, // legacy rows backfilled by migration; new rows always set
      comment:
        "quantity converted to base UOM (qty * factor) — all stock math uses this",
    },
    unit_price: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0,
    },

    // --- Traceability & Status ---
    batch_number: { type: DataTypes.STRING },
    reference_no: { type: DataTypes.STRING },
    vehicle_number: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: "Vehicle number used for the material movement (transport)",
    },
    movement_date: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    status: {
      type: DataTypes.ENUM("PENDING", "COMPLETED", "CANCELLED"),
      defaultValue: "COMPLETED",
      allowNull: false,
    },
    remarks: { type: DataTypes.TEXT },
    created_by: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      field: "createdAt",
    },
    // Soft-delete stamp. MUST be declared explicitly with a pinned `field`:
    // the model is `underscored: true`, and the top-level `deletedAt` option
    // only renames the ATTRIBUTE — underscored still maps it to a
    // `deleted_at` COLUMN, which doesn't exist (DB column is camelCase,
    // added by migrate-dual-uom-transactions.js).
    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: "deletedAt",
    },
    // Note: Ise tabhi uncomment karna jab database me 'updated_by' column add kar lo
    // updated_by: {
    //   type: DataTypes.UUID,
    //   allowNull: true,
    // },
  },
  {
    tableName: "inventory_transactions",
    timestamps: true,
    createdAt: "createdAt",
    updatedAt: false,
    // Soft-delete for audit trails: DELETE /movement/:id reverse-accounts the
    // stock and then destroy()s the row, which only stamps deletedAt. The DB
    // column is camelCase — the attribute above pins `field: "deletedAt"`
    // (because `underscored: true` would otherwise look for deleted_at).
    paranoid: true,
    underscored: true, // Use snake_case for column names

    validate: {
      partnerRequired() {
        if (this.type === "INWARD" && !this.partner_id) {
          throw new Error(
            "INWARD transaction ke liye Supplier/Partner zaroori hai.",
          );
        }
        if (this.type === "OUTWARD" && !this.partner_id && !this.site_id) {
          throw new Error(
            "OUTWARD transaction ke liye Client (Partner) ya Site zaroori hai.",
          );
        }
      },
    },
    indexes: [
      { fields: ["type"] },
      { fields: ["ProductId"] },
      { fields: ["WarehouseId"] },
      { fields: ["partner_id"] },
      { fields: ["project_id"] },
      { fields: ["manufacturer_id"] },
      { fields: ["batch_number"] },
      { fields: ["movement_date"] },
    ],
  },
);

module.exports = StockTransaction;
