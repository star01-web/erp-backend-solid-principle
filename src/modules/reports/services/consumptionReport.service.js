class ConsumptionReportService {
  constructor({ consumptionReportRepository }) {
    this.repo = consumptionReportRepository;
  }

  async getProjectConsumptionReport(query = {}) {
    const data = await this.repo.getProjectConsumptionReport(query);
    return {
      success: true,
      reportType: "PROJECT_CONSUMPTION",
      count: data.length,
      rows: data,
    };
  }

  async getSiteConsumptionReport(query = {}) {
    const data = await this.repo.getSiteConsumptionReport(query);
    return {
      success: true,
      reportType: "SITE_CONSUMPTION",
      count: data.length,
      rows: data,
    };
  }
}

module.exports = ConsumptionReportService;
