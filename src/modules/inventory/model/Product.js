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
    color: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: "Product ka rang (e.g., Red, Blue, #FF0000)",
    },
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
      { fields: ["color"] }, // Color ke base par filter karne ke liye fast search
    ],
  },
);

module.exports = Product;
