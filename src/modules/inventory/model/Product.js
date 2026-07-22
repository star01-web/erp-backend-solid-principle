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
    // Unique at the DB level too — the controller's name check alone leaves a
    // race window under concurrent creates.
    name: { type: DataTypes.STRING, allowNull: false, unique: true },

    // --- Product Attributes ---
    // Color yahan se hata diya gaya hai. Ab yeh StockTransaction aur StockLevel mein jayega.

    description: { type: DataTypes.TEXT },
    hsn_code: { type: DataTypes.STRING }, // Tax Compliance

    category: { type: DataTypes.STRING },
    unit: { type: DataTypes.STRING, defaultValue: "pcs" },

    // --- Multi-UOM support ---
    // total_stock is ALWAYS stored in base_uom. Entries can come in either
    // base_uom or purchase_uom; the service converts to base before touching
    // stock, so the counter never mixes units.
    //   base_uom          -> smallest tracked unit, e.g. 'Meter'
    //   purchase_uom      -> bulk unit goods are bought in, e.g. 'Bundle'
    //   conversion_factor -> how many base units in one purchase unit, e.g. 100
    //                        (1 Bundle = 100 Meter)
    base_uom: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "pcs",
    },
    purchase_uom: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    conversion_factor: {
      type: DataTypes.DECIMAL(15, 4),
      allowNull: false,
      defaultValue: 1,
      // Never zero/negative — it is a multiplier used in stock math.
      validate: { min: 0.0001 },
    },

    // --- Stock Controls ---
    // Single running stock counter used by the Site Dispatch ledger. dispatchItem
    // deducts from it and returnItem adds back, both under a row-level lock so
    // concurrent movements can never drive it negative.
    total_stock: {
      type: DataTypes.DECIMAL(15, 3),
      allowNull: false,
      defaultValue: 0,
    },
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
