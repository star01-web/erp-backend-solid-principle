const { DataTypes } = require("sequelize");
const sequelize = require("../../../common/db.config");

const SiteStockLevel = sequelize.define(
  "SiteStockLevel",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    // --- Foreign Keys (Explicitly defined for safe indexing) ---
    siteId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    ProductId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    manufacturer_id: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: "Kis manufacturer ka stock site par hai",
    },

    // --- Variant / Tracking Attribute ---
    color: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: "Standard", // main StockLevel ke jaisa hi default
      comment: "Product ka rang (e.g., Red, Blue, #001aff)",
    },

    // --- Site par available stock ---
    inHandQty: {
      type: DataTypes.DECIMAL(15, 3), // main StockLevel ke jaisa hi precision
      defaultValue: 0,
      validate: { min: 0 },
    },
  },
  {
    tableName: "inventory_site_stock_levels",
    timestamps: true,
    indexes: [
      {
        unique: true,
        // Ek Site par ek Product-Manufacturer-Color variant ki ek hi entry
        name: "unique_site_stock_idx",
        fields: ["siteId", "ProductId", "manufacturer_id", "color"],
      },
    ],
  },
);

module.exports = SiteStockLevel;
