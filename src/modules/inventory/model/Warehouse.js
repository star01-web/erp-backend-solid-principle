const { DataTypes } = require("sequelize");
const sequelize = require("../../../common/db.config");

const Warehouse = sequelize.define(
  "Warehouse",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    // Industrial Context: Warehouse ka type (Raw Material, Scrap, Finished Goods)
    type: {
      type: DataTypes.ENUM(
        "MAIN",
        "RAW_MATERIAL",
        "FINISHED_GOODS",
        "SCRAP",
        "QC_AREA",
      ),
      defaultValue: "MAIN",
    },
    location: { type: DataTypes.TEXT },
    contact_person: { type: DataTypes.STRING },

    // Professional communication ke liye
    contact_phone: { type: DataTypes.STRING },
    contact_email: { type: DataTypes.STRING },

    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true, //
    },
  },
  {
    tableName: "inventory_warehouses",
    timestamps: true,
    // Industrial Safety: Product model ki tarah yahan bhi soft delete (paranoid) zaroori hai
    paranoid: true,
  },
);

module.exports = Warehouse;
