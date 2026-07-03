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

  handleCheckIn = async (req, res) => {
    try {
      if (!req.user || !req.user.id)
        return res.status(401).json({ message: "Unauthorized." });

      const { employee_ids, latitude, longitude } = req.body;
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
      if (error instanceof AppError)
        return res.status(error.statusCode).json({ message: error.message });
      console.error("CheckIn Controller Error:", error);
      return res.status(500).json({ message: "Internal Server Error" });
    }
  };

  handleCheckOut = async (req, res) => {
    try {
      if (!req.user?.id)
        return res.status(401).json({ message: "Unauthorized." });

      const { employee_ids, latitude, longitude } = req.body;
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
      if (error instanceof AppError)
        return res.status(error.statusCode).json({ message: error.message });
      console.error("CheckOut Error:", error);
      return res.status(500).json({ message: "Internal Server Error" });
    }
  };

  getTeamMembers = async (req, res) => {
    try {
      const teamMembers = await this.attendanceService.getTeamMembers(
        req.user.hrm_employee_id,
      );
      return res
        .status(200)
        .json({ success: true, count: teamMembers.length, teamMembers });
    } catch (error) {
      console.error("❌ Team Fetch Error:", error);
      return res.status(500).json({ success: false, message: "Server Error" });
    }
  };

  getAttendanceData = async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const data = await this.attendanceService.getAttendanceData({
        startDate,
        endDate,
        userId: req.user.id,
        role: req.user.role,
      });
      return res
        .status(200)
        .json({ success: true, count: data.length, data });
    } catch (error) {
      if (error instanceof AppError)
        return res
          .status(error.statusCode)
          .json({ success: false, message: error.message });
      console.error("Report Error:", error);
      return res
        .status(500)
        .json({ success: false, message: "Internal Server Error" });
    }
  };

  getAllAttendanceData = async (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const attendance = await this.attendanceService.getAllAttendanceData({
        startDate,
        endDate,
      });
      return res
        .status(200)
        .json({ success: true, count: attendance.length, attendance });
    } catch (error) {
      console.error("❌ Attendance Error:", error);
      return res
        .status(500)
        .json({ success: false, message: error.message });
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
          userId: req.user.id,
          role: req.user.role,
        });
      return res.status(200).json({
        success: true,
        results: report.length,
        dateRange: { from: start, to: end },
        data: report,
      });
    } catch (error) {
      if (error instanceof AppError)
        return res
          .status(error.statusCode)
          .json({ success: false, message: error.message });
      console.error("Filter API Error:", error);
      return res.status(500).json({
        success: false,
        message: "Server Error",
        error: error.message,
      });
    }
  };

  getMonthlyPayrollReport = async (req, res) => {
    try {
      const { month } = req.query;
      const payroll = await this.payrollService.getMonthlyPayroll(month);
      return res.status(200).json({ success: true, payroll });
    } catch (error) {
      if (error instanceof AppError)
        return res
          .status(error.statusCode)
          .json({ success: false, message: error.message });
      console.error("Payroll Error:", error);
      return res
        .status(500)
        .json({ success: false, message: error.message });
    }
  };
}

module.exports = AttendanceController;
