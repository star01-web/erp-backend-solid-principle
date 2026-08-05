const express = require("express");
const router = express.Router();

const asyncHandler = require("../../../common/asyncHandler");
const validate = require("../../../common/validate");
const cacheMiddleware = require("../../../common/cache.middleware");
const {
  verifyToken,
  authorizeRoles,
} = require("../../auth/middleware/authMiddleware");

const {
  createProjectSchema,
  updateProjectSchema,
  projectOutwardSchema,
  projectTransferSchema,
} = require("../validators/project.validator");

// Composition Root exports
const {
  projectController,
  projectOutwardController,
  projectTransferController,
} = require("../inventory.module");

const canManageInventory = authorizeRoles(
  "ADMIN",
  "INVENTORY_MANAGER",
  "FACTORY_MANAGER"
);

// --- PROJECT CRUD & VISIBILITY ---

router.post(
  "/projects",
  verifyToken,
  canManageInventory,
  validate(createProjectSchema, { withSuccess: true }),
  asyncHandler((req, res, next) => projectController.createProject(req, res, next))
);

router.get(
  "/projects",
  verifyToken,
  cacheMiddleware({ ttl: 7200 }),
  asyncHandler((req, res, next) => projectController.getAllProjects(req, res, next))
);

router.get(
  "/projects/:id",
  verifyToken,
  asyncHandler((req, res, next) => projectController.getProjectById(req, res, next))
);

router.put(
  "/projects/:id",
  verifyToken,
  canManageInventory,
  validate(updateProjectSchema, { withSuccess: true }),
  asyncHandler((req, res, next) => projectController.updateProject(req, res, next))
);

router.patch(
  "/projects/:id/toggle-status",
  verifyToken,
  canManageInventory,
  asyncHandler((req, res, next) => projectController.toggleStatus(req, res, next))
);

router.get(
  "/projects/:id/stock",
  verifyToken,
  cacheMiddleware({ ttl: 7200 }),
  asyncHandler((req, res, next) => projectController.getProjectStock(req, res, next))
);

router.get(
  "/projects/:id/sites",
  verifyToken,
  asyncHandler((req, res, next) => projectController.getProjectSites(req, res, next))
);

// --- WAREHOUSE TO PROJECT OUTWARD ---

router.post(
  "/project-outward",
  verifyToken,
  canManageInventory,
  validate(projectOutwardSchema, { withSuccess: true }),
  asyncHandler((req, res, next) =>
    projectOutwardController.processProjectOutward(req, res, next)
  )
);

// --- PROJECT TO PROJECT TRANSFER ---

router.post(
  "/project-transfer",
  verifyToken,
  canManageInventory,
  validate(projectTransferSchema, { withSuccess: true }),
  asyncHandler((req, res, next) =>
    projectTransferController.transferBetweenProjects(req, res, next)
  )
);

module.exports = router;
