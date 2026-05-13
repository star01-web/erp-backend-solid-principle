const { DataTypes } = require("sequelize");
const sequelize = require("../../../common/db.config");

const StockLevel = sequelize.define(
  "StockLevel",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    // --- Foreign Keys (Explicitly defined for safe indexing) ---
    ProductId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    WarehouseId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    manufacturer_id: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: "Kis manufacturer ka stock hai",
    },

    // --- Variant / Tracking Attribute ---
    color: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: "Standard", // Agar color na de, toh 'Standard' save ho
      comment: "Product ka rang (e.g., Red, Blue, #001aff)",
    },

    // --- Physical Stock ---
    current_quantity: {
      type: DataTypes.DECIMAL(15, 3),
      defaultValue: 0,
      validate: { min: 0 },
    },

    // --- Reserved Stock ---
    reserved_quantity: {
      type: DataTypes.DECIMAL(15, 3),
      defaultValue: 0,
      validate: { min: 0 },
    },

    last_updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "inventory_stock_levels",
    timestamps: false,
    indexes: [
      {
        unique: true,
        // Ab ek Warehouse mein, Ek Product, Ek Manufacturer aur Ek Color ki ek hi combined entry hogi
        name: "unique_stock_idx",
        fields: ["ProductId", "WarehouseId", "manufacturer_id", "color"],
      },
    ],
  },
);

module.exports = StockLevel;
