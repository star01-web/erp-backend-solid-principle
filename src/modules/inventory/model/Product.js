const { DataTypes } = require("sequelize");
const sequelize = require("../../../common/db.config");

const Product = sequelize.define(
  "Product",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    sku_code: {
      type: DataTypes.STRING,
      unique: true,
      allowNull: false,
    },
    name: { type: DataTypes.STRING, allowNull: false },

    // --- Product Attributes ---
    // Color yahan se hata diya gaya hai. Ab yeh StockTransaction aur StockLevel mein jayega.

    description: { type: DataTypes.TEXT },
    hsn_code: { type: DataTypes.STRING }, // Tax Compliance

    category: { type: DataTypes.STRING },
    unit: { type: DataTypes.STRING, defaultValue: "pcs" },

    // --- Stock Controls ---
    min_stock_level: {
      type: DataTypes.INTEGER,
      defaultValue: 5,
    },
    max_stock_level: {
      type: DataTypes.INTEGER,
      defaultValue: 1000,
    },

    is_active: { type: DataTypes.BOOLEAN, defaultValue: true },
  },
  {
    tableName: "inventory_products",
    timestamps: true,
    paranoid: true,
    indexes: [
      { fields: ["sku_code"] },
      // Color ka index bhi hata diya gaya hai
    ],
  },
);

module.exports = Product;
