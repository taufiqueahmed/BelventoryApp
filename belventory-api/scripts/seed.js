import bcrypt from 'bcryptjs';
import mysql from 'mysql2/promise';
import 'dotenv/config';

const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
if (!ADMIN_EMAIL || !ADMIN_PASSWORD || ADMIN_PASSWORD.length < 8) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD (8+ chars)');

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const [loc] = await conn.query('INSERT INTO locations (name, address) VALUES (?, ?)', ['Main Store', 'Toronto, ON']);
await conn.query('INSERT INTO users (location_id, role, email, password_hash) VALUES (?, "admin", ?, ?)',
  [loc.insertId, ADMIN_EMAIL.toLowerCase(), await bcrypt.hash(ADMIN_PASSWORD, 12)]);

const sample = [
  ['Buns', 'Fresh & Dairy', 'Pieces', 13], ['Milk', 'Fresh & Dairy', 'Jugs', 7],
  ['Napkins', 'Front Service Supplies & Tools', 'Packs', 12], ['Root Beer', 'Drinks', 'Cases', 12],
];
for (const [name, category, unit, n] of sample)
  await conn.query(
    'INSERT INTO items (location_id,name,category,unit,initial_stock,stock,unit_price) VALUES (?,?,?,?,?,?,1)',
    [loc.insertId, name, category, unit, n, n]);

console.log('Seeded. Admin login:', ADMIN_EMAIL);
await conn.end();