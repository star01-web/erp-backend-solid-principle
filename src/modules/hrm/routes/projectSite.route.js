const express = require("express");
const router = express.Router();
const asyncHandler = require("../../../common/asyncHandler");
const validate = require("../../../common/validate");
const {
  verifyToken,
  authorizeRoles,
} = require("../../auth/middleware/authMiddleware");
const { createProjectSiteSchema } = require("../validators/projectSite.validator");
const { projectSiteController } = require("../hrm.module");

// Site management sirf ADMIN/HR ke liye; listing kisi bhi logged-in user ke liye
router.post(
  "/create-project-site",
  verifyToken,
  authorizeRoles("ADMIN", "HR"),
  validate(createProjectSiteSchema),
  asyncHandler(projectSiteController.createProjectSite),
);
router.put(
  "/update-project-site/:id",
  verifyToken,
  authorizeRoles("ADMIN", "HR"),
  asyncHandler(projectSiteController.updateProjectSite),
);
router.get(
  "/get-all-project-sites",
  verifyToken,
  asyncHandler(projectSiteController.getAllProjectSites),
);
router.delete(
  "/delete-project-site/:id",
  verifyToken,
  authorizeRoles("ADMIN", "HR"),
  asyncHandler(projectSiteController.deleteProjectSite),
);

module.exports = router;
