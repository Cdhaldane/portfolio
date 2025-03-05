// config/config.js
require("dotenv").config();

module.exports = {
  development: {
    username: process.env.PSQL_USERNAME,
    password: process.env.PSQL_PASSWORD,
    database: process.env.PSQL_DB_NAME,
    host: process.env.PSQL_HOSTNAME,
    port: process.env.PSQL_PORT,
    dialect: "postgres",
  },
  test: {
    username: process.env.PSQL_USERNAME,
    password: process.env.PSQL_PASSWORD,
    database: process.env.PSQL_DB_NAME,
    host: process.env.PSQL_HOSTNAME,
    port: process.env.PSQL_PORT,
    dialect: "postgres",
  },
  production: {
    username: process.env.PSQL_USERNAME,
    password: process.env.PSQL_PASSWORD,
    database: process.env.PSQL_DB_NAME,
    host: process.env.PSQL_HOSTNAME,
    port: process.env.PSQL_PORT,
    dialect: "postgres",
  },
};
