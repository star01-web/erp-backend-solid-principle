const { z } = require("zod");

// Required string that rejects both missing and empty, with one custom message.
const requiredString = (message) =>
  z.string({ error: message }).trim().min(1, { message });

// Login: previously unvalidated; zod now returns 400 (was 500) on missing fields.
const loginSchema = z
  .object({
    email: requiredString("Email is required"),
    password: requiredString("Password is required"),
  })
  .loose();

const registerSchema = z
  .object({
    name: requiredString("Name is required"),
    email: requiredString("Email is required"),
    username: requiredString("Username is required"),
    password: requiredString("Password is required"),
    role: requiredString("Role is required"),
  })
  .loose();

const changePasswordSchema = z
  .object({
    oldPassword: requiredString("Both old and new passwords are required"),
    newPassword: requiredString("Both old and new passwords are required"),
  })
  .loose();

// Self-service profile update: `role` is intentionally NOT accepted here — a
// user must never be able to change their own role. Role changes go through the
// ADMIN/HR-guarded employee-update endpoint instead.
const updateProfileSchema = z
  .object({
    name: z.string().trim().optional(),
    email: z.string().trim().optional(),
  })
  .loose();

module.exports = {
  loginSchema,
  registerSchema,
  changePasswordSchema,
  updateProfileSchema,
};
