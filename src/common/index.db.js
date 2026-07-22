const { Sequelize } = require("sequelize");
const sequelize = require("./db.config");

// Models Import
const User = require("../modules/auth/models/user.model");
const EmployeeMaster = require("../modules/hrm/models/EmployeeMaster");
const CheckIn = require("../modules/hrm/models/CheckIn_model");
const CheckOut = require("../modules/hrm/models/CheckOut_model");
const ProjectSite = require("../modules/hrm/models/ProjectSite_model");
const Product = require("../modules/inventory/model/Product");
const Warehouse = require("../modules/inventory/model/Warehouse");
const StockLevel = require("../modules/inventory/model/StockLevel");
const StockTransaction = require("../modules/inventory/model/StockTransaction");
const Partner = require("../modules/inventory/model/Partner");
const Site = require("../modules/inventory/model/Site");
const SiteStockLevel = require("../modules/inventory/model/SiteStockLevel");
const SiteMaterialReturn = require("../modules/inventory/model/SiteMaterialReturn");
const SiteDispatchLog = require("../modules/inventory/model/SiteDispatchLog");
const db = {
  sequelize,
  Sequelize,
  User,
  EmployeeMaster,
  CheckIn,
  CheckOut,
  ProjectSite,
  // Add Inventory Models
  Product,
  Warehouse,
  StockLevel,
  StockTransaction,
  Partner,
  // Site Management Models
  Site,
  SiteStockLevel,
  SiteMaterialReturn,
  SiteDispatchLog,
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

// 3. ProjectSite to EmployeeMaster (Geofencing ke liye)
db.ProjectSite.hasMany(db.EmployeeMaster, {
  foreignKey: "location_id",
  as: "employees",
});
db.EmployeeMaster.belongsTo(db.ProjectSite, {
  foreignKey: "location_id",
  as: "location",
});

// 4. User to EmployeeMaster (Login Mapping)
db.User.hasOne(db.EmployeeMaster, {
  foreignKey: "user_id", // model attribute 'user_id' -> column 'userId'
  as: "employeeProfile",
});
db.EmployeeMaster.belongsTo(db.User, {
  foreignKey: "user_id",
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

// --- SITE MANAGEMENT ASSOCIATIONS ---
// NOTE: `Site.projectId` column model par defined hai, lekin Project model
// abhi codebase mein exist nahi karta. Jab Project model banega, yahan add karein:
//   db.Project.hasMany(db.Site, { foreignKey: "projectId", as: "sites" });
//   db.Site.belongsTo(db.Project, { foreignKey: "projectId", as: "project" });

// 1. SiteStockLevel -> Site & Product
db.Site.hasMany(db.SiteStockLevel, { foreignKey: "siteId", as: "stockLevels" });
db.SiteStockLevel.belongsTo(db.Site, { foreignKey: "siteId", as: "site" });

db.Product.hasMany(db.SiteStockLevel, { foreignKey: "ProductId" });
db.SiteStockLevel.belongsTo(db.Product, { foreignKey: "ProductId" });

// 2. SiteMaterialReturn -> Site, Product & Warehouse
db.Site.hasMany(db.SiteMaterialReturn, {
  foreignKey: "siteId",
  as: "materialReturns",
});
db.SiteMaterialReturn.belongsTo(db.Site, { foreignKey: "siteId", as: "site" });

db.Product.hasMany(db.SiteMaterialReturn, { foreignKey: "ProductId" });
db.SiteMaterialReturn.belongsTo(db.Product, { foreignKey: "ProductId" });

db.Warehouse.hasMany(db.SiteMaterialReturn, { foreignKey: "WarehouseId" });
db.SiteMaterialReturn.belongsTo(db.Warehouse, { foreignKey: "WarehouseId" });

// --- SITE DISPATCH LEDGER ASSOCIATIONS ---
// Cross-module ledger: every row belongs to one Site and one Item (Product).

// 1. Site -> SiteDispatchLog (one site, many movements)
db.Site.hasMany(db.SiteDispatchLog, {
  foreignKey: "site_id",
  as: "dispatchLogs",
});
db.SiteDispatchLog.belongsTo(db.Site, { foreignKey: "site_id", as: "site" });

// 2. Product (Item) -> SiteDispatchLog (one item, many movements)
db.Product.hasMany(db.SiteDispatchLog, {
  foreignKey: "item_id",
  as: "dispatchLogs",
});
db.SiteDispatchLog.belongsTo(db.Product, { foreignKey: "item_id", as: "item" });

module.exports = db;
