const express = require("express");
const router = express.Router();
const asyncHandler = require("../../../common/asyncHandler");
const validate = require("../../../common/validate");
const {
  verifyToken,
  authorizeRoles,
} = require("../../auth/middleware/authMiddleware");
const { createOfficeLocationSchema } = require("../validators/officeLocation.validator");
const { officeLocationController } = require("../hrm.module");

// Location management sirf ADMIN/HR ke liye; listing kisi bhi logged-in user ke liye
router.post(
  "/create-office-location",
  verifyToken,
  authorizeRoles("ADMIN", "HR"),
  validate(createOfficeLocationSchema),
  asyncHandler(officeLocationController.createOfficeLocation),
);
router.put(
  "/update-office-location/:id",
  verifyToken,
  authorizeRoles("ADMIN", "HR"),
  asyncHandler(officeLocationController.updateOfficeLocation),
);
router.get(
  "/get-all-locations",
  verifyToken,
  asyncHandler(officeLocationController.getAllLocations),
);
router.delete(
  "/delete-office-location/:id",
  verifyToken,
  authorizeRoles("ADMIN", "HR"),
  asyncHandler(officeLocationController.deleteOfficeLocation),
);

module.exports = router;
