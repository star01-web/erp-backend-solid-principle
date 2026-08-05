const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const morgan = require("morgan");

const authRoutes = require("./modules/auth/routes/auth.route");
const userRoutes = require("./modules/auth/routes/user.route");
const CreateEmployee = require("./modules/hrm/routes/employee.route");
const CreateProjectSite = require("./modules/hrm/routes/projectSite.route");
const attendaceRow = require("./modules/hrm/routes/attendance.route");
const internalAuth = require("./modules/auth/middleware/api.internalAuth");
const exportRoutes = require("./modules/hrm/routes/export.route");
const inventoryRoutes = require("./modules/inventory/Route/inventory.route");
const dispatchLedgerRoutes = require("./modules/inventory/Route/dispatch.route");
// ✅ NEW: Site Route Import
const siteRoutes = require("./modules/inventory/Route/site.route");

const app = express();

// Set default NODE_ENV if missing
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = "production";
}

// --- 1. Middleware ---
// Global Rate Limiter
const globalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 300, // 300 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests, please try again later." },
});
app.use(globalLimiter);

// HTTP Logging
app.use(morgan("combined"));

// Body Parsing Limits
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
  : ["http://localhost:3000", "http://localhost:5173", "http://localhost:8081"];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin && process.env.NODE_ENV !== "production") return callback(null, true);
      if (!origin) return callback(new Error("CORS: Origin header is required in production"));
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS: origin '${origin}' not allowed`));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Internal-Key"],
    credentials: true,
  }),
);

app.options("/", cors());
app.use(
  helmet({
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  }),
);
app.use((req, res, next) => {
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)");
  next();
});

// Enable internalAuth in production if secret configured
if (process.env.NODE_ENV === "production" && process.env.INTERNAL_API_KEY_HASH) {
  app.use(internalAuth);
}

// --- 2. Routes ---
app.get("/", (req, res) => {
  res.send("✅ ERP-Star Backend is Running Successfully!");
});

// app.use(internalAuth); // Internal API Auth Middleware
app.use("/v1/api/auth", authRoutes);
app.use("/v2/api/user", userRoutes);
app.use("/v2/api/employee", CreateEmployee);
app.use("/v2/api/project-site", CreateProjectSite);
app.use("/v2/api/attendance", attendaceRow);
app.use("/v2/api/export", exportRoutes);

// Inventory Module Routes
app.use("/v2/api/inventory", inventoryRoutes);
app.use("/v2/api/inventory", dispatchLedgerRoutes);
const projectRoutes = require("./modules/inventory/Route/project.route");
app.use("/v2/api/inventory", projectRoutes);
// ✅ NEW: Site Route Register (Jo dono tables me data feed karega)
app.use("/v2/api/inventory/site", siteRoutes);

// ✅ NEW: Reports Module Routes
const siteReportRoutes = require("./modules/reports/routes/siteReport.route");
const consumptionReportRoutes = require("./modules/reports/routes/consumptionReport.route");
app.use("/api/v1/reports", siteReportRoutes);
app.use("/v2/api/inventory/reports", siteReportRoutes);
app.use("/v2/api/inventory/reports", consumptionReportRoutes);

// --- 3. Error Handling Middleware ---
app.use((req, res) => {
  res.status(404).json({ message: "❌ Route not found" });
});

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

process.on("unhandledRejection", (reason, promise) => {
  console.error("\n⚠️ Unhandled Rejection:", reason);
  console.error("Promise:", promise);
});

process.on("uncaughtException", (error) => {
  console.error("\n❌ UNCAUGHT EXCEPTION:", error);
  process.exit(1);
});

module.exports = app;
