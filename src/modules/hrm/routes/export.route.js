const express = require("express");
const router = express.Router();
const asyncHandler = require("../../../common/asyncHandler");
const { verifyToken } = require("../../auth/middleware/authMiddleware");
const { exportController } = require("../hrm.module");

router.get(
  "/export-monthly",
  verifyToken,
  asyncHandler(exportController.exportAttendanceWithTemplate),
);

module.exports = router;
