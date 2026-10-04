const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const PORT = process.env.PORT || 10000;
const HOST = '0.0.0.0';
const HTML_FILE = path.join(__dirname, 'index.html');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL tanımlı değil. Render PostgreSQL bağlantısını eklemelisin.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
});

const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

const DEFAULT_STOCKS = [
  { symbol: 'EYEM', name: 'EYEM Holding A.Ş', price: 121.34, stock: 5000, clicks: 0 },
  { symbol: 'EYMS', name: 'eymensoft Bilişim LTD.', price: 19.21, stock: 3500, clicks: 0 },
  { symbol: 'EMRD', name: 'Emir Deniz ve Taş Ürünü LTD.', price: 2.55, stock: 10000, clicks: 0 },
  { symbol: 'EMZA', name: 'EMZA Teknoloji, Yatırım A.Ş', price: 7.77, stock: 4200, clicks: 0 },
  { symbol: 'EMRZ', name: 'e-MİRZA Ticaret LTD.', price: 19.99, stock: 2500, clicks: 0 },
  { symbol: 'FTKR', name: 'Futkart Stadyum Yönetimi A.Ş', price: 2.18, stock: 8000, clicks: 0 },
  { symbol: 'MERZ', name: 'merzifon Oyun ve Yazılım LTD.', price: 7.43, stock: 6000, clicks: 0 },
  { symbol: 'EYFN', name: 'EYEM Finans LTD.', price: 98.32, stock: 1500, clicks: 0 },
  { symbol: 'KTPL', name: 'KÜTPlus Turizm, Yazılım A.Ş', price: 1.99, stock: 12000, clicks: 0 },
  { symbol: 'HBDA', name: 'Haskayman Bilim ve Teknoloji A.O', price: 29.01, stock: 3000, clicks: 0 },
  { symbol: 'EYUL', name: 'Eyemören Ulaşım A.Ş', price: 18.71, stock: 4500, clicks: 0 },
  { symbol: 'ANTR', name: 'Anatolia Enerji Yönetim A.Ş', price: 1.17, stock: 15000, clicks: 0 }
];

function send(res, status, data, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) req.destroy();
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error('Geçersiz JSON')); }
    });
    req.on('error', reject);
  });
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
      resolve({ salt, hash: derivedKey.toString('hex') });
    });
  });
}

function verifyPassword(password, salt, expectedHash) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
      const actual = derivedKey.toString('hex');
      resolve(crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expectedHash, 'hex')));
    });
  });
}

function makeToken(userId) {
  const payload = Buffer.from(JSON.stringify({ userId, iat: Date.now() })).toString('base64url');
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function readToken(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  return auth.slice(7);
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.userId || null;
  } catch { return null; }
}

function newCard() {
  let number = '';
  for (let i = 0; i < 16; i++) number += crypto.randomInt(0, 10);
  return {
    id: crypto.randomUUID(),
    number,
    balance: 3000,
    createdAt: new Date().toISOString()
  };
}

function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    balance: Number(row.balance || 0),
    cards: row.cards || [],
    portfolio: row.portfolio || {},
    watchlist: row.watchlist || [],
    createdAt: row.created_at
  };
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS eyem_users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      balance NUMERIC NOT NULL DEFAULT 0,
      cards JSONB NOT NULL DEFAULT '[]'::jsonb,
      portfolio JSONB NOT NULL DEFAULT '{}'::jsonb,
      watchlist JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS eyem_market (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      stocks JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(
    `INSERT INTO eyem_market (id, stocks) VALUES (1, $1::jsonb) ON CONFLICT (id) DO NOTHING`,
    [JSON.stringify(DEFAULT_STOCKS)]
  );
}

async function getUser(userId) {
  const result = await pool.query('SELECT * FROM eyem_users WHERE id = $1', [userId]);
  return result.rows[0] || null;
}

async function ensureCard(row) {
  let cards = Array.isArray(row.cards) ? row.cards : [];
  if (!cards.length) {
    cards = [newCard()];
    await pool.query(
      'UPDATE eyem_users SET cards = $1::jsonb, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(cards), row.id]
    );
    row.cards = cards;
  }
  return row;
}

async function updateUserFromClient(row, body) {
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : row.name;
  const balance = Number.isFinite(Number(body.balance)) ? Number(body.balance) : Number(row.balance || 0);
  const cards = Array.isArray(body.cards) ? body.cards : row.cards;
  const portfolio = body.portfolio && typeof body.portfolio === 'object' ? body.portfolio : row.portfolio;
  const watchlist = Array.isArray(body.watchlist) ? body.watchlist : row.watchlist;

  const result = await pool.query(
    `UPDATE eyem_users
     SET name = $1, balance = $2, cards = $3::jsonb, portfolio = $4::jsonb, watchlist = $5::jsonb, updated_at = NOW()
     WHERE id = $6
     RETURNING *`,
    [name, balance, JSON.stringify(cards), JSON.stringify(portfolio), JSON.stringify(watchlist), row.id]
  );
  return result.rows[0];
}

async function getMarket() {
  const result = await pool.query('SELECT stocks, updated_at FROM eyem_market WHERE id = 1');
  return result.rows[0];
}

async function updateMarket() {
  const row = await getMarket();
  const stocks = Array.isArray(row.stocks) ? row.stocks : DEFAULT_STOCKS;
  stocks.forEach(stock => {
    const change = Math.random() < 0.5 ? -0.01 : 0.01;
    const next = Number((Number(stock.price) + change).toFixed(2));
    if (next > 0.01) stock.price = next;
  });
  await pool.query('UPDATE eyem_market SET stocks = $1::jsonb, updated_at = NOW() WHERE id = 1', [JSON.stringify(stocks)]);
}

