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

// Repositories (data access)
const productRepository = new BaseRepository(db.Product);
const siteDispatchLogRepository = new SiteDispatchLogRepository(
  db.SiteDispatchLog,
);

// Services (business logic + transactions)
const dispatchService = new DispatchService({
  productRepository,
  siteDispatchLogRepository,
  sequelize: db.sequelize,
});

// Controllers (HTTP)
const dispatchController = new DispatchController({ dispatchService });

module.exports = {
  dispatchController,
};
