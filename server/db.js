const { Pool } = require("pg");

const pool = new Pool({
  user: process.env.PSQL_USERNAME,
  host: process.env.PSQL_HOSTNAME,
  database: process.env.PSQL_DB_NAME,
  password: process.env.PSQL_PASSWORD,
  port: process.env.PSQL_PORT,
});

module.exports = pool;
