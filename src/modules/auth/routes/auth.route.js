const express = require("express");
const router = express.Router();
const asyncHandler = require("../../../common/asyncHandler");
const validate = require("../../../common/validate");
const { loginSchema } = require("../validators/auth.validator");
const { authController } = require("../auth.module");

// auth routes
router.post(
  "/login",
  validate(loginSchema, { withSuccess: true }),
  asyncHandler(authController.login),
);

module.exports = router;
