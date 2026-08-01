const AppError = require("../../../common/AppError");

/**
 * SiteReportService - Business logic service for reports.
 */
class SiteReportService {
  constructor({ siteReportRepository }) {
    this.reportRepo = siteReportRepository;
  }

  /**
   * Generates Site Wise Material Summary report.
   *
   * @param {Object} filters
   * @returns {Promise<Object>} Formatted report data
   */
  async generateSiteMaterialSummary(filters = {}) {
    const { projectId, siteId, productId, manufacturerId, fromDate, toDate } =
      filters;

    let resolvedSiteName = "All Sites";
    let resolvedProjectName = "All Projects";

    if (siteId) {
      const siteInfo = await this.reportRepo.getSiteInfo(siteId);
      if (siteInfo) {
        resolvedSiteName = siteInfo.site_name || "Unknown Site";
        resolvedProjectName = siteInfo.project_name || "All Projects";
      } else {
        throw new AppError(`Site with ID '${siteId}' not found.`, 404);
      }
    }

    const rows = await this.reportRepo.getSiteMaterialSummary({
      siteId,
      productId,
      manufacturerId,
      fromDate,
      toDate,
    });

    return {
      project: resolvedProjectName,
      site: resolvedSiteName,
      fromDate: fromDate || "",
      toDate: toDate || "",
      totalProducts: rows.length,
      rows,
    };
  }
}

module.exports = SiteReportService;
