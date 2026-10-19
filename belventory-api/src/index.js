import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import 'dotenv/config';
import { pool } from './db.js';

const app = express();
app.set('trust proxy', 1); // Railway sits behind a proxy
app.use(helmet());
app.use(express.json({ limit: '12mb' })); // item photos arrive as data URLs
const origins = (process.env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({ origin: origins }));

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET is required');

// ---------- helpers ----------
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
const httpError = (status, message) => Object.assign(new Error(message), { status });

const auth = (req, _res, next) => {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { next(httpError(401, 'Please sign in again.')); }
};
const adminOnly = (req, _res, next) => req.user.role === 'admin' ? next() : next(httpError(403, 'Admin access required.'));
// Admins can see every store (your header store picker); employees only their own.
const canAccess = (user, locationId) => user.role === 'admin' || Number(user.locationId) === Number(locationId);

const toItem = r => ({
  id: r.id, locationId: r.location_id,
  name: r.name, nameFr: r.name_fr || '', nameEn: r.name_en || '',
  category: r.category, categoryFr: r.category_fr || '', categoryEn: r.category_en || '',
  description: r.description || '', descriptionFr: r.description_fr || '', descriptionEn: r.description_en || '',
  unit: r.unit, unitFr: r.unit_fr || '', unitEn: r.unit_en || '',
  image: r.image || '', icon: r.icon || '',
  initialStock: r.initial_stock, stock: r.stock, dailyUsage: r.daily_usage, minThreshold: r.min_threshold,
  requestedOrderUnits: r.requested_order_units,
  orderStatus: r.order_status === 'none' ? null : r.order_status,
  approvedOrderUnits: r.approved_order_units, unitPrice: r.unit_price, isNew: !!r.is_new,
});

// camelCase API field -> column. Whitelist = no SQL injection through column names.
const ITEM_COLS = {
  name: 'name', nameFr: 'name_fr', nameEn: 'name_en', category: 'category', categoryFr: 'category_fr', categoryEn: 'category_en',
  description: 'description', descriptionFr: 'description_fr', descriptionEn: 'description_en',
  unit: 'unit', unitFr: 'unit_fr', unitEn: 'unit_en', image: 'image', icon: 'icon',
  initialStock: 'initial_stock', stock: 'stock', dailyUsage: 'daily_usage', minThreshold: 'min_threshold', unitPrice: 'unit_price',
};
const NUMERIC = new Set(['initialStock', 'stock', 'dailyUsage', 'minThreshold', 'unitPrice']);

function pickItemFields(body) {
  const out = {};
  for (const [key, col] of Object.entries(ITEM_COLS)) {
    if (body[key] === undefined) continue;
    if (NUMERIC.has(key)) {
      const n = Number(body[key]);
      if (!Number.isFinite(n) || n < 0) throw httpError(400, `${key} must be a number ≥ 0`);
      out[col] = n;
    } else out[col] = String(body[key]);
  }
  return out;
}

async function getItem(id, { includeDeleted = false } = {}) {
  const [rows] = await pool.query(`SELECT * FROM items WHERE id=? ${includeDeleted ? '' : 'AND deleted_at IS NULL'}`, [id]);
  if (!rows[0]) throw httpError(404, 'Item not found.');
  return rows[0];
}
const scopedItem = async (req, opts) => {
  const row = await getItem(req.params.id, opts);
  if (!canAccess(req.user, row.location_id)) throw httpError(403, 'Not allowed for this store.');
  return row;
};

// ---------- public ----------
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Only names/addresses so the login screen can show the store dropdown
app.get('/api/locations/public', wrap(async (_req, res) => {
  const [rows] = await pool.query('SELECT id, name, address FROM locations ORDER BY id');
  res.json(rows);
}));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in a few minutes.' } });
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12); // keeps timing similar when the email is unknown

