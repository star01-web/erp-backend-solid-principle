const AppError = require("../../../common/AppError");

class ConsumptionReportController {
  constructor({ consumptionReportService }) {
    this.service = consumptionReportService;
  }

  _fail(res, error, fallbackMessage, next = null) {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    console.error(`${fallbackMessage}:`, error);
    if (typeof next === "function") return next(error);
    return res.status(500).json({
      success: false,
      message: fallbackMessage,
      error: process.env.NODE_ENV === "production" ? "Internal Server Error" : error.message,
    });
  }

  getProjectConsumptionReport = async (req, res, next) => {
    try {
      const report = await this.service.getProjectConsumptionReport(req.query);
      return res.status(200).json(report);
    } catch (error) {
      return this._fail(res, error, "Failed to generate project consumption report", next);
    }
  };

  getSiteConsumptionReport = async (req, res, next) => {
    try {
      const report = await this.service.getSiteConsumptionReport(req.query);
      return res.status(200).json(report);
    } catch (error) {
      return this._fail(res, error, "Failed to generate site consumption report", next);
    }
  };
}

module.exports = ConsumptionReportController;