async function route(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'GET' && req.url === '/') {
    if (!fs.existsSync(HTML_FILE)) { res.writeHead(404); res.end('HTML bulunamadı.'); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(HTML_FILE));
    return;
  }

  if (req.method === 'GET' && req.url === '/api/health') {
    send(res, 200, { success: true, status: 'online' });
    return;
  }

  if (req.method === 'GET' && req.url === '/api/market') {
    const market = await getMarket();
    send(res, 200, { success: true, stocks: market.stocks, updatedAt: market.updated_at });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/register') {
    const body = await parseBody(req);
    const name = String(body.name || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    if (!name || !email || !password) return send(res, 400, { message: 'Lütfen tüm alanları doldur.' });
    if (password.length < 6) return send(res, 400, { message: 'Şifre en az 6 karakter olmalıdır.' });
    if (!email.includes('@')) return send(res, 400, { message: 'Geçerli bir e-posta adresi gir.' });

    const exists = await pool.query('SELECT 1 FROM eyem_users WHERE email = $1', [email]);
    if (exists.rowCount) return send(res, 409, { message: 'Bu e-posta ile zaten kayıt olunmuş.' });

    const { salt, hash } = await hashPassword(password);
    const id = crypto.randomUUID();
    const cards = [newCard()];

    const result = await pool.query(
      `INSERT INTO eyem_users (id,name,email,password_hash,password_salt,balance,cards,portfolio,watchlist)
       VALUES ($1,$2,$3,$4,$5,0,$6::jsonb,'{}'::jsonb,'[]'::jsonb) RETURNING *`,
      [id, name, email, hash, salt, JSON.stringify(cards)]
    );

    send(res, 201, { success: true, token: makeToken(id), user: publicUser(result.rows[0]) });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/migrate') {
    const body = await parseBody(req);
    const old = body.user || {};
    const name = String(old.name || '').trim();
    const email = String(old.email || '').trim().toLowerCase();
    const password = String(old.password || '');
    if (!name || !email || !password) return send(res, 400, { message: 'Eski hesap verisi eksik.' });

    const exists = await pool.query('SELECT * FROM eyem_users WHERE email = $1', [email]);
    if (exists.rowCount) {
      const row = await ensureCard(exists.rows[0]);
      return send(res, 200, { success: true, token: makeToken(row.id), user: publicUser(row) });
    }

    const { salt, hash } = await hashPassword(password);
    const id = crypto.randomUUID();
    const cards = Array.isArray(old.cards) && old.cards.length ? old.cards : [newCard()];
    if (cards.length && Number(cards[0].balance || 0) === 0 && !Array.isArray(old.cards)) cards[0].balance = 3000;

    const result = await pool.query(
      `INSERT INTO eyem_users (id,name,email,password_hash,password_salt,balance,cards,portfolio,watchlist)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb) RETURNING *`,
      [id, name, email, hash, salt, Number(old.balance || 0), JSON.stringify(cards), JSON.stringify(old.portfolio || {}), JSON.stringify(old.watchlist || [])]
    );
    return send(res, 201, { success: true, token: makeToken(id), user: publicUser(result.rows[0]) });
  }

  if (req.method === 'POST' && req.url === '/api/login') {
    const body = await parseBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const result = await pool.query('SELECT * FROM eyem_users WHERE email = $1', [email]);
    if (!result.rowCount) return send(res, 401, { message: 'E-posta veya şifre hatalı.' });

    let row = result.rows[0];
    const valid = await verifyPassword(password, row.password_salt, row.password_hash);
    if (!valid) return send(res, 401, { message: 'E-posta veya şifre hatalı.' });

    row = await ensureCard(row);
    send(res, 200, { success: true, token: makeToken(row.id), user: publicUser(row) });
    return;
  }

  const userId = verifyToken(readToken(req));
  if (!userId) return send(res, 401, { message: 'Oturum geçersiz veya süresi dolmuş.' });

  if (req.method === 'GET' && req.url === '/api/me') {
    let row = await getUser(userId);
    if (!row) return send(res, 404, { message: 'Kullanıcı bulunamadı.' });
    row = await ensureCard(row);
    send(res, 200, { success: true, user: publicUser(row) });
    return;
  }

  if (req.method === 'PUT' && req.url === '/api/me') {
    const body = await parseBody(req);
    const row = await getUser(userId);
    if (!row) return send(res, 404, { message: 'Kullanıcı bulunamadı.' });
    const updated = await updateUserFromClient(row, body);
    send(res, 200, { success: true, user: publicUser(updated) });
    return;
  }

  send(res, 404, { message: 'API yolu bulunamadı.' });
}

const server = http.createServer((req, res) => {
  route(req, res).catch(error => {
    console.error(error);
    send(res, 500, { message: 'Sunucu hatası.' });
  });
});

async function start() {
  await initDb();
  setInterval(() => updateMarket().catch(err => console.error('Market güncelleme hatası:', err)), 4000);
  server.listen(PORT, HOST, () => {
    console.log(`EYEM Finans Merkezi çalışıyor: http://${HOST}:${PORT}`);
  });
}

start().catch(error => {
  console.error('Sunucu başlatılamadı:', error);
  process.exit(1);
});