app.post('/api/auth/login', loginLimiter, wrap(async (req, res) => {
  const { locationId, role, email = '', password = '' } = req.body || {};
  if (!['admin', 'user'].includes(role)) throw httpError(400, 'Invalid role.');
  const [rows] = await pool.query(
    'SELECT * FROM users WHERE location_id=? AND role=? AND email=?', [locationId, role, String(email).trim().toLowerCase()]);
  const user = rows[0];
  const ok = await bcrypt.compare(String(password), user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) throw httpError(401, 'Email or password does not match.');
  const token = jwt.sign({ sub: user.id, role: user.role, locationId: user.location_id }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, user: { id: user.id, role: user.role, email: user.email, locationId: user.location_id } });
}));

// ---------- everything below needs a valid token ----------
app.use('/api', auth);

app.get('/api/auth/me', (req, res) => res.json({ user: req.user }));

// Locations
app.get('/api/locations', wrap(async (req, res) => {
  const [rows] = req.user.role === 'admin'
    ? await pool.query('SELECT id, name, address FROM locations ORDER BY id')
    : await pool.query('SELECT id, name, address FROM locations WHERE id=?', [req.user.locationId]);
  res.json(rows);
}));

app.post('/api/locations', adminOnly, wrap(async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) throw httpError(400, 'Location name is required.');
  const [r] = await pool.query('INSERT INTO locations (name, address) VALUES (?,?)', [name, String(req.body.address || '').trim()]);
  res.status(201).json({ id: r.insertId, name, address: req.body.address || '' });
}));

app.delete('/api/locations/:id', adminOnly, wrap(async (req, res) => {
  const [[{ n }]] = await pool.query('SELECT COUNT(*) n FROM locations');
  if (n <= 1) throw httpError(400, 'You cannot remove the last store.');
  await pool.query('DELETE FROM locations WHERE id=?', [req.params.id]); // cascades to users + items
  res.json({ ok: true });
}));

// Account management (hashes only; passwords are never returned)
app.get('/api/locations/:id/accounts', adminOnly, wrap(async (req, res) => {
  const [rows] = await pool.query('SELECT role, email FROM users WHERE location_id=?', [req.params.id]);
  const by = Object.fromEntries(rows.map(r => [r.role, { email: r.email, configured: true }]));
  res.json({ admin: by.admin || { email: '', configured: false }, user: by.user || { email: '', configured: false } });
}));

app.put('/api/locations/:id/accounts/:role', adminOnly, wrap(async (req, res) => {
  const { role, id } = req.params;
  if (!['admin', 'user'].includes(role)) throw httpError(400, 'Invalid role.');
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw httpError(400, 'Enter a valid email.');
  const [existing] = await pool.query('SELECT id FROM users WHERE location_id=? AND role=?', [id, role]);
  if (existing[0]) {
    if (password && password.length < 6) throw httpError(400, 'Use a password with at least 6 characters.');
    if (password) await pool.query('UPDATE users SET email=?, password_hash=? WHERE id=?', [email, await bcrypt.hash(password, 12), existing[0].id]);
    else await pool.query('UPDATE users SET email=? WHERE id=?', [email, existing[0].id]);
  } else {
    if (password.length < 6) throw httpError(400, 'Set a password with at least 6 characters.');
    await pool.query('INSERT INTO users (location_id, role, email, password_hash) VALUES (?,?,?,?)', [id, role, email, await bcrypt.hash(password, 12)]);
  }
  res.json({ ok: true });
}));

// Items
app.get('/api/locations/:id/items', wrap(async (req, res) => {
  if (!canAccess(req.user, req.params.id)) throw httpError(403, 'Not allowed for this store.');
  const [rows] = await pool.query('SELECT * FROM items WHERE location_id=? AND deleted_at IS NULL ORDER BY id', [req.params.id]);
  res.json(rows.map(toItem));
}));

