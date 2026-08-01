/**
 * SiteReportController - HTTP controller handling report endpoints.
 */
class SiteReportController {
  constructor({ siteReportService }) {
    this.reportService = siteReportService;
  }

  /**
   * GET /api/v1/reports/site-material-summary
   * Route handler for Site Wise Material Summary report.
   */
  getSiteMaterialSummary = async (req, res, next) => {
    try {
      const filters = req.query || {};
      const reportData =
        await this.reportService.generateSiteMaterialSummary(filters);

      return res.status(200).json({
        success: true,
        message: "Site Wise Material Summary generated successfully.",
        data: reportData,
      });
    } catch (error) {
      next(error);
    }
  };
}

module.exports = SiteReportController;
