/**
 * Composition root for the Reports module.
 * Wires repository -> service -> controller graph using Dependency Injection.
 */
const SiteReportRepository = require("./repositories/siteReport.repository");
const SiteReportService = require("./services/siteReport.service");
const SiteReportController = require("./controllers/siteReport.controller");

// 1. Repository
const siteReportRepository = new SiteReportRepository();

// 2. Service
const siteReportService = new SiteReportService({ siteReportRepository });

// 3. Controller
const siteReportController = new SiteReportController({ siteReportService });

module.exports = {
  siteReportController,
  siteReportService,
  siteReportRepository,
};
