const { DataTypes } = require("sequelize");
const sequelize = require("../../../common/db.config");

const Partner = sequelize.define(
  "Partner",
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
    type: {
      // Ek hi company kai roles play kar sakti hai
      type: DataTypes.ENUM("SUPPLIER", "MANUFACTURER", "CUSTOMER", "TRADER"),
      allowNull: false,
    },
    gst_number: {
      type: DataTypes.STRING,
      unique: true, // Industrial level par GST unique hona chahiye
    },

    // --- Status Field ---
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
      comment: "Agar partner active hai toh true, warna false",
    },

    // Extra Industrial Fields
    address: { type: DataTypes.TEXT },
    contact_person: { type: DataTypes.STRING },
    phone: { type: DataTypes.STRING },
  },
  {
    tableName: "inventory_partners",
    timestamps: true,
    // Industrial data safe rakhne ke liye Product model ki tarah paranoid use karein
    paranoid: true,
  },
);

module.exports = Partner;
