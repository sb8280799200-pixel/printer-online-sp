import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = process.env.PRINTER_DATA_DIR || (process.env.VERCEL ? '/tmp/printer-online-sp-next' : path.join(process.cwd(), 'data-next'));
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const TMP_PRINT_DIR = path.join(DATA_DIR, 'print-tmp');
const execFileAsync = promisify(execFile);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-change-this-printer-online-sp-secret';
const STORAGE_KEY = crypto.createHash('sha256').update(process.env.FILE_ENCRYPTION_KEY || JWT_SECRET).digest();

const DEFAULT_DB = {
  users: [
    { id: 1, username: 'admin', email: 'admin@printer.local', passwordHash: hashPassword('admin123'), role: 'admin', verified: true, createdAt: Date.now() },
    { id: 2, username: 'user', email: 'user@printer.local', passwordHash: hashPassword('user123'), role: 'user', verified: true, createdAt: Date.now() }
  ],
  settings: {
    monoPrice: 2,
    colorPrice: 10,
    maxFileSizeMb: 25,
    retentionHours: 24,
    paymentAccount: 'printershop@upi',
    shopName: 'Printer Online SP',
    bankAccount: '',
    razorpayKeyId: '',
    phonePeMerchantId: '',
    paytmMerchantId: '',
    bharatPeMerchantId: '',
    defaultPrinter: '',
    printerEndpoint: '',
    printerCommand: '',
    virusScanCommand: ''
  },
  jobs: [],
  transactions: [],
  auditLogs: []
};

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored) return false;
  if (!String(stored).startsWith('scrypt$')) return String(password) === String(stored);
  const [, salt, hash] = stored.split('$');
  const candidate = hashPassword(password, salt).split('$')[2];
  return crypto.timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(hash, 'hex'));
}

function base64url(input) { return Buffer.from(input).toString('base64url'); }
function sign(data) { return crypto.createHmac('sha256', JWT_SECRET).update(data).digest('base64url'); }

async function ensureDb() {
  await mkdir(UPLOAD_DIR, { recursive: true });
  await mkdir(TMP_PRINT_DIR, { recursive: true });
  if (!existsSync(DB_FILE)) await writeFile(DB_FILE, JSON.stringify(DEFAULT_DB, null, 2));
}

function migrateDb(db) {
  db.settings = { ...DEFAULT_DB.settings, ...(db.settings || {}) };
  db.transactions ||= [];
  db.auditLogs ||= [];
  db.users = (db.users || []).map((user) => ({
    ...user,
    email: user.email || `${user.username}@printer.local`,
    passwordHash: user.passwordHash || hashPassword(user.password || ''),
    verified: user.verified ?? true,
    createdAt: user.createdAt || Date.now(),
    password: undefined
  }));
  db.jobs = (db.jobs || []).map((job) => ({
    pageCount: job.pageCount || 1,
    orientation: job.orientation || 'portrait',
    paperSize: job.paperSize || 'A4',
    pageRangeMode: job.pageRangeMode || 'all',
    customPages: job.customPages || '',
    status: deriveOrderStatus(job),
    ...job
  }));
  return db;
}

export async function readDb() {
  await ensureDb();
  return migrateDb(JSON.parse(await readFile(DB_FILE, 'utf8')));
}

export async function writeDb(db) {
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(DB_FILE, JSON.stringify(migrateDb(db), null, 2));
}

export function publicUser(user) {
  if (!user) return null;
  return { id: user.id, username: user.username, email: user.email, role: user.role, verified: user.verified };
}

export async function authenticate(username, password) {
  const db = await readDb();
  const user = db.users.find((item) => item.username === username || item.email === username);
  return user && verifyPassword(password, user.passwordHash) ? publicUser(user) : null;
}

export async function registerUser({ username, email, password }) {
  const db = await readDb();
  const cleanUsername = String(username || '').trim().toLowerCase();
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(cleanUsername)) throw new Error('Username must be 3-32 letters, numbers, dots, underscores, or dashes.');
  if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) throw new Error('Enter a valid email address.');
  if (String(password || '').length < 8) throw new Error('Password must be at least 8 characters.');
  if (db.users.some((user) => user.username === cleanUsername || user.email === cleanEmail)) throw new Error('An account with that username or email already exists.');
  const user = { id: Date.now(), username: cleanUsername, email: cleanEmail, passwordHash: hashPassword(password), role: 'user', verified: false, createdAt: Date.now() };
  db.users.push(user);
  db.auditLogs.push(audit('register', user.id, { username: cleanUsername }));
  await writeDb(db);
  return publicUser(user);
}

