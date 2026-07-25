const express = require("express");
const router = express.Router();
const {
  createSite,
  getAllSites,
  getSiteById,
  updateSite,
  deleteSite,
} = require("../inventory_controller/newSite.Controller");

// Routes
router.post("/create", createSite); // Dono tables me entry karega
router.get("/", getAllSites); // Saari sites list karega
router.get("/:id", getSiteById); // ID se ek site fetch karega
router.put("/update/:id", updateSite); // Details update karega
router.delete("/delete/:id", deleteSite); // Soft delete karega

module.exports = router;
