const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const authRoutes = require("./modules/auth/route/auth.route");
const userRoutes = require("./modules/auth/route/user.route");
const CreateEmployee = require("./modules/hrm/Route/emp_route");
const CreateOfficeLocation = require("./modules/hrm/Route/Office_Location_Route");
const attendaceRow = require("./modules/hrm/Route/Checkin_CheckOut_Route");
const internalAuth = require("./modules/auth/middleware/api.internalAuth");
const exportRoutes = require("./modules/hrm/Route/ExportRoute");
const inventoryRoutes = require("./modules/inventory/Route/inventory.route");
const app = express();

// --- Error Wrapper for Async Routes ---
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// --- 1. Middleware ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : ["http://localhost:3000", "http://localhost:5173", "http://localhost:8081"];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, Postman)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin '${origin}' not allowed`));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);
// Ensure preflight OPTIONS requests are handled before other middleware
app.options("/", cors());
app.use(helmet());
// --- 2. Routes ---
app.get("/", (req, res) => {
  res.send("✅ ERP-Star Backend is Running Successfully!");
});

// app.use(internalAuth); // Internal API Auth Middleware
app.use("/v1/api/auth", authRoutes);
app.use("/v2/api/user", userRoutes);
app.use("/v2/api/employee", CreateEmployee);
app.use("/v2/api/office-location", CreateOfficeLocation);
app.use("/v2/api/attendance", attendaceRow);
app.use("/v2/api/export", exportRoutes);

// Inventory Module Routes
app.use("/v2/api/inventory", inventoryRoutes);

// --- 3. Error Handling Middleware ---
// 404 Handler
app.use((req, res) => {
  res.status(404).json({ message: "❌ Route not found" });
});

// Global Error Handler (MUST be last)
app.use((err, req, res, next) => {
  const statusCode = err.status || err.statusCode || 500;
  const errorMessage = err.message || "Internal Server Error";

  console.error("\n🔴 CRASH DETECTED:");
  console.error(`Status: ${statusCode}`);
  console.error(`Message: ${errorMessage}`);
  console.error(`Stack: ${err.stack}\n`);

  res.status(statusCode).json({
    success: false,
    message:
      process.env.NODE_ENV === "production"
        ? "Something went wrong!"
        : errorMessage,
    ...(process.env.NODE_ENV !== "production" && { error: err.stack }),
  });
});

// Handle Unhandled Promise Rejections
process.on("unhandledRejection", (reason, promise) => {
  console.error("\n⚠️ Unhandled Rejection:", reason);
  console.error("Promise:", promise);
});

// Handle Uncaught Exceptions
process.on("uncaughtException", (error) => {
  console.error("\n❌ UNCAUGHT EXCEPTION:", error);
  process.exit(1);
});

module.exports = app;
