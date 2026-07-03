const express = require("express");
const router = express.Router();
const asyncHandler = require("../../../common/asyncHandler");
const validate = require("../../../common/validate");
const { verifyToken } = require("../../auth/middleware/authMiddleware");
const { checkinSchema, checkoutSchema } = require("../validators/attendance.validator");
const { attendanceController } = require("../hrm.module");

router.post(
  "/checkin",
  verifyToken,
  validate(checkinSchema),
  asyncHandler(attendanceController.handleCheckIn),
);
router.post(
  "/checkout",
  verifyToken,
  validate(checkoutSchema),
  asyncHandler(attendanceController.handleCheckOut),
);
router.get(
  "/attandace-data",
  verifyToken,
  asyncHandler(attendanceController.getAttendanceData),
);
router.get(
  "/team-members",
  verifyToken,
  asyncHandler(attendanceController.getTeamMembers),
);
router.get(
  "/filtered-attendance",
  verifyToken,
  asyncHandler(attendanceController.getFilteredAttendance),
);
router.get(
  "/full-attendance-report",
  verifyToken,
  asyncHandler(attendanceController.getAllAttendanceData),
);
router.get(
  "/monthly-payroll-report",
  verifyToken,
  asyncHandler(attendanceController.getMonthlyPayrollReport),
);

module.exports = router;
