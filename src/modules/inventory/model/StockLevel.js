const { DataTypes } = require("sequelize");
const sequelize = require("../../../common/db.config");

const StockLevel = sequelize.define(
  "StockLevel",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    // Physical Stock: Jo asal mein godown mein rakha hai
    current_quantity: {
      type: DataTypes.DECIMAL(15, 3), // Industry mein precision 3 decimal tak rakhte hain (e.g. 10.550 kg)
      defaultValue: 0,
      validate: { min: 0 }, //
    },
    // Reserved Stock: Wo maal jo kisi order ke liye book ho chuka hai
    reserved_quantity: {
      type: DataTypes.DECIMAL(15, 3),
      defaultValue: 0,
      validate: { min: 0 },
    },
    // Available Stock (Virtual): current_quantity - reserved_quantity
    // Isse pata chalta hai ki naya order kitne ka le sakte hain

    last_updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    tableName: "inventory_stock_levels",
    timestamps: false, // Kyunki last_updated_at manually handle ho raha hai
    indexes: [
      {
        unique: true,
        fields: ["ProductId", "WarehouseId"], //
      },
    ],
  },
);

module.exports = StockLevel;
