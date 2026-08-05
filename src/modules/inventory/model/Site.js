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
    // Direct string field (Koi JOIN ya association ki zaroorat nahi)
    project_name: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    site_name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    manager_name: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: "Unassigned",
    },
    contact_number: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    site_location: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
  },
  {
    tableName: "inventory_sites",
    timestamps: true,
    paranoid: true,
  },
);

module.exports = Site;
