const mysql = require("mysql2");

const db = mysql.createPool(process.env.DATABASE_URL).promise();

module.exports = db;
