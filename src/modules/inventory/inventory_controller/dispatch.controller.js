const AppError = require("../../../common/AppError");

/**
 * HTTP layer for the Site Dispatch ledger.
 *
 * SRP: this controller does exactly three things and nothing else —
 *   1. pull the DTO out of the HTTP request,
 *   2. delegate to the injected DispatchService,
 *   3. shape a standardized JSON response.
 * It never touches Sequelize, never runs a transaction, never enforces a
 * business rule. The service (injected via the composition root) owns all of
 * that. Expected failures arrive as `AppError` and map cleanly to HTTP codes.
 */
class DispatchController {
  constructor({ dispatchService }) {
    this.service = dispatchService;
  }

  // Uniform failure envelope. AppError -> its status; anything else -> 500.
  _fail(res, error, fallbackMessage) {
    if (error instanceof AppError) {
      return res
        .status(error.statusCode)
        .json({ success: false, message: error.message });
    }
    console.error(`${fallbackMessage}:`, error);
    return res
      .status(500)
      .json({ success: false, message: fallbackMessage, error: error.message });
  }

  // POST /ledger/dispatch
  dispatchItem = async (req, res) => {
    try {
      const { site_id, item_id, quantity, uom, remarks, transaction_date } =
        req.body;
      const data = await this.service.dispatchItem({
        siteId: site_id,
        itemId: item_id,
        quantity,
        uom,
        remarks,
        transactionDate: transaction_date,
        userId: req.user?.id,
      });
      return res.status(201).json({
        success: true,
        message: "Item dispatched to site successfully.",
        data,
      });
    } catch (error) {
      return this._fail(res, error, "Failed to dispatch item");
    }
  };

  // POST /ledger/return
  returnItem = async (req, res) => {
    try {
      const { site_id, item_id, quantity, uom, remarks, transaction_date } =
        req.body;
      const data = await this.service.returnItem({
        siteId: site_id,
        itemId: item_id,
        quantity,
        uom,
        remarks,
        transactionDate: transaction_date,
        userId: req.user?.id,
      });
      return res.status(201).json({
        success: true,
        message: "Item returned to stock successfully.",
        data,
      });
    } catch (error) {
      return this._fail(res, error, "Failed to return item");
    }
  };

  // GET /ledger/consumption/:siteId
  getConsumptionReport = async (req, res) => {
    try {
      const report = await this.service.getConsumptionReport(req.params.siteId);
      return res.status(200).json({ success: true, ...report });
    } catch (error) {
      return this._fail(res, error, "Failed to build consumption report");
    }
  };
}

module.exports = DispatchController;
