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
        "INWARD", // Purchase/Stock Receive
        "OUTWARD", // Sale/Stock Issue
        "RETURN", // Sales Return or Purchase Return
        "DAMAGE", // Wastage
        "ADJUSTMENT", // Audit Correction
      ),
      allowNull: false,
    },

    // --- Industrial Links ---
    ProductId: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: "inventory_products", key: "id" },
    },
    WarehouseId: {
      type: DataTypes.UUID,
      allowNull: false, // Har transaction kisi warehouse se honi chahiye
      references: { model: "inventory_warehouses", key: "id" },
    },
    partner_id: {
      type: DataTypes.UUID,
      allowNull: true, // INWARD/OUTWARD ke liye validation se check karenge
      comment: "Link to Supplier or Customer",
    },

    // --- Quantity & Value ---
    quantity: {
      type: DataTypes.DECIMAL(15, 3), // Precision badha di (e.g., 100.550 kg)
      allowNull: false,
    },
    unit_price: {
      type: DataTypes.DECIMAL(15, 2),
      allowNull: false,
      defaultValue: 0,
      comment: "Valuation ke liye unit rate",
    },

    // --- Traceability ---
    batch_number: { type: DataTypes.STRING },
    reference_no: { type: DataTypes.STRING },
    remarks: { type: DataTypes.TEXT },

    created_by: {
      type: DataTypes.UUID,
      allowNull: false,
    },
  },
  {
    tableName: "inventory_transactions",
    timestamps: true,
    updatedAt: false, //

    // --- Industrial Validations ---
    validate: {
      partnerRequired() {
        // INWARD aur OUTWARD ke liye partner zaroori hai
        if (["INWARD", "OUTWARD"].includes(this.type) && !this.partner_id) {
          throw new Error(
            `${this.type} transaction ke liye Partner (Supplier/Customer) zaroori hai.`,
          );
        }
      },
    },
    indexes: [
      { fields: ["type"] },
      { fields: ["ProductId"] },
      { fields: ["WarehouseId"] },
      { fields: ["partner_id"] },
      { fields: ["batch_number"] },
    ],
  },
);

module.exports = StockTransaction;
