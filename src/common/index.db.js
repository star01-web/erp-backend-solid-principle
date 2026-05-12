const { Sequelize } = require("sequelize");
const sequelize = require("./db.config");

// Models Import
const User = require("../modules/auth/models/user.model");
const EmployeeMaster = require("../modules/hrm/model/EmployeeMaster");
const CheckIn = require("../modules/hrm/model/CheckIn_model");
const CheckOut = require("../modules/hrm/model/CheckOut_model");
const OfficeLocation = require("../modules/hrm/model/Office_Location_model");
const Product = require("../modules/inventory/model/Product");
const Warehouse = require("../modules/inventory/model/Warehouse");
const StockLevel = require("../modules/inventory/model/StockLevel");
const StockTransaction = require("../modules/inventory/model/StockTransaction");
const Partner = require("../modules/inventory/model/Partner");
const db = {
  sequelize,
  Sequelize,
  User,
  EmployeeMaster,
  CheckIn,
  CheckOut,
  OfficeLocation,
  // Add Inventory Models
  Product,
  Warehouse,
  StockLevel,
  StockTransaction,
  Partner,
};

// --- ASSOCIATIONS (RELATIONS) ---

// 1. Employee to CheckIn (One-to-Many)
db.EmployeeMaster.hasMany(db.CheckIn, {
  foreignKey: "employee_master_id",
  as: "checkins",
});
db.CheckIn.belongsTo(db.EmployeeMaster, {
  foreignKey: "employee_master_id",
  as: "employee",
});

// 2. Employee to CheckOut (One-to-Many)
db.EmployeeMaster.hasMany(db.CheckOut, {
  foreignKey: "employee_master_id",
  as: "checkouts",
});
db.CheckOut.belongsTo(db.EmployeeMaster, {
  foreignKey: "employee_master_id",
  as: "employee",
});

// 3. OfficeLocation to EmployeeMaster (Geofencing ke liye)
db.OfficeLocation.hasMany(db.EmployeeMaster, {
  foreignKey: "location_id",
  as: "employees",
});
db.EmployeeMaster.belongsTo(db.OfficeLocation, {
  foreignKey: "location_id",
  as: "location",
});

// 4. User to EmployeeMaster (Login Mapping)
db.User.hasOne(db.EmployeeMaster, {
  foreignKey: "userId", // Check karein aapke DB mein 'userId' hai ya 'user_id'
  as: "employeeProfile",
});
db.EmployeeMaster.belongsTo(db.User, {
  foreignKey: "userId",
  as: "loginDetails",
});

// 5. Self-Referencing (Supervisor to Team Members)
// Yeh line aapka "Team" render karne mein madad karegi
db.EmployeeMaster.hasMany(db.EmployeeMaster, {
  foreignKey: "supervisor_id",
  as: "teamMembers",
});
db.EmployeeMaster.belongsTo(db.EmployeeMaster, {
  foreignKey: "supervisor_id",
  as: "supervisor",
});

// --- INVENTORY ASSOCIATIONS ---

// 1. Product & Warehouse Many-to-Many via StockLevel (Correct ✅)
db.Product.hasMany(db.StockLevel, { foreignKey: "ProductId" });
db.StockLevel.belongsTo(db.Product, { foreignKey: "ProductId" });

db.Warehouse.hasMany(db.StockLevel, { foreignKey: "WarehouseId" });
db.StockLevel.belongsTo(db.Warehouse, { foreignKey: "WarehouseId" });

// 2. Transactions Relations (Correct ✅)
db.Product.hasMany(db.StockTransaction, { foreignKey: "ProductId" });
db.StockTransaction.belongsTo(db.Product, { foreignKey: "ProductId" });

db.Warehouse.hasMany(db.StockTransaction, { foreignKey: "WarehouseId" });
db.StockTransaction.belongsTo(db.Warehouse, { foreignKey: "WarehouseId" });

// --- UPDATED INDUSTRIAL ASSOCIATIONS ---

// 3. Product & Manufacturer (CORRECTED: Many-to-Many 🛠️)
db.Product.belongsToMany(db.Partner, {
  through: "product_manufacturers", // <-- Quotes ke andar table ka naam
  foreignKey: "ProductId",
  otherKey: "PartnerId",
  as: "manufacturers",
});

db.Partner.belongsToMany(db.Product, {
  through: "product_manufacturers", // <-- Quotes ke andar table ka naam
  foreignKey: "PartnerId",
  otherKey: "ProductId",
  as: "manufacturedProducts",
});

// 4. Transaction & Partner (Correct ✅)
db.Partner.hasMany(db.StockTransaction, {
  foreignKey: "partner_id",
  as: "transactions",
});
db.StockTransaction.belongsTo(db.Partner, {
  foreignKey: "partner_id",
  as: "partner",
});

// Transaction Level par Manufacturer track karne ke liye (Correct ✅)
db.Partner.hasMany(db.StockTransaction, {
  foreignKey: "manufacturer_id",
  as: "originTransactions",
});
db.StockTransaction.belongsTo(db.Partner, {
  foreignKey: "manufacturer_id",
  as: "originManufacturer",
});

module.exports = db;
