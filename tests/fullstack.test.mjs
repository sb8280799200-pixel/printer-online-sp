import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tmp = await mkdtemp(path.join(os.tmpdir(), 'printer-online-sp-test-'));
process.env.PRINTER_DATA_DIR = tmp;

const store = await import('../lib/store.js');

const user = await store.authenticate('user', 'user123');
assert.equal(user.role, 'user');

const admin = await store.authenticate('admin', 'admin123');
assert.equal(admin.role, 'admin');

const token = store.encodeUser(user);
const request = new Request('http://localhost/api/jobs', { headers: { 'x-user': token } });
assert.deepEqual(store.requireUser(request), user);

let db = await store.readDb();
assert.equal(db.settings.monoPrice, 2);
assert.equal(db.settings.colorPrice, 10);

db.jobs.push({ id: 1, userId: user.id, amountRupees: 30 });
await store.writeDb(db);
db = await store.readDb();

const payload = store.paymentPayload(db.settings, db.jobs[0]);
assert.match(payload, /pa=printershop%40upi/);
assert.match(payload, /am=30.00/);
assert.match(payload, /tn=PRINT-1/);

const noPrinter = await store.dispatchPrint(db.jobs[0], { ...db.settings, printerEndpoint: '' });
assert.equal(noPrinter.printStatus, 'queued');

await rm(tmp, { recursive: true, force: true });
console.log('fullstack store tests passed');
