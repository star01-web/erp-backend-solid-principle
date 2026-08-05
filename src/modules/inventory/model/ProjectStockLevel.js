const { DataTypes } = require("sequelize");
const sequelize = require("../../../common/db.config");

const ProjectStockLevel = sequelize.define(
  "ProjectStockLevel",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    project_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "inventory_projects", key: "id" },
    },
    ProductId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "inventory_products", key: "id" },
    },
    manufacturer_id: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: "Manufacturer ID for variant tracking",
    },
    color: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: "Standard",
      comment: "Variant color (e.g., Red, Standard)",
    },
    current_quantity: {
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
    tableName: "inventory_project_stock_levels",
    timestamps: true,
    indexes: [
      {
        unique: true,
        name: "unique_project_stock_idx",
        fields: ["project_id", "ProductId", "manufacturer_id", "color"],
      },
      { fields: ["project_id"] },
      { fields: ["ProductId"] },
    ],
  }
);

module.exports = ProjectStockLevel;
