const AppError = require("../../../common/AppError");

class ProjectOutwardController {
  constructor({ projectOutwardService }) {
    this.service = projectOutwardService;
  }

  _fail(res, error, fallbackMessage, next = null) {
    if (error instanceof AppError) {
      return res
        .status(error.statusCode)
        .json({ success: false, message: error.message });
    }
    console.error(`${fallbackMessage}:`, error);
    if (typeof next === "function") return next(error);
    return res.status(500).json({
      success: false,
      message: fallbackMessage,
      error: process.env.NODE_ENV === "production" ? "Internal Server Error" : error.message,
    });
  }

  processProjectOutward = async (req, res, next) => {
    try {
      const {
        warehouse_id,
        project_id,
        item_id,
        quantity,
        uom,
        manufacturer_id,
        color,
        reference_no,
        remarks,
      } = req.body;

      const result = await this.service.processProjectOutward({
        warehouse_id,
        project_id,
        item_id,
        quantity,
        uom,
        manufacturer_id,
        color,
        reference_no,
        remarks,
        created_by: req.user?.id || null,
      });

      return res.status(201).json({
        success: true,
        message: "Material successfully transferred from Warehouse to Project stock.",
        data: result,
      });
    } catch (error) {
      return this._fail(res, error, "Failed to process warehouse to project outward", next);
    }
  };
}

module.exports = ProjectOutwardController;
