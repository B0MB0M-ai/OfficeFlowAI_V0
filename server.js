const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const RECEIPT_DIR = path.join(ROOT, 'receipts');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const sessions = new Map();
const demoUser = { username: 'admin', password: 'admin123', name: 'Office Admin' };

function ensureDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(RECEIPT_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    writeDb({ quotations: [], purchaseOrders: [], receipts: [] });
  }
}

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function parseCookies(req) {
  return (req.headers.cookie || '').split(';').filter(Boolean).reduce((cookies, item) => {
    const [key, ...value] = item.trim().split('=');
    cookies[key] = decodeURIComponent(value.join('='));
    return cookies;
  }, {});
}

function getSession(req) {
  const token = parseCookies(req).session;
  return token ? sessions.get(token) : null;
}

function requireAuth(req, res) {
  const session = getSession(req);
  if (!session) {
    sendJson(res, 401, { error: 'Please sign in before using the app' });
    return null;
  }
  return session;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 5_000_000) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}

function id(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}

function money(value) {
  return Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function calculateItems(items = []) {
  return items.map(item => {
    const quantity = Number(item.quantity) || 0;
    const price = Number(item.price) || 0;
    return { name: String(item.name || '').trim(), quantity, price, total: quantity * price };
  }).filter(item => item.name && item.quantity > 0 && item.price >= 0);
}

function extractPoText(rawText) {
  const text = String(rawText || '').trim();
  const pick = labels => {
    for (const label of labels) {
      const match = text.match(new RegExp(`${label}\\s*[:：-]\\s*(.+)`, 'i'));
      if (match) return match[1].trim();
    }
    return '';
  };
  const amountMatch = text.match(/(?:total|amount)\s*[:：-]?\s*([\d,.]+)/i);
  return {
    poNumber: pick(['PO No', 'PO Number', 'PO Ref', 'PO ID']),
    customerName: pick(['Customer', 'Client', 'Company']),
    projectName: pick(['Project', 'Job', 'Campaign']),
    totalAmount: amountMatch ? Number(amountMatch[1].replace(/,/g, '')) : 0,
    rawText: text
  };
}

function createReceiptPdf(receipt, po) {
  const pdfPath = path.join(RECEIPT_DIR, `${receipt.id}.pdf`);
  const lines = [
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj',
    '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj'
  ];
  const content = [
    'BT /F1 22 Tf 50 780 Td (Receipt) Tj ET',
    `BT /F1 12 Tf 50 740 Td (Receipt ID: ${receipt.id}) Tj ET`,
    `BT /F1 12 Tf 50 720 Td (PO: ${po.poNumber || po.id}) Tj ET`,
    `BT /F1 12 Tf 50 700 Td (Customer: ${po.customerName || '-'}) Tj ET`,
    `BT /F1 12 Tf 50 680 Td (Project: ${po.projectName || '-'}) Tj ET`,
    `BT /F1 12 Tf 50 660 Td (Paid Amount: THB ${money(receipt.amount)}) Tj ET`,
    `BT /F1 12 Tf 50 640 Td (Paid Date: ${receipt.createdAt}) Tj ET`
  ].join('\n');
  lines.push(`5 0 obj << /Length ${Buffer.byteLength(content)} >> stream\n${content}\nendstream endobj`);
  const body = lines.join('\n') + '\n';
  const offsets = [];
  let cursor = 0;
  body.split(/(?=\d 0 obj)/).forEach(part => { cursor += Buffer.byteLength(part); });
  const objects = lines.map((line, index) => ({ index: index + 1, offset: body.indexOf(`${index + 1} 0 obj`) }));
  let xref = `xref\n0 6\n0000000000 65535 f \n`;
  objects.forEach(obj => { xref += `${String(obj.offset).padStart(10, '0')} 00000 n \n`; });
  const trailer = `trailer << /Root 1 0 R /Size 6 >>\nstartxref\n${Buffer.byteLength(body)}\n%%EOF`;
  fs.writeFileSync(pdfPath, body + xref + trailer);
  return `/receipts/${receipt.id}.pdf`;
}

function serveStatic(req, res) {
  const safePath = decodeURIComponent(req.url.split('?')[0]);
  let filePath = safePath === '/' ? path.join(PUBLIC_DIR, 'index.html') : path.join(PUBLIC_DIR, safePath);
  if (safePath.startsWith('/receipts/')) filePath = path.join(ROOT, safePath);
  if (!filePath.startsWith(PUBLIC_DIR) && !filePath.startsWith(RECEIPT_DIR)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.readFile(filePath, (error, content) => {
    if (error) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(filePath);
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.pdf': 'application/pdf' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

async function handleApi(req, res) {
  try {
    if (req.method === 'POST' && req.url === '/api/login') {
      const body = await readBody(req);
      if (body.username === demoUser.username && body.password === demoUser.password) {
        const token = crypto.randomBytes(24).toString('hex');
        sessions.set(token, { username: demoUser.username, name: demoUser.name });
        res.setHeader('Set-Cookie', `session=${token}; HttpOnly; Path=/; SameSite=Lax`);
        return sendJson(res, 200, { user: { name: demoUser.name, username: demoUser.username } });
      }
      return sendJson(res, 401, { error: 'Invalid username or password' });
    }
    if (req.method === 'POST' && req.url === '/api/logout') {
      const token = parseCookies(req).session;
      if (token) sessions.delete(token);
      res.setHeader('Set-Cookie', 'session=; Max-Age=0; Path=/');
      return sendJson(res, 200, { ok: true });
    }
    if (req.method === 'GET' && req.url === '/api/me') {
      return sendJson(res, 200, { user: getSession(req) });
    }
    const session = requireAuth(req, res);
    if (!session) return;
    const db = readDb();
    if (req.method === 'GET' && req.url === '/api/dashboard') {
      const quotationTotal = db.quotations.reduce((sum, item) => sum + item.grandTotal, 0);
      const poTotal = db.purchaseOrders.reduce((sum, item) => sum + Number(item.totalAmount || 0), 0);
      const paidTotal = db.receipts.reduce((sum, item) => sum + Number(item.amount || 0), 0);
      return sendJson(res, 200, { quotations: db.quotations, purchaseOrders: db.purchaseOrders, receipts: db.receipts, metrics: { quotationTotal, poTotal, paidTotal, openPo: db.purchaseOrders.filter(po => po.status !== 'paid').length } });
    }
    if (req.method === 'POST' && req.url === '/api/quotations') {
      const body = await readBody(req);
      const items = calculateItems(body.items);
      const subtotal = items.reduce((sum, item) => sum + item.total, 0);
      const vat = subtotal * 0.07;
      const quotation = { id: id('QT'), customerName: body.customerName, projectName: body.projectName, items, subtotal, vat, grandTotal: subtotal + vat, createdAt: new Date().toISOString() };
      db.quotations.unshift(quotation); writeDb(db);
      return sendJson(res, 201, quotation);
    }
    if (req.method === 'POST' && req.url === '/api/purchase-orders') {
      const body = await readBody(req);
      const extracted = extractPoText(body.ocrText);
      const po = { id: id('PO'), ...extracted, poNumber: body.poNumber || extracted.poNumber, customerName: body.customerName || extracted.customerName, projectName: body.projectName || extracted.projectName, totalAmount: Number(body.totalAmount || extracted.totalAmount || 0), status: 'waiting_payment', createdAt: new Date().toISOString() };
      db.purchaseOrders.unshift(po); writeDb(db);
      return sendJson(res, 201, po);
    }
    if (req.method === 'POST' && req.url.match(/^\/api\/purchase-orders\/[^/]+\/pay$/)) {
      const poId = req.url.split('/')[3];
      const po = db.purchaseOrders.find(item => item.id === poId);
      if (!po) return sendJson(res, 404, { error: 'Purchase order not found' });
      po.status = 'paid';
      const receipt = { id: id('RC'), poId: po.id, amount: Number(po.totalAmount || 0), createdAt: new Date().toISOString() };
      receipt.pdfUrl = createReceiptPdf(receipt, po);
      db.receipts.unshift(receipt); writeDb(db);
      return sendJson(res, 201, receipt);
    }
    sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
}

ensureDb();
http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) return handleApi(req, res);
  serveStatic(req, res);
}).listen(PORT, () => console.log(`OfficeFlowAI running at http://localhost:${PORT}`));
