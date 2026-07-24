const { DataTypes } = require("sequelize");
const sequelize = require("../../../common/db.config");

const StockTransaction = sequelize.define(
  "StockTransaction",
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    type: {
      type: DataTypes.ENUM(
        "INWARD",
        "OUTWARD",
        "RETURN",
        "DAMAGE",
        "ADJUSTMENT"
      ),
      allowNull: false,
    },

    // --- Industrial Links ---
    date: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
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
    partner_id: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: "Link to Supplier or Customer",
    },
    manufacturer_id: {
      type: DataTypes.UUID,
      allowNull: true,
      comment: "Track which manufacturer's stock is moving",
    },

    // --- Quantity & Value ---
    quantity: {
      type: DataTypes.DECIMAL(15, 3),
      allowNull: false,
    },
    unit_price: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0,
    },

    // --- Traceability & Status ---
    batch_number: { type: DataTypes.STRING },
    reference_no: { type: DataTypes.STRING },
    vehicle_number: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: "Vehicle number used for the material movement (transport)",
    },
    movement_date: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    status: {
      type: DataTypes.ENUM("PENDING", "COMPLETED", "CANCELLED"),
      defaultValue: "COMPLETED",
      allowNull: false,
    },
    remarks: { type: DataTypes.TEXT },
    created_by: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    // Note: Ise tabhi uncomment karna jab database me 'updated_by' column add kar lo
    // updated_by: {
    //   type: DataTypes.UUID,
    //   allowNull: true,
    // },
  },
  {
    tableName: "inventory_transactions",
    timestamps: false, // <-- FIX: Ise false kar diya hai taaki 'updatedAt' ka error hamesha ke liye khatam ho jaye
    underscored: true, // Use snake_case for column names

    validate: {
      partnerRequired() {
        if (["INWARD", "OUTWARD"].includes(this.type) && !this.partner_id) {
          throw new Error(
            `${this.type} transaction ke liye Partner (Supplier/Customer) zaroori hai.`
          );
        }
      },
    },
    indexes: [
      { fields: ["type"] },
      { fields: ["ProductId"] },
      { fields: ["WarehouseId"] },
      { fields: ["partner_id"] },
      { fields: ["manufacturer_id"] },
      { fields: ["batch_number"] },
      { fields: ["movement_date"] },
    ],
  }
);

module.exports = StockTransaction;
