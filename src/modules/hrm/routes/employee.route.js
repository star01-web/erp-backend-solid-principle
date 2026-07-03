const express = require("express");
const router = express.Router();
const asyncHandler = require("../../../common/asyncHandler");
const validate = require("../../../common/validate");
const {
  verifyToken,
  authorizeRoles,
} = require("../../auth/middleware/authMiddleware");
const {
  createEmployeeSchema,
  bulkCreateEmployeesSchema,
} = require("../validators/employee.validator");
const { employeeController } = require("../hrm.module");

// Employee management (create/update/list) sirf ADMIN/HR ke liye
router.post(
  "/create-employee",
  verifyToken,
  authorizeRoles("ADMIN", "HR"),
  validate(createEmployeeSchema),
  asyncHandler(employeeController.CreateEmployee),
);
router.post(
  "/create-bulk-employee",
  verifyToken,
  authorizeRoles("ADMIN", "HR"),
  validate(bulkCreateEmployeesSchema),
  asyncHandler(employeeController.bulkCreateEmployees),
);
router.put(
  "/update-employee/:id",
  verifyToken,
  authorizeRoles("ADMIN", "HR"),
  asyncHandler(employeeController.updateEmployee),
);
router.get(
  "/get-all-employees",
  verifyToken,
  authorizeRoles("ADMIN", "HR"),
  asyncHandler(employeeController.getallEmployee),
);
// Logged-in user apni hi profile dekh sakta hai
router.get(
  "/get-user-profile",
  verifyToken,
  asyncHandler(employeeController.getEmployeeProfile),
);

module.exports = router;
