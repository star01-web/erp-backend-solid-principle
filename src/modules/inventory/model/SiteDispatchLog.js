const { DataTypes } = require("sequelize");
const sequelize = require("../../../common/db.config");

/**
 * Site_Dispatch_Logs — a single append-only ledger for ALL material movements
 * between the warehouse/stock and a project site. Every DISPATCH (issue to site)
 * and RETURN (material coming back) is one immutable row here, so net site
 * consumption is always derivable from this one table.
 *
 * Cross-module note: `item_id` points at the Inventory `Product` (aka "Item")
 * and `site_id` points at the Inventory `Site`. Both live in the same DB, so
 * these are real DB-level foreign keys.
 */
const SiteDispatchLog = sequelize.define(
  "SiteDispatchLog",
  {
    log_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },

    // --- Foreign Keys ---
    site_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "inventory_sites", key: "id" },
      comment: "Site the material was dispatched to / returned from",
    },
    item_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "inventory_products", key: "id" },
      comment: "Item (Product) being moved",
    },

    // --- Movement classification ---
    transaction_type: {
      type: DataTypes.ENUM("DISPATCH", "RETURN"),
      allowNull: false,
    },

    // --- Movement details ---
    // `quantity` is what the operator TYPED, in whatever unit they picked
    // (`uom`). `base_quantity` is that amount converted to the item's base UOM
    // and is the ONLY figure used for stock math + reporting. Storing all three
    // keeps the ledger auditable ("2 Bundle") and computable ("200 Meter").
    quantity: {
      type: DataTypes.DECIMAL(15, 3),
      allowNull: false,
      // The ledger never stores a zero/negative movement; sign is expressed by
      // transaction_type, not by the number itself.
      validate: { min: 0.001 },
    },
    uom: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: "Unit selected at entry time (base_uom or purchase_uom)",
    },
    base_quantity: {
      type: DataTypes.DECIMAL(15, 3),
      allowNull: false,
      validate: { min: 0.001 },
      comment: "quantity converted to the item's base UOM (used for all math)",
    },
    transaction_date: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    remarks: { type: DataTypes.TEXT },

    // Audit column — consistent with the other inventory tables.
    created_by: {
      type: DataTypes.UUID,
      allowNull: true,
    },
  },
  {
    tableName: "inventory_site_dispatch_logs",
    timestamps: true,
    indexes: [
      // High-performance querying on large ledgers:
      { fields: ["site_id"] }, // per-site consumption reports
      { fields: ["item_id"] }, // per-item movement history
      { fields: ["transaction_type"] }, // DISPATCH vs RETURN filters
      { fields: ["transaction_date"] }, // date-range scans
    ],
  },
);

module.exports = SiteDispatchLog;
