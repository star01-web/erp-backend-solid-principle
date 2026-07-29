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
    // column is camelCase (added by the migration), and `underscored: true`
    // would otherwise map it to deleted_at — so pin the exact name.
    paranoid: true,
    deletedAt: "deletedAt",
    underscored: true, // Use snake_case for column names

    validate: {
      partnerRequired() {
        if (["INWARD", "OUTWARD"].includes(this.type) && !this.partner_id) {
          throw new Error(
            `${this.type} transaction ke liye Partner (Supplier/Customer) zaroori hai.`,
          );
        }
      },
    },
    indexes: [
      { fields: ["type"] },
      { fields: ["ProductId"] },
      { fields: ["WarehouseId"] },
      { fields: ["partner_id"] },
      { fields: ["manufacturer_id"] },
      { fields: ["batch_number"] },
      { fields: ["movement_date"] },
    ],
  },
);

module.exports = StockTransaction;
