/**
 * Composition root for the Inventory module. Builds the repository -> service
 * -> controller graph for Site management and the Site Dispatch ledger, and
 * injects collaborators (Dependency Inversion). This is the ONLY place
 * concrete classes are `new`-ed; every layer receives its dependencies, so
 * each is unit-testable in isolation.
 *
 * The shared Sequelize instance is injected into the services that own
 * transactions.
 */
const db = require("../../common/index.db");
const BaseRepository = require("../../common/BaseRepository");

const SiteDispatchLogRepository = require("./repositories/siteDispatchLog.repository");
const SiteStockRepository = require("./repositories/siteStock.repository");
const DispatchService = require("./services/dispatch.service");
const SiteService = require("./services/site.service");
const DispatchController = require("./inventory_controller/dispatch.controller");
const SiteController = require("./inventory_controller/site.controller");

// ==========================================
// 1. REPOSITORIES (Data Access Layer)
// ==========================================
const productRepository = new BaseRepository(db.Product);
const siteDispatchLogRepository = new SiteDispatchLogRepository(
  db.SiteDispatchLog,
);
// Live per-site stock balances (lock-aware find/create + visibility queries)
const siteStockRepository = new SiteStockRepository(db.SiteStockLevel);
// Site master data — inventory side + HRM geofence side (cross-module on
// purpose: the dual-table create must be ONE transaction, so one service
// must own both repositories).
const siteRepository = new BaseRepository(db.Site);
const projectSiteRepository = new BaseRepository(db.ProjectSite);

// ==========================================
// 2. SERVICES (Business Logic & Transactions)
// ==========================================
const dispatchService = new DispatchService({
  productRepository,
  siteDispatchLogRepository,
  siteStockRepository,
  sequelize: db.sequelize,
});

const siteService = new SiteService({
  siteRepository,
  projectSiteRepository,
  sequelize: db.sequelize,
});

// ==========================================
// 3. CONTROLLERS (HTTP Layer)
// ==========================================
const dispatchController = new DispatchController({ dispatchService });
const siteController = new SiteController({ siteService });

module.exports = {
  dispatchController,
  siteController,
};
