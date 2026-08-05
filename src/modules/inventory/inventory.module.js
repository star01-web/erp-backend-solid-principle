/**
 * Composition root for the Inventory module. Builds the repository -> service
 * -> controller graph for Site management, Project management, and Stock ledgers.
 * Dependency Inversion — all concrete classes are instantiated here.
 */
const db = require("../../common/index.db");
const BaseRepository = require("../../common/BaseRepository");

const SiteDispatchLogRepository = require("./repositories/siteDispatchLog.repository");
const SiteStockRepository = require("./repositories/siteStock.repository");
const ProjectStockRepository = require("./repositories/projectStock.repository");

const DispatchService = require("./services/dispatch.service");
const SiteService = require("./services/site.service");
const ProjectService = require("./services/project.service");
const ProjectOutwardService = require("./services/projectOutward.service");
const ProjectTransferService = require("./services/projectTransfer.service");

const DispatchController = require("./inventory_controller/dispatch.controller");
const SiteController = require("./inventory_controller/site.controller");
const ProjectController = require("./inventory_controller/project.controller");
const ProjectOutwardController = require("./inventory_controller/projectOutward.controller");
const ProjectTransferController = require("./inventory_controller/projectTransfer.controller");

// ==========================================
// 1. REPOSITORIES (Data Access Layer)
// ==========================================
const productRepository = new BaseRepository(db.Product);
const warehouseRepository = new BaseRepository(db.Warehouse);
const siteRepository = new BaseRepository(db.Site);
const projectSiteRepository = new BaseRepository(db.ProjectSite);
const siteDispatchLogRepository = new SiteDispatchLogRepository(db.SiteDispatchLog);
const siteMaterialReturnRepository = new BaseRepository(db.SiteMaterialReturn);
const siteStockRepository = new SiteStockRepository(db.SiteStockLevel);

const projectRepository = new BaseRepository(db.Project);
const projectStockRepository = new ProjectStockRepository(db.ProjectStockLevel);

// ==========================================
// 2. SERVICES (Business Logic & Transactions)
// ==========================================
const dispatchService = new DispatchService({
  productRepository,
  siteDispatchLogRepository,
  siteStockRepository,
  siteMaterialReturnRepository,
  warehouseRepository,
  siteRepository,
  projectSiteRepository,
  projectStockRepository, // injected for project-linked site dispatch/returns
  sequelize: db.sequelize,
});

const siteService = new SiteService({
  siteRepository,
  projectSiteRepository,
  sequelize: db.sequelize,
});

const projectService = new ProjectService({
  projectRepository,
  projectStockRepository,
  siteRepository,
  sequelize: db.sequelize,
});

const projectOutwardService = new ProjectOutwardService({
  projectStockRepository,
  projectRepository,
  sequelize: db.sequelize,
});

const projectTransferService = new ProjectTransferService({
  projectStockRepository,
  projectRepository,
  sequelize: db.sequelize,
});

// ==========================================
// 3. CONTROLLERS (HTTP Layer)
// ==========================================
const dispatchController = new DispatchController({ dispatchService });
const siteController = new SiteController({ siteService });
const projectController = new ProjectController({ projectService });
const projectOutwardController = new ProjectOutwardController({ projectOutwardService });
const projectTransferController = new ProjectTransferController({ projectTransferService });

module.exports = {
  dispatchController,
  siteController,
  projectController,
  projectOutwardController,
  projectTransferController,
};
