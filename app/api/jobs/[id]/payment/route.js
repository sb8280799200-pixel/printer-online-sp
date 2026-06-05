import { NextResponse } from 'next/server';
import { audit, deleteJobFile, dispatchPrint, makePaymentQr, paymentPayload, readDb, requireUser, sanitizeJob, writeDb } from '@/lib/store';

export async function GET(request, { params }) {
  const user = requireUser(request);
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  const db = await readDb();
  const { id } = await params;
  const job = db.jobs.find((item) => String(item.id) === String(id));
  if (!job || (user.role !== 'admin' && job.userId !== user.id)) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  if (!job.printType || !job.copies || job.amountRupees == null) return NextResponse.json({ job: sanitizeJob(job, user), settings: db.settings, payment: null });
  const payload = paymentPayload(db.settings, job);
  const qrDataUrl = await makePaymentQr(payload);
  return NextResponse.json({ job: sanitizeJob(job, user), settings: db.settings, payment: { payload, qrDataUrl, orderId: `PRINT-${job.id}`, amountRupees: job.amountRupees } });
}

export async function POST(request, { params }) {
  const user = requireUser(request);
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });
  const { result, gateway = 'manual-upi', transactionId } = await request.json();
  const db = await readDb();
  const { id } = await params;
  const job = db.jobs.find((item) => String(item.id) === String(id));
  if (!job || (user.role !== 'admin' && job.userId !== user.id)) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  if (!job.printType || !job.copies || job.amountRupees == null) return NextResponse.json({ error: 'Choose print settings before payment' }, { status: 400 });
  if (job.paymentStatus === 'success') return NextResponse.json({ error: 'This job is already paid and cannot be paid again' }, { status: 409 });

  const success = result === 'success';
  job.paymentStatus = success ? 'success' : 'failed';
  job.paymentReference = transactionId || `PAY-${job.id}-${Math.random().toString(16).slice(2, 10).toUpperCase()}`;
  if (success) {
    job.paidAt = Date.now();
    job.printStatus = 'printing';
    const printResult = await dispatchPrint(job, db.settings);
    job.printStatus = printResult.printStatus;
    job.printerMessage = printResult.printerMessage;
    job.printedAt = ['sent', 'completed'].includes(printResult.printStatus) ? Date.now() : null;
    if (job.printedAt) await deleteJobFile(job);
  } else {
    job.printStatus = 'blocked';
    job.printerMessage = 'Payment failed; print request blocked.';
  }
  db.transactions.push({ id: Date.now(), jobId: job.id, amountRupees: job.amountRupees, status: job.paymentStatus, gateway, paymentReference: job.paymentReference, gatewayResponse: { result }, createdAt: Date.now() });
  db.auditLogs.push(audit(success ? 'payment_success' : 'payment_failed', user.id, { jobId: job.id, paymentReference: job.paymentReference }));
  await writeDb(db);
  return NextResponse.json({ job: sanitizeJob(job, user) });
}
