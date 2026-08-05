/**
 * Composition root for the Reports module.
 * Wires repository -> service -> controller graph using Dependency Injection.
 */
const SiteReportRepository = require("./repositories/siteReport.repository");
const SiteReportService = require("./services/siteReport.service");
const SiteReportController = require("./controllers/siteReport.controller");

const ConsumptionReportRepository = require("./repositories/consumptionReport.repository");
const ConsumptionReportService = require("./services/consumptionReport.service");
const ConsumptionReportController = require("./controllers/consumptionReport.controller");

// 1. Repositories
const siteReportRepository = new SiteReportRepository();
const consumptionReportRepository = new ConsumptionReportRepository();

// 2. Services
const siteReportService = new SiteReportService({ siteReportRepository });
const consumptionReportService = new ConsumptionReportService({ consumptionReportRepository });

// 3. Controllers
const siteReportController = new SiteReportController({ siteReportService });
const consumptionReportController = new ConsumptionReportController({ consumptionReportService });

module.exports = {
  siteReportController,
  siteReportService,
  siteReportRepository,
  consumptionReportController,
  consumptionReportService,
  consumptionReportRepository,
};
