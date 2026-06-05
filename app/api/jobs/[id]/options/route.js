import { NextResponse } from 'next/server';
import { isFinalPaymentStatus, readDb, requireUser, writeDb } from '@/lib/store';

export async function POST(request, { params }) {
  const user = requireUser(request);
  if (!user) return NextResponse.json({ error: 'Login required' }, { status: 401 });

  const { printType, copies } = await request.json();
  const db = await readDb();
  const { id } = await params;
  const job = db.jobs.find((item) => String(item.id) === String(id));

  if (!job || (user.role !== 'admin' && job.userId !== user.id)) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  if (isFinalPaymentStatus(job.paymentStatus)) {
    return NextResponse.json({ error: 'Paid or failed jobs are final. Upload a new document to create another print request.' }, { status: 409 });
  }

  const normalizedType = printType === 'color' ? 'color' : 'mono';
  const normalizedCopies = Math.max(1, Math.min(500, Number.parseInt(copies, 10) || 1));
  const unitPrice = normalizedType === 'color' ? Number(db.settings.colorPrice) : Number(db.settings.monoPrice);

  Object.assign(job, {
    printType: normalizedType,
    copies: normalizedCopies,
    unitPriceRupees: unitPrice,
    amountRupees: Number((unitPrice * normalizedCopies).toFixed(2)),
    paymentStatus: 'pending',
    printStatus: 'not_ready'
  });

  await writeDb(db);
  return NextResponse.json({ job, settings: db.settings });
}
