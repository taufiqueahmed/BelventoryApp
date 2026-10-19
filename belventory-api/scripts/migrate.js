import fs from 'fs';
import mysql from 'mysql2/promise';
import 'dotenv/config';

const conn = await mysql.createConnection({ uri: process.env.DATABASE_URL, multipleStatements: true });
await conn.query(fs.readFileSync(new URL('../sql/schema.sql', import.meta.url), 'utf8'));
console.log('Schema applied');
await conn.end();