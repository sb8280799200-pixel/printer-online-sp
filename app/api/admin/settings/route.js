import { NextResponse } from 'next/server';
import { readDb, requireUser, visibleJobs, writeDb, audit } from '@/lib/store';

export async function GET(request) {
  const user = requireUser(request);
  if (!user || user.role !== 'admin') return NextResponse.json({ error: 'Admin login required' }, { status: 403 });
  const db = await readDb();
  return NextResponse.json({ settings: db.settings, jobs: visibleJobs(db, user).sort((a, b) => b.createdAt - a.createdAt), transactions: db.transactions.sort((a, b) => b.createdAt - a.createdAt), auditLogs: db.auditLogs.slice(-100).sort((a, b) => b.createdAt - a.createdAt) });
}

export async function POST(request) {
  const user = requireUser(request);
  if (!user || user.role !== 'admin') return NextResponse.json({ error: 'Admin login required' }, { status: 403 });
  const body = await request.json();
  const db = await readDb();
  db.settings = { ...db.settings,
    monoPrice: Math.max(0, Number(body.monoPrice) || 0), colorPrice: Math.max(0, Number(body.colorPrice) || 0),
    maxFileSizeMb: Math.max(1, Number(body.maxFileSizeMb) || 25), retentionHours: Math.max(1, Number(body.retentionHours) || 24),
    paymentAccount: String(body.paymentAccount || 'printershop@upi').trim(), shopName: String(body.shopName || 'Printer Online SP').trim(), bankAccount: String(body.bankAccount || '').trim(),
    razorpayKeyId: String(body.razorpayKeyId || '').trim(), phonePeMerchantId: String(body.phonePeMerchantId || '').trim(), paytmMerchantId: String(body.paytmMerchantId || '').trim(), bharatPeMerchantId: String(body.bharatPeMerchantId || '').trim(),
    defaultPrinter: String(body.defaultPrinter || '').trim(), printerEndpoint: String(body.printerEndpoint || '').trim(), printerCommand: String(body.printerCommand || '').trim(), virusScanCommand: String(body.virusScanCommand || '').trim()
  };
  db.auditLogs.push(audit('settings_updated', user.id, { sections: ['pricing', 'payment', 'printer', 'retention'] }));
  await writeDb(db);
  return NextResponse.json({ settings: db.settings });
}
