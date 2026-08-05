const express = require("express");
const router = express.Router();
const asyncHandler = require("../../../common/asyncHandler");
const validate = require("../../../common/validate");
const { loginSchema } = require("../validators/auth.validator");
const { authController } = require("../auth.module");

const rateLimit = require("express-rate-limit");

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 login requests per 15 mins
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many login attempts. Please try again after 15 minutes.",
  },
});

// auth routes
router.post(
  "/login",
  loginLimiter,
  validate(loginSchema, { withSuccess: true }),
  asyncHandler(authController.login),
);

module.exports = router;
