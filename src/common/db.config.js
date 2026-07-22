const path = require("path");
const fs = require("fs");

const envPath = path.resolve(__dirname, "../../.env");
console.log(`[env] resolving .env at: ${envPath} | exists: ${fs.existsSync(envPath)}`);
const dotenvResult = require("dotenv").config({ path: envPath, override: true });
if (dotenvResult.error) {
  console.error(`[env] dotenv failed to load: ${dotenvResult.error.message}`);
}
// Diagnostic: confirm the DB vars actually reached process.env (password intentionally omitted)
console.log(
  `[env] DB_HOST=${process.env.DB_HOST} DB_USER=${process.env.DB_USER} DB_NAME=${process.env.DB_NAME}`,
);

const { Sequelize } = require("sequelize");

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    dialect: "mysql",
    timezone: "+05:30",
    dialectOptions: {
      dateStrings: true,
      typeCast: true,
    },
    logging: false,
  },
);

module.exports = sequelize;
