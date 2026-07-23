const AppError = require("../../../common/AppError");

/**
 * HTTP layer for attendance. Each handler reproduces the original response
 * envelopes exactly; logic lives in AttendanceService / PayrollService.
 */
class AttendanceController {
  constructor({ attendanceService, payrollService }) {
    this.attendanceService = attendanceService;
    this.payrollService = payrollService;
  }

  // Common Error Handler helper to avoid DRY (Don't Repeat Yourself) violation
  #handleError(res, error, defaultMessage = "Internal Server Error") {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
      });
    }
    console.error("❌ Controller Error:", error);
    return res.status(500).json({
      success: false,
      message: defaultMessage,
    });
  }

  handleCheckIn = async (req, res) => {
    try {
      if (!req.user?.id) {
        return res
          .status(401)
          .json({ success: false, message: "Unauthorized." });
      }

      // Safe destructuring with fallback
      const { employee_ids, latitude, longitude } = req.body || {};

      const { records, location, address } =
        await this.attendanceService.checkIn({
          requesterUserId: req.user.id,
          employee_ids,
          latitude,
          longitude,
        });

      return res.status(201).json({
        success: true,
        message: `${records.length} logo ka Check-in successfully ho gaya.`,
        location,
        address,
        data: records,
      });
    } catch (error) {
      return this.#handleError(res, error, "Check-in processing failed.");
    }
  };

  handleCheckOut = async (req, res) => {
    try {
      if (!req.user?.id) {
        return res
          .status(401)
          .json({ success: false, message: "Unauthorized." });
      }

      const { employee_ids, latitude, longitude } = req.body || {};

      const { records, location } = await this.attendanceService.checkOut({
        requesterUserId: req.user.id,
        employee_ids,
        latitude,
        longitude,
      });

      return res.status(201).json({
        success: true,
        message: `${records.length} logo ka Check-out recorded.`,
        location,
        data: records,
      });
    } catch (error) {
      return this.#handleError(res, error, "Check-out processing failed.");
    }
  };

  getTeamMembers = async (req, res) => {
    try {
      if (!req.user?.hrm_employee_id) {
        return res
          .status(400)
          .json({
            success: false,
            message: "Employee ID missing in user token.",
          });
      }

      const teamMembers = await this.attendanceService.getTeamMembers(
        req.user.hrm_employee_id,
      );
      return res.status(200).json({
        success: true,
        count: teamMembers.length,
        teamMembers,
      });
    } catch (error) {
      return this.#handleError(res, error, "Failed to fetch team members.");
    }
  };

  getAttendanceData = async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const data = await this.attendanceService.getAttendanceData({
        startDate,
        endDate,
        userId: req.user?.id,
        role: req.user?.role,
      });
      return res.status(200).json({
        success: true,
        count: data.length,
        data,
      });
    } catch (error) {
      return this.#handleError(
        res,
        error,
        "Failed to generate attendance report.",
      );
    }
  };

  getAllAttendanceData = async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const attendance = await this.attendanceService.getAllAttendanceData({
        startDate,
        endDate,
      });
      return res.status(200).json({
        success: true,
        count: attendance.length,
        attendance,
      });
    } catch (error) {
      return this.#handleError(
        res,
        error,
        "Failed to fetch all attendance data.",
      );
    }
  };

  getFilteredAttendance = async (req, res) => {
    try {
      const { startDate, endDate, employeeId } = req.query;
      const { report, start, end } =
        await this.attendanceService.getFilteredAttendance({
          startDate,
          endDate,
          employeeId,
          userId: req.user?.id,
          role: req.user?.role,
        });
      return res.status(200).json({
        success: true,
        results: report.length,
        dateRange: { from: start, to: end },
        data: report,
      });
    } catch (error) {
      return this.#handleError(
        res,
        error,
        "Failed to filter attendance records.",
      );
    }
  };

  getMonthlyPayrollReport = async (req, res) => {
    try {
      const { month } = req.query;
      const payroll = await this.payrollService.getMonthlyPayroll(month);
      return res.status(200).json({
        success: true,
        payroll,
      });
    } catch (error) {
      return this.#handleError(
        res,
        error,
        "Failed to generate payroll report.",
      );
    }
  };
}

module.exports = AttendanceController;
