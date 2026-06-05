'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

function saveAuth(data) { localStorage.setItem('printer-user', JSON.stringify(data.user)); localStorage.setItem('printer-token', data.token); }

export default function Home() {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ username: 'user', email: '', password: 'user123' });
  const [user, setUser] = useState(null);
  const [message, setMessage] = useState('');

  useEffect(() => { const saved = localStorage.getItem('printer-user'); if (saved) setUser(JSON.parse(saved)); }, []);

  async function submit(event) {
    event.preventDefault(); setMessage('');
    const endpoint = mode === 'register' ? '/api/auth/register' : mode === 'forgot' ? '/api/auth/forgot-password' : '/api/auth/login';
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    const data = await response.json();
    if (!response.ok) return setMessage(data.error || 'Request failed');
    if (data.token) { saveAuth(data); setUser(data.user); } else setMessage(data.message);
  }
  function logout() { localStorage.removeItem('printer-user'); localStorage.removeItem('printer-token'); setUser(null); }

  return <main className="shell">
    <section className="hero">
      <p className="eyebrow">Secure online print shop</p>
      <h1>Upload, configure, pay by UPI QR, and print only after payment.</h1>
      <p>A responsive Next.js and Node backend prototype for users and admins with JWT authentication, encrypted document storage, privacy-safe admin views, QR payments, audit logs, and local printer dispatch.</p>
      {user && <div className="actions"><Link className="button" href="/upload">Create print order</Link><Link className="button secondary" href="/dashboard">User dashboard</Link>{user.role === 'admin' && <Link className="button secondary" href="/admin">Admin dashboard</Link>}<button className="button ghost" type="button" onClick={logout}>Logout {user.username}</button></div>}
    </section>
    {!user && <section className="card login-card">
      <div className="tabs"><button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Login</button><button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>Register</button><button className={mode === 'forgot' ? 'active' : ''} onClick={() => setMode('forgot')}>Forgot password</button></div>
      <h2>{mode === 'register' ? 'Create account' : mode === 'forgot' ? 'Reset password' : 'Login'}</h2>
      <form onSubmit={submit}>
        {mode !== 'forgot' && <label>Username<input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} required /></label>}
        {mode !== 'login' && <label>Email<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required /></label>}
        {mode !== 'forgot' && <label>Password<input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required /></label>}
        {message && <p className={message.includes('failed') || message.includes('Invalid') || message.includes('must') ? 'error' : 'hint'}>{message}</p>}
        <button className="button" type="submit">{mode === 'forgot' ? 'Send reset link' : mode === 'register' ? 'Register' : 'Login'}</button>
      </form>
      <p className="hint">Demo user: user/user123 · admin: admin/admin123</p>
    </section>}
    <section className="grid"><article className="card"><h3>User panel</h3><ul><li>Upload PDF/JPG/JPEG/PNG with preview and page count.</li><li>Select mono/color, copies, orientation, paper size, and page range.</li><li>View amount, order status, payment status, and print status.</li></ul></article><article className="card"><h3>Admin panel</h3><ul><li>Manage prices, file limits, payment keys, and UPI account.</li><li>Configure local, USB, Windows, or network printer commands.</li><li>See only metadata, never document previews or downloads.</li></ul></article><article className="card"><h3>Security</h3><ul><li>Signed JWT sessions and role-based API checks.</li><li>Encrypted local storage, type/size validation, optional virus scan.</li><li>Audit logs and payment-gated automatic print dispatch.</li></ul></article></section>
  </main>;
}
