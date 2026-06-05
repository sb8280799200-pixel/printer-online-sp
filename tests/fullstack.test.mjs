import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tmp = await mkdtemp(path.join(os.tmpdir(), 'printer-online-sp-test-'));
process.env.PRINTER_DATA_DIR = tmp;
process.env.JWT_SECRET = 'test-secret';

const store = await import('../lib/store.js');

const user = await store.authenticate('user', 'user123');
assert.equal(user.role, 'user');
const admin = await store.authenticate('admin', 'admin123');
assert.equal(admin.role, 'admin');

const token = store.encodeUser(user);
const request = new Request('http://localhost/api/jobs', { headers: { 'x-user': token } });
assert.deepEqual(store.requireUser(request).username, user.username);

let db = await store.readDb();
assert.equal(db.settings.monoPrice, 2);
assert.equal(db.settings.colorPrice, 10);
assert.equal(db.settings.maxFileSizeMb, 25);

const registered = await store.registerUser({ username: 'alice', email: 'alice@example.com', password: 'password123' });
assert.equal(registered.role, 'user');
assert.equal((await store.authenticate('alice', 'password123')).email, 'alice@example.com');

const fakePdf = Buffer.from('%PDF-1.4\n1 0 obj <</Type /Page>>\n2 0 obj <</Type /Page>>');
assert.equal(store.estimatePageCount(fakePdf, 'application/pdf'), 2);

const upload = await store.saveUpload(new File([fakePdf], 'document.pdf', { type: 'application/pdf' }), db.settings);
assert.equal(upload.encrypted, true);
assert.equal(upload.pageCount, 2);

db = await store.readDb();
db.jobs.push({ id: 1, userId: user.id, username: user.username, originalFilename: 'document.pdf', amountRupees: 30, paymentStatus: 'success', copies: 3, printType: 'mono', orientation: 'portrait', paperSize: 'A4', pageRangeMode: 'all', pageCount: 2, upload });
await store.writeDb(db);
db = await store.readDb();

const payload = store.paymentPayload(db.settings, db.jobs[0]);
assert.match(payload, /pa=printershop%40upi/);
assert.match(payload, /am=30.00/);
assert.match(payload, /tn=PRINT-1/);

const noPrinter = await store.dispatchPrint(db.jobs[0], { ...db.settings, printerEndpoint: '', printerCommand: '' });
assert.equal(noPrinter.printStatus, 'queued');
const blockedPrint = await store.dispatchPrint({ ...db.jobs[0], paymentStatus: 'failed' }, { ...db.settings, printerEndpoint: '', printerCommand: '' });
assert.equal(blockedPrint.printStatus, 'blocked');

const agentScript = path.join(tmp, 'printer-agent.mjs');
const agentOutput = path.join(tmp, 'printer-agent-output.json');
await writeFile(agentScript, `import { writeFile } from 'node:fs/promises';\nawait writeFile(${JSON.stringify(agentOutput)}, JSON.stringify(process.argv.slice(2)));\n`);
const commandPrint = await store.dispatchPrint(db.jobs[0], { ...db.settings, printerEndpoint: '', printerCommand: `${process.execPath} ${agentScript} {copies} {type} {paperSize} {file}` });
assert.equal(commandPrint.printStatus, 'sent');
const args = JSON.parse(await readFile(agentOutput, 'utf8'));
assert.deepEqual(args.slice(0, 3), ['3', 'mono', 'A4']);
assert.match(args[3], /print-tmp/);

assert.equal(store.visibleJobs(db, admin)[0].upload, undefined);
assert.equal(store.visibleJobs(db, user)[0].userId, user.id);

await rm(tmp, { recursive: true, force: true });
console.log('fullstack store tests passed');
