const { z } = require("zod");

const REQUIRED_MSG =
  "Zaroori fields missing hain (Email, Password, Name, Location).";

const required = z.string({ error: REQUIRED_MSG }).trim().min(1, REQUIRED_MSG);

// Mirrors the controller's presence check; other fields pass through untouched.
const createEmployeeSchema = z
  .object({
    name: required,
    email: required,
    password: required,
    location_id: z.union([z.string(), z.number()], { error: REQUIRED_MSG }),
  })
  .loose();

// Body is an array of employee objects; only the array-shape is enforced here
// (per-item validation stays in the service so its 500 envelope is preserved).
const bulkCreateEmployeesSchema = z
  .array(z.any(), {
    error: "Data ek valid Array of Objects format mein hona chahiye.",
  })
  .min(1, "Data ek valid Array of Objects format mein hona chahiye.");

module.exports = { createEmployeeSchema, bulkCreateEmployeesSchema };
