import mysql from 'mysql2/promise';
import 'dotenv/config';

export const pool = mysql.createPool({
  uri: process.env.DATABASE_URL,
  decimalNumbers: true,      // DECIMAL columns come back as numbers, not strings
  waitForConnections: true,
  connectionLimit: 10,
});