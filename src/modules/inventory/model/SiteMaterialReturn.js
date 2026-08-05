const { DataTypes } = require("sequelize");
const sequelize = require("../../../common/db.config");

const SiteMaterialReturn = sequelize.define(
  "SiteMaterialReturn",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    // --- Foreign Keys ---
    siteId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    ProductId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "inventory_products", key: "id" },
    },
    WarehouseId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "inventory_warehouses", key: "id" },
    },
    manufacturer_id: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: "Kis manufacturer ka material return hua",
    },

    // --- Variant / Tracking Attribute ---
    color: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: "Standard",
      comment: "Return hone wale product ka exact variant color",
    },

    // --- Return Details ---
    returnQty: {
      type: DataTypes.DECIMAL(15, 3),
      allowNull: false,
      validate: { min: 0.001 }, // zero/negative return allowed nahi
    },
    returnDate: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    condition: {
      type: DataTypes.ENUM("Good", "Damaged", "Scrap"),
      allowNull: false,
      defaultValue: "Good",
    },
    remarks: { type: DataTypes.TEXT },

    created_by: {
      type: DataTypes.UUID,
      allowNull: false,
    },
  },
  {
    tableName: "inventory_site_material_returns",
    timestamps: true,
    indexes: [
      { fields: ["siteId"] },
      { fields: ["ProductId"] },
      { fields: ["WarehouseId"] },
      { fields: ["manufacturer_id"] },
      { fields: ["returnDate"] },
    ],
  },
);

module.exports = SiteMaterialReturn;
