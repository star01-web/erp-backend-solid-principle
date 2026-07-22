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
    // Denormalised project name. `projectId` is the (future) FK; `project_name`
    // is the human-readable label the consumption report surfaces without an
    // extra join to a Project table that does not exist yet.
    project_name: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    // `name` is the requirement's `site_name`.
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    location: { type: DataTypes.TEXT },

    // `is_active` is the requirement's `status` (active/inactive) as a boolean.
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
