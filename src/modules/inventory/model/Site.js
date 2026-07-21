const { DataTypes } = require("sequelize");
const sequelize = require("../../../common/db.config");

const Site = sequelize.define(
  "Site",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    // Project link (Project model abhi codebase mein nahi hai —
    // association index.db.js mein tab add hogi jab Project model banega)
    projectId: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    location: { type: DataTypes.TEXT },

    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
  },
  {
    tableName: "inventory_sites",
    timestamps: true,
    // Warehouse model ki tarah soft delete
    paranoid: true,
  },
);

module.exports = Site;
