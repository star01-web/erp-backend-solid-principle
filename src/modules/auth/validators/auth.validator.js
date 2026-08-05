const { z } = require("zod");

// Required string that rejects both missing and empty, with one custom message.
const requiredString = (message) =>
  z.string({ error: message }).trim().min(1, { message });

const passwordValidation = z
  .string({ error: "Password is required" })
  .min(8, "Password must be at least 8 characters long")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[0-9]/, "Password must contain at least one number")
  .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character");

// Login: previously unvalidated; zod now returns 400 (was 500) on missing fields.
const loginSchema = z
  .object({
    email: requiredString("Email is required").email("Valid email is required"),
    password: requiredString("Password is required"),
  })
  .strict();

const registerSchema = z
  .object({
    name: requiredString("Name is required"),
    email: requiredString("Email is required").email("Valid email is required"),
    username: requiredString("Username is required"),
    password: passwordValidation,
    role: requiredString("Role is required"),
  })
  .strict();

const changePasswordSchema = z
  .object({
    oldPassword: requiredString("Old password is required"),
    newPassword: passwordValidation,
  })
  .strict();

// Self-service profile update: `role` is intentionally NOT accepted here — a
// user must never be able to change their own role. Role changes go through the
// ADMIN/HR-guarded employee-update endpoint instead.
const updateProfileSchema = z
  .object({
    name: z.string().trim().optional(),
    email: z.string().trim().email("Valid email is required").optional(),
  })
  .strict();

module.exports = {
  loginSchema,
  registerSchema,
  changePasswordSchema,
  updateProfileSchema,
};
