/**
 * Composition root for the Inventory module. Builds the repository -> service
 * -> controller graph for the Site Dispatch ledger and injects collaborators
 * (Dependency Inversion). This is the ONLY place concrete classes are `new`-ed;
 * every layer receives its dependencies, so each is unit-testable in isolation.
 *
 * The shared Sequelize instance is injected into the service that owns
 * transactions.
 */
const db = require("../../common/index.db");
const BaseRepository = require("../../common/BaseRepository");

const SiteDispatchLogRepository = require("./repositories/siteDispatchLog.repository");
const DispatchService = require("./services/dispatch.service");
const DispatchController = require("./inventory_controller/dispatch.controller");

// ==========================================
// 1. REPOSITORIES (Data Access Layer)
// ==========================================
const productRepository = new BaseRepository(db.Product);
const siteDispatchLogRepository = new SiteDispatchLogRepository(
  db.SiteDispatchLog,
);
// NEW: Added repository for Site Stock Level tracking
const siteStockRepository = new BaseRepository(db.SiteStockLevel);

// ==========================================
// 2. SERVICES (Business Logic & Transactions)
// ==========================================
const dispatchService = new DispatchService({
  productRepository,
  siteDispatchLogRepository,
  siteStockRepository, // <-- NEW: Injected to manage live site stock
  sequelize: db.sequelize,
});

// ==========================================
// 3. CONTROLLERS (HTTP Layer)
// ==========================================
const dispatchController = new DispatchController({ dispatchService });

module.exports = {
  dispatchController,
};
