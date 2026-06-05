'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

function token() { return localStorage.getItem('printer-token'); }
function money(value) { return `₹${Number(value || 0).toFixed(2)}`; }
function date(value) { return value ? new Date(value).toLocaleString() : '—'; }

export default function AdminPage() {
  const [settings, setSettings] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [message, setMessage] = useState('');

  async function load() {
    const response = await fetch('/api/admin/settings', { headers: { 'x-user': token() || '' } });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error || 'Admin login required');
      return;
    }
    setSettings(data.settings);
    setJobs(data.jobs || []);
    setTransactions(data.transactions || []);
  }

  useEffect(() => { load(); }, []);

  async function save(event) {
    event.preventDefault();
    const response = await fetch('/api/admin/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user': token() || '' },
      body: JSON.stringify(settings)
    });
    const data = await response.json();
    if (!response.ok) setMessage(data.error || 'Could not save settings');
    else {
      setSettings(data.settings);
      setMessage('Settings saved.');
      await load();
    }
  }

  if (!settings) {
    return <main className="shell"><nav className="topnav"><Link href="/">Home</Link></nav><section className="card"><h1>Admin dashboard</h1><p className="error">{message || 'Loading...'}</p></section></main>;
  }

  return (
    <main className="shell">
      <nav className="topnav"><Link href="/">Home</Link><Link href="/upload">Upload</Link></nav>
      <section className="card">
        <h1>Admin dashboard</h1>
        <form className="settings" onSubmit={save}>
          <label>Mono price per copy (₹)<input type="number" step="0.01" min="0" value={settings.monoPrice} onChange={(event) => setSettings({ ...settings, monoPrice: event.target.value })} /></label>
          <label>Colour price per copy (₹)<input type="number" step="0.01" min="0" value={settings.colorPrice} onChange={(event) => setSettings({ ...settings, colorPrice: event.target.value })} /></label>
          <label>Online payment account / UPI<input value={settings.paymentAccount} onChange={(event) => setSettings({ ...settings, paymentAccount: event.target.value })} /></label>
          <label>Shop name<input value={settings.shopName} onChange={(event) => setSettings({ ...settings, shopName: event.target.value })} /></label>
          <label>Printer command on admin system<input placeholder="lp -n {copies} {file}" value={settings.printerCommand || ''} onChange={(event) => setSettings({ ...settings, printerCommand: event.target.value })} /></label>
          <label>Printer endpoint / local agent URL<input placeholder="https://your-print-agent.example/print" value={settings.printerEndpoint || ''} onChange={(event) => setSettings({ ...settings, printerEndpoint: event.target.value })} /></label>
          <p className="hint form-note">Use placeholders <code>{'{file}'}</code>, <code>{'{copies}'}</code>, and <code>{'{type}'}</code>. Successful payments print automatically; failed payments stay blocked.</p>
          <button className="button" type="submit">Save settings</button>
        </form>
        {message && <p className="hint">{message}</p>}
      </section>

      <section className="card">
        <h2>Printing document history</h2>
        <div className="table-wrap"><table><thead><tr><th>Job</th><th>User</th><th>Document</th><th>Type</th><th>Copies</th><th>Amount</th><th>Payment</th><th>Print</th><th>Created</th></tr></thead><tbody>
          {jobs.map((job) => <tr key={job.id}><td>#{job.id}</td><td>{job.username}</td><td>{job.originalFilename}</td><td>{job.printType || '—'}</td><td>{job.copies || '—'}</td><td>{money(job.amountRupees)}</td><td>{job.paymentStatus}</td><td>{job.printStatus}</td><td>{date(job.createdAt)}</td></tr>)}
          {!jobs.length && <tr><td colSpan="9">No print jobs yet.</td></tr>}
        </tbody></table></div>
      </section>

      <section className="card">
        <h2>Online payment transaction history</h2>
        <div className="table-wrap"><table><thead><tr><th>ID</th><th>Job</th><th>Amount</th><th>Status</th><th>Reference</th><th>Date</th></tr></thead><tbody>
          {transactions.map((txn) => <tr key={txn.id}><td>#{txn.id}</td><td>#{txn.jobId}</td><td>{money(txn.amountRupees)}</td><td>{txn.status}</td><td>{txn.paymentReference}</td><td>{date(txn.createdAt)}</td></tr>)}
          {!transactions.length && <tr><td colSpan="6">No transactions yet.</td></tr>}
        </tbody></table></div>
      </section>
    </main>
  );
}
