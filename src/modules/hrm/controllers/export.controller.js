const AppError = require("../../../common/AppError");

/**
 * HTTP layer for the attendance Excel export. Owns the response headers and
 * streaming; workbook construction lives in ExportService.
 */
class ExportController {
  constructor({ exportService }) {
    this.exportService = exportService;
  }

  exportAttendanceWithTemplate = async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const { workbook, fileName } =
        await this.exportService.buildMonthlyAttendanceWorkbook({
          startDate,
          endDate,
        });

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader("Content-Disposition", `attachment; filename=${fileName}`);

      await workbook.xlsx.write(res);
      res.status(200).end();
    } catch (error) {
      if (error instanceof AppError)
        return res
          .status(error.statusCode)
          .json({ success: false, message: error.message });
      console.error("❌ Export Error:", error);
      return res.status(500).json({ success: false, message: error.message });
    }
  };
}

module.exports = ExportController;