export function encodeUser(user) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ sub: user.id, username: user.username, email: user.email, role: user.role, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12 }));
  const body = `${header}.${payload}`;
  return `${body}.${sign(body)}`;
}

function decodeLegacy(raw) {
  try { const user = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')); return user?.id && user?.role ? user : null; } catch { return null; }
}

export function requireUser(request) {
  const raw = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || request.headers.get('x-user');
  if (!raw) return null;
  if (!raw.includes('.')) return decodeLegacy(raw);
  const [header, payload, signature] = raw.split('.');
  const body = `${header}.${payload}`;
  if (signature !== sign(body)) return null;
  try {
    const user = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (user.exp && user.exp < Math.floor(Date.now() / 1000)) return null;
    return { id: user.sub, username: user.username, email: user.email, role: user.role };
  } catch { return null; }
}

export function rupees(value) { return `₹${Number(value || 0).toFixed(2)}`; }

export function paymentPayload(settings, job) {
  const params = new URLSearchParams({ pa: settings.paymentAccount, pn: settings.shopName, am: Number(job.amountRupees || 0).toFixed(2), cu: 'INR', tn: `PRINT-${job.id}` });
  return `upi://pay?${params.toString()}`;
}

export async function makePaymentQr(payload) {
  try { const QRCode = (await import('qrcode')).default; return await QRCode.toDataURL(payload, { margin: 1, width: 280 }); }
  catch {
    const digest = crypto.createHash('sha256').update(payload).digest();
    const size = 21; const cells = [];
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
      const finder = (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13);
      const bit = (digest[(x + y * size) % digest.length] >> ((x + y) % 8)) & 1;
      if (finder || bit) cells.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`);
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><rect width="100%" height="100%" fill="white"/><g fill="black">${cells.join('')}</g></svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  }
}

export function estimatePageCount(bytes, contentType) {
  if (contentType === 'application/pdf') {
    const text = bytes.toString('latin1');
    const matches = text.match(/\/Type\s*\/Page\b/g);
    return Math.max(1, matches?.length || 1);
  }
  return 1;
}

function encrypt(bytes) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', STORAGE_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

async function decryptToTemp(job) {
  const encrypted = await readFile(job.upload.url);
  const iv = encrypted.subarray(0, 12), tag = encrypted.subarray(12, 28), body = encrypted.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', STORAGE_KEY, iv);
  decipher.setAuthTag(tag);
  const bytes = Buffer.concat([decipher.update(body), decipher.final()]);
  const tempPath = path.join(TMP_PRINT_DIR, `${job.id}-${job.upload.safeName}`);
  await writeFile(tempPath, bytes);
  return tempPath;
}

export async function saveUpload(file, settings = DEFAULT_DB.settings) {
  const bytes = Buffer.from(await file.arrayBuffer());
  const maxBytes = Number(settings.maxFileSizeMb || 25) * 1024 * 1024;
  if (bytes.length > maxBytes) throw new Error(`File exceeds the ${settings.maxFileSizeMb} MB shop limit.`);
  const safeName = file.name.replace(/[^a-z0-9._-]/gi, '_');
  const key = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}-${safeName}.enc`;
  const localPath = path.join(UPLOAD_DIR, key);
  await mkdir(UPLOAD_DIR, { recursive: true });
  await writeFile(localPath, encrypt(bytes));
  return { storage: 'encrypted-local', url: localPath, key, safeName, size: bytes.length, pageCount: estimatePageCount(bytes, file.type), encrypted: true };
}

export async function runVirusScan(upload, settings) {
  if (!settings.virusScanCommand) return { ok: true, message: 'Virus scan command not configured; relying on type and size validation.' };
  const [command, ...args] = String(settings.virusScanCommand).replaceAll('{file}', upload.url).match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  if (!command) return { ok: true, message: 'Virus scan command empty.' };
  try { await execFileAsync(command, args.map((part) => part.replace(/^"|"$/g, '')), { timeout: 60000 }); return { ok: true, message: 'Virus scan passed.' }; }
  catch (error) { return { ok: false, message: `Virus scan failed: ${error.message}` }; }
}

export function deriveOrderStatus(job) {
  if (job.paymentStatus === 'failed' || job.printStatus === 'failed' || job.printStatus === 'blocked') return 'Failed';
  if (job.printStatus === 'sent' || job.printStatus === 'completed') return 'Completed';
  if (job.printStatus === 'printing' || job.printStatus === 'queued') return 'Printing';
  if (job.paymentStatus === 'success') return 'Paid';
  if (job.printType) return 'Payment Pending';
  return 'Uploaded';
}

function buildPrintArgs(job, commandTemplate, filePath) {
  const replacements = { '{file}': filePath || job.upload?.url || '', '{copies}': String(job.copies || 1), '{type}': job.printType || 'mono', '{orientation}': job.orientation || 'portrait', '{paperSize}': job.paperSize || 'A4', '{pages}': job.pageRangeMode === 'custom' ? job.customPages || '' : 'all' };
  const parts = String(commandTemplate || '').match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  return parts.map((part) => Object.entries(replacements).reduce((value, [token, replacement]) => value.replaceAll(token, replacement), part.replace(/^"|"$/g, '')));
}

async function dispatchWithCommand(job, commandTemplate, filePath) {
  const [command, ...args] = buildPrintArgs(job, commandTemplate, filePath);
  if (!command) return null;
  try { await execFileAsync(command, args, { timeout: 30000, maxBuffer: 1024 * 1024 }); return { printStatus: 'sent', printerMessage: `Sent to printer with admin command: ${command}.` }; }
  catch (error) { return { printStatus: 'failed', printerMessage: `Printer command failed: ${error.message}` }; }
}

async function dispatchWithDefaultPrinter(job, filePath) {
  if (!filePath) return null;
  const copies = String(job.copies || 1);
  const candidates = [['lp', ['-n', copies, '-o', `media=${job.paperSize || 'A4'}`, filePath]], ['lpr', ['-#', copies, filePath]]];
  for (const [command, args] of candidates) {
    try { await execFileAsync(command, args, { timeout: 30000, maxBuffer: 1024 * 1024 }); return { printStatus: 'sent', printerMessage: `Sent to the system default printer with ${command}.` }; }
    catch (error) { if (error.code !== 'ENOENT') return { printStatus: 'failed', printerMessage: `Default printer command failed: ${error.message}` }; }
  }
  return null;
}

export async function dispatchPrint(job, settings) {
  if (job.paymentStatus !== 'success') return { printStatus: 'blocked', printerMessage: 'Payment was not successful; print request blocked.' };
  let tempPath = null;
  try {
    tempPath = job.upload?.encrypted ? await decryptToTemp(job) : job.upload?.url;
    const localCommandResult = await dispatchWithCommand(job, settings.printerCommand, tempPath);
    if (localCommandResult) return localCommandResult;
    if (settings.printerEndpoint) {
      const response = await fetch(settings.printerEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job: sanitizeJob(job, { role: 'admin' }), secureFileAvailableOnServer: true }) });
      if (!response.ok) return { printStatus: 'failed', printerMessage: `Printer endpoint returned HTTP ${response.status}.` };
      return { printStatus: 'sent', printerMessage: 'Sent to configured printer endpoint.' };
    }
    const defaultPrinterResult = await dispatchWithDefaultPrinter(job, tempPath);
    if (defaultPrinterResult) return defaultPrinterResult;
    return { printStatus: 'queued', printerMessage: 'Payment succeeded. Configure an admin printer command, printer endpoint, or operating system default printer to release this job automatically.' };
  } finally { if (tempPath && tempPath.includes(TMP_PRINT_DIR)) await unlink(tempPath).catch(() => {}); }
}

export async function deleteJobFile(job) {
  if (job.upload?.url) await unlink(job.upload.url).catch(() => {});
  job.deletedAt = Date.now();
  job.upload = { storage: 'deleted', size: job.upload?.size || 0, pageCount: job.pageCount || 1 };
}

export function audit(action, userId, details = {}) { return { id: Date.now() + Math.random(), action, userId, details, createdAt: Date.now() }; }

export function sanitizeJob(job, user) {
  const copy = { ...job, upload: undefined };
  copy.fileSize = job.upload?.size || job.fileSize || 0;
  copy.pageCount = job.pageCount || job.upload?.pageCount || 1;
  copy.status = deriveOrderStatus(job);
  if (user?.role === 'admin') delete copy.userId;
  return copy;
}

export function visibleJobs(db, user) {
  const jobs = user.role === 'admin' ? db.jobs : db.jobs.filter((job) => job.userId === user.id);
  return jobs.map((job) => sanitizeJob(job, user));
}
