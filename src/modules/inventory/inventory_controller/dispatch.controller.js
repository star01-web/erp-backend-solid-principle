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

  /**
   * Uniform failure envelope. AppError -> its status; anything else -> 500.
   * Also forwards to standard Express `next()` if provided, for Global Error Handlers.
   */
  _fail(res, error, fallbackMessage, next = null) {
    if (error instanceof AppError) {
      return res
        .status(error.statusCode)
        .json({ success: false, message: error.message });
    }

    console.error(`${fallbackMessage}:`, error);

    // Agar route wrapper ne next() pass kiya hai toh Global Error Handler ko forward karein
    if (typeof next === "function") {
      return next(error);
    }

    return res.status(500).json({
      success: false,
      message: fallbackMessage,
      error:
        process.env.NODE_ENV === "production"
          ? "Internal Server Error"
          : error.message,
    });
  }

  // POST /ledger/dispatch
  dispatchItem = async (req, res, next) => {
    try {
      const { site_id, item_id, quantity, uom, remarks, transaction_date } =
        req.body;

      // Quick HTTP-level validation before calling service
      if (!site_id || !item_id || quantity === undefined || !uom) {
        throw new AppError(
          "site_id, item_id, quantity aur uom body me hona mandatory hai.",
          400,
        );
      }

      const data = await this.service.dispatchItem({
        siteId: site_id,
        itemId: item_id,
        quantity,
        uom,
        remarks,
        transactionDate: transaction_date,
        userId: req.user?.id || null, // Auth token se user id pick karega
      });

      return res.status(201).json({
        success: true,
        message:
          "Item successfully dispatched to site and stock levels updated.",
        data,
      });
    } catch (error) {
      return this._fail(res, error, "Failed to dispatch item to site", next);
    }
  };

  // POST /ledger/return
  returnItem = async (req, res, next) => {
    try {
      const { site_id, item_id, quantity, uom, remarks, transaction_date } =
        req.body;

      // Quick HTTP-level validation
      if (!site_id || !item_id || quantity === undefined || !uom) {
        throw new AppError(
          "site_id, item_id, quantity aur uom body me hona mandatory hai.",
          400,
        );
      }

      const data = await this.service.returnItem({
        siteId: site_id,
        itemId: item_id,
        quantity,
        uom,
        remarks,
        transactionDate: transaction_date,
        userId: req.user?.id || null,
      });

      return res.status(201).json({
        success: true,
        message: "Item returned from site to warehouse stock successfully.",
        data,
      });
    } catch (error) {
      return this._fail(res, error, "Failed to return item from site", next);
    }
  };

  // GET /ledger/consumption/:siteId
  getConsumptionReport = async (req, res, next) => {
    try {
      const { siteId } = req.params;

      if (!siteId) {
        throw new AppError("URL param me siteId mandatory hai.", 400);
      }

      const report = await this.service.getConsumptionReport(siteId);

      return res.status(200).json({
        success: true,
        message: "Site consumption report fetched successfully.",
        ...report,
      });
    } catch (error) {
      return this._fail(res, error, "Failed to build consumption report", next);
    }
  };
}

module.exports = DispatchController;
