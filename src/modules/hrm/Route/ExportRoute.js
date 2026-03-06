const express = require("express");
const router = express.Router();
// Controller function ka naam wahi rakhein jo aapne ExportController mein export kiya hai
const {
  exportAttendanceWithTemplate,
} = require("../Controller/ExportController");
const { verifyToken } = require("../middleware/verifyToken");

// Middleware for handling async errors
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Route definition
router.get(
  "/export-monthly",
  verifyToken,
  asyncHandler(exportAttendanceWithTemplate),
);

module.exports = router;
