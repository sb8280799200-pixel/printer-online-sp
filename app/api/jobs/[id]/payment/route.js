import { NextResponse } from 'next/server';
import { dispatchPrint, makePaymentQr, paymentPayload, readDb, requireUser, writeDb } from '@/lib/store';

export async function GET(request, { params }) {
  const user = requireUser(request);
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });

  const db = await readDb();
  const { id } = await params;
  const job = db.jobs.find((item) => String(item.id) === String(id));

  if (!job || (user.role !== 'admin' && job.userId !== user.id)) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  const payload = paymentPayload(db.settings, job);
  const qrDataUrl = await makePaymentQr(payload);
  return NextResponse.json({ job, settings: db.settings, payment: { payload, qrDataUrl } });
}

export async function POST(request, { params }) {
  const user = requireUser(request);
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });

  const { result } = await request.json();
  const db = await readDb();
  const { id } = await params;
  const job = db.jobs.find((item) => String(item.id) === String(id));

  if (!job || (user.role !== 'admin' && job.userId !== user.id)) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  const success = result === 'success';
  job.paymentStatus = success ? 'success' : 'failed';
  job.paymentReference = `PAY-${job.id}-${Math.random().toString(16).slice(2, 10).toUpperCase()}`;

  if (success) {
    job.paidAt = Date.now();
    const printResult = await dispatchPrint(job, db.settings);
    job.printStatus = printResult.printStatus;
    job.printerMessage = printResult.printerMessage;
    job.printedAt = printResult.printStatus === 'sent' ? Date.now() : null;
  } else {
    job.printStatus = 'blocked';
    job.printerMessage = 'Payment failed; print request blocked.';
  }

  db.transactions.push({
    id: Date.now(),
    jobId: job.id,
    amountRupees: job.amountRupees,
    status: job.paymentStatus,
    paymentReference: job.paymentReference,
    createdAt: Date.now()
  });

  await writeDb(db);
  return NextResponse.json({ job });
}