app.post('/api/locations/:id/items', adminOnly, wrap(async (req, res) => {
  const fields = pickItemFields(req.body);
  if (!fields.name?.trim()) throw httpError(400, 'Item name is required.');
  fields.category ||= 'Uncategorized';
  const cols = ['location_id', 'is_new', ...Object.keys(fields)];
  const [r] = await pool.query(`INSERT INTO items (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
    [req.params.id, 1, ...Object.values(fields)]);
  res.status(201).json(toItem(await getItem(r.insertId)));
}));

app.patch('/api/items/:id', adminOnly, wrap(async (req, res) => {
  await getItem(req.params.id);
  const fields = pickItemFields(req.body);
  const keys = Object.keys(fields);
  if (keys.length) await pool.query(`UPDATE items SET ${keys.map(k => `${k}=?`).join(',')} WHERE id=?`, [...Object.values(fields), req.params.id]);
  res.json(toItem(await getItem(req.params.id)));
}));

app.patch('/api/items/:id/stock', wrap(async (req, res) => {
  await scopedItem(req);
  const stock = Number(req.body.stock);
  if (!Number.isFinite(stock) || stock < 0) throw httpError(400, 'Enter a valid quantity of zero or more.');
  await pool.query('UPDATE items SET stock=? WHERE id=?', [stock, req.params.id]);
  res.json(toItem(await getItem(req.params.id)));
}));

app.post('/api/items/:id/request', wrap(async (req, res) => {
  await scopedItem(req);
  const units = Number(req.body.units);
  if (!Number.isFinite(units) || units <= 0) throw httpError(400, 'Requested quantity must be greater than zero.');
  await pool.query("UPDATE items SET requested_order_units=?, order_status='pending', approved_order_units=0 WHERE id=?", [units, req.params.id]);
  res.json(toItem(await getItem(req.params.id)));
}));

app.patch('/api/items/:id/request-units', adminOnly, wrap(async (req, res) => {
  const units = Number(req.body.units);
  if (!Number.isFinite(units) || units <= 0) throw httpError(400, 'Quantity must be greater than zero.');
  await getItem(req.params.id);
  await pool.query('UPDATE items SET requested_order_units=? WHERE id=?', [units, req.params.id]);
  res.json(toItem(await getItem(req.params.id)));
}));

app.post('/api/items/:id/approve', adminOnly, wrap(async (req, res) => {
  const row = await getItem(req.params.id);
  if (row.requested_order_units <= 0) throw httpError(400, 'No pending request.');
  await pool.query("UPDATE items SET approved_order_units=requested_order_units, requested_order_units=0, order_status='approved' WHERE id=?", [req.params.id]);
  res.json(toItem(await getItem(req.params.id)));
}));

app.post('/api/locations/:id/approve-all', adminOnly, wrap(async (req, res) => {
  await pool.query("UPDATE items SET approved_order_units=requested_order_units, requested_order_units=0, order_status='approved' WHERE location_id=? AND requested_order_units>0 AND deleted_at IS NULL", [req.params.id]);
  const [rows] = await pool.query('SELECT * FROM items WHERE location_id=? AND deleted_at IS NULL ORDER BY id', [req.params.id]);
  res.json(rows.map(toItem));
}));

// Soft delete + restore ("Recently Deleted")
app.delete('/api/items/:id', adminOnly, wrap(async (req, res) => {
  await getItem(req.params.id);
  await pool.query('UPDATE items SET deleted_at=NOW() WHERE id=?', [req.params.id]);
  res.json({ ok: true });
}));
app.post('/api/items/:id/restore', adminOnly, wrap(async (req, res) => {
  await getItem(req.params.id, { includeDeleted: true });
  await pool.query('UPDATE items SET deleted_at=NULL WHERE id=?', [req.params.id]);
  res.json(toItem(await getItem(req.params.id)));
}));
app.get('/api/deleted-items', adminOnly, wrap(async (_req, res) => {
  const [rows] = await pool.query('SELECT * FROM items WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC');
  res.json(rows.map(r => ({ deleteId: String(r.id), locationId: r.location_id, item: toItem(r) })));
}));

// ---------- errors ----------
app.use((err, _req, res, _next) => {
  if (!err.status) console.error(err);
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong.' });
});

app.listen(process.env.PORT || 3000, () => console.log('Belventory API listening'));