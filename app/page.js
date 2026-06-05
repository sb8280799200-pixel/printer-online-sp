'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

function saveAuth(data) {
  localStorage.setItem('printer-user', JSON.stringify(data.user));
  localStorage.setItem('printer-token', data.token);
}

export default function Home() {
  const [form, setForm] = useState({ username: 'user', password: 'user123' });
  const [user, setUser] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const saved = localStorage.getItem('printer-user');
    if (saved) setUser(JSON.parse(saved));
  }, []);

  async function login(event) {
    event.preventDefault();
    setError('');
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form)
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || 'Login failed');
      return;
    }
    saveAuth(data);
    setUser(data.user);
  }

  function logout() {
    localStorage.removeItem('printer-user');
    localStorage.removeItem('printer-token');
    setUser(null);
  }

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Full-stack Vercel print ordering app</p>
        <h1>Upload. Price. Pay. Print only after payment.</h1>
        <p>
          Customers upload an image or PDF, select mono/colour and copy count, then pay the exact rupee amount. Admins control pricing, payment details, transaction history, local printer command, and optional printer endpoint settings.
        </p>
        {user ? (
          <div className="actions">
            <Link className="button" href="/upload">Create print order</Link>
            {user.role === 'admin' && <Link className="button secondary" href="/admin">Open admin dashboard</Link>}
            <button className="button ghost" type="button" onClick={logout}>Logout {user.username}</button>
          </div>
        ) : null}
      </section>

      {!user ? (
        <section className="card login-card">
          <h2>Login</h2>
          <form onSubmit={login}>
            <label>Username
              <input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} required />
            </label>
            <label>Password
              <input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required />
            </label>
            {error && <p className="error">{error}</p>}
            <button className="button" type="submit">Login</button>
          </form>
          <p className="hint">Demo user: user/user123 · admin: admin/admin123</p>
        </section>
      ) : null}

      <section className="grid">
        <article className="card"><h3>User rights</h3><ul><li>Login and upload PDF/image documents.</li><li>Select mono or colour printing.</li><li>Choose number of copies.</li><li>Pay only the calculated amount.</li></ul></article>
        <article className="card"><h3>Admin rights</h3><ul><li>Edit mono and colour prices.</li><li>Set online payment account.</li><li>View payment and print history.</li><li>Configure the local printer command or endpoint/agent.</li></ul></article>
      </section>
    </main>
  );
}
