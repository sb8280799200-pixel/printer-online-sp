'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

function token() { return localStorage.getItem('printer-token'); }
function money(value) { return `₹${Number(value || 0).toFixed(2)}`; }
function paymentFinal(status) { return status === 'success' || status === 'failed'; }

export default function JobPage() {
  const { id } = useParams();
  const router = useRouter();
  const [job, setJob] = useState(null);
  const [settings, setSettings] = useState(null);
  const [payment, setPayment] = useState(null);
  const [options, setOptions] = useState({ printType: 'mono', copies: 1 });
  const [message, setMessage] = useState('');

  async function loadPayment() {
    const response = await fetch(`/api/jobs/${id}/payment`, { headers: { 'x-user': token() || '' } });
    if (response.status === 401) return router.push('/');
    const data = await response.json();
    if (response.ok) {
      setJob(data.job);
      setSettings(data.settings);
      setPayment(data.payment);
      setMessage('');
    } else {
      setMessage(data.error || 'Unable to load job');
    }
  }

  useEffect(() => { loadPayment(); }, [id]);

  async function saveOptions(event) {
    event.preventDefault();
    const response = await fetch(`/api/jobs/${id}/options`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user': token() || '' },
      body: JSON.stringify(options)
    });
    const data = await response.json();
    if (response.ok) {
      setJob(data.job);
      setMessage('');
      await loadPayment();
    } else setMessage(data.error || 'Could not save options');
  }

  async function pay(result) {
    const response = await fetch(`/api/jobs/${id}/payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user': token() || '' },
      body: JSON.stringify({ result })
    });
    const data = await response.json();
    if (response.ok) {
      setJob(data.job);
      setMessage('');
    } else setMessage(data.error || 'Payment update failed');
  }

  if (!job) return <main className="shell"><p className="hint">Loading...</p>{message && <p className="error">{message}</p>}</main>;

  return (
    <main className="shell">
      <nav className="topnav"><Link href="/upload">Upload</Link><Link href="/admin">Admin</Link></nav>
      <section className="card">
        <h1>Print job #{job.id}</h1>
        <p><strong>Document:</strong> {job.originalFilename}</p>
        {message && <p className="error">{message}</p>}
        <form className="options" onSubmit={saveOptions}>
          <label>Printing type
            <select value={options.printType} onChange={(event) => setOptions({ ...options, printType: event.target.value })}>
              <option value="mono">Mono / black & white ({money(settings?.monoPrice)} each)</option>
              <option value="color">Colour ({money(settings?.colorPrice)} each)</option>
            </select>
          </label>
          <label>Copies
            <input type="number" min="1" max="500" value={options.copies} onChange={(event) => setOptions({ ...options, copies: event.target.value })} />
          </label>
          <button className="button" type="submit">Calculate amount</button>
        </form>
      </section>

      {job.printType && payment ? (
        <section className="card pay-card">
          <div>
            <h2>Total amount: {money(job.amountRupees)}</h2>
            <p>{job.printType} × {job.copies} copies × {money(job.unitPriceRupees)}</p>
            <p><strong>Payment account:</strong> {settings.paymentAccount}</p>
            <p className="payload">{payment.payload}</p>
            {paymentFinal(job.paymentStatus) ? (
              <p className="hint">Payment is final. Upload a new document to create another print request.</p>
            ) : (
              <div className="actions">
                <button className="button" onClick={() => pay('success')}>Simulate payment success</button>
                <button className="button danger" onClick={() => pay('fail')}>Simulate payment fail</button>
              </div>
            )}
          </div>
          <img className="qr" src={payment.qrDataUrl} alt={`Payment QR for ${money(job.amountRupees)}`} />
          <p><strong>Payment status:</strong> <span className={`status ${job.paymentStatus}`}>{job.paymentStatus}</span></p>
          <p><strong>Print status:</strong> <span className={`status ${job.printStatus}`}>{job.printStatus}</span></p>
          {job.printerMessage && <p className="hint">{job.printerMessage}</p>}
        </section>
      ) : null}
    </main>
  );
}
