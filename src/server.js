const sequelize = require("./common/db.config");
const db = require("./common/index.db");
const app = require("./app");
const HOST = process.env.SYSTEM_IP || "localhost";
const startServer = async () => {
  const PORT = process.env.PORT || 3000;

  // Bind the port FIRST so Hostinger/Passenger detects listen() immediately
  // (its watchdog kills the app if listen() isn't called within 3 seconds).
  app.listen(PORT, () => {
    console.log(` Server is Live`);
  });

  // Then initialize the database. A DB failure no longer prevents listen(),
  // so the app stays up instead of crash-looping.
  try {
    if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_NAME) {
      throw new Error("Database configuration is missing");
    }

    await sequelize.authenticate();
    console.log("✅ Database connected successfully!");

    await db.sequelize.sync({ alter: false });
    console.log(" All models were synchronized successfully.");
  } catch (error) {
    console.error("❌ Database initialization failed");
  }
};

startServer();
