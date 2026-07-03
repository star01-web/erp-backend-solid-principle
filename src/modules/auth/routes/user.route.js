const express = require("express");
const router = express.Router();
const asyncHandler = require("../../../common/asyncHandler");
const validate = require("../../../common/validate");
const {
  registerSchema,
  changePasswordSchema,
  updateProfileSchema,
} = require("../validators/auth.validator");
const { verifyToken } = require("../middleware/authMiddleware");
const { userController } = require("../auth.module");

// user routes
router.post(
  "/register",
  validate(registerSchema),
  asyncHandler(userController.Registration),
);
router.get("/profile", verifyToken, asyncHandler(userController.Profile));
router.put(
  "/change-password",
  verifyToken,
  validate(changePasswordSchema),
  asyncHandler(userController.ChangePassword),
);
router.put(
  "/update-profile/:id",
  verifyToken,
  validate(updateProfileSchema),
  asyncHandler(userController.updateProfile),
);
router.post("/logout", verifyToken, asyncHandler(userController.logout));

module.exports = router;
