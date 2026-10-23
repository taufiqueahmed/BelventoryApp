import mysql from 'mysql2/promise';
import 'dotenv/config';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
const databaseUrl = new URL(process.env.DATABASE_URL);
const connectionSslMode = (process.env.MYSQL_SSL_MODE || databaseUrl.searchParams.get('ssl-mode') || '').trim().toUpperCase();
const ca = process.env.MYSQL_SSL_CA?.replace(/\\n/g, '\n').trim();
databaseUrl.searchParams.delete('ssl-mode');

if (!['', 'DISABLED', 'REQUIRED', 'VERIFY_CA', 'VERIFY_IDENTITY'].includes(connectionSslMode)) {
  throw new Error(`Unsupported MYSQL_SSL_MODE: ${connectionSslMode}`);
}
if (['VERIFY_CA', 'VERIFY_IDENTITY'].includes(connectionSslMode) && !ca) {
  throw new Error('MYSQL_SSL_CA is required when MYSQL_SSL_MODE verifies the MySQL server certificate.');
}

const ssl = ca
  ? { ca, rejectUnauthorized: true }
  : connectionSslMode === 'REQUIRED'
    ? { rejectUnauthorized: false }
    : undefined;

export const pool = mysql.createPool({
  uri: databaseUrl.toString(),
  ...(ssl ? { ssl } : {}),
  decimalNumbers: true,      // DECIMAL columns come back as numbers, not strings
  waitForConnections: true,
  connectionLimit: 10,
});

