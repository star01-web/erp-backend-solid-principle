const path = require("path");

const envPath = path.resolve(__dirname, "../../.env");
require("dotenv").config({ path: envPath, override: true, quiet: true });

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
