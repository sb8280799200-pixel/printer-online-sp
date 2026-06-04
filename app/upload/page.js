'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

function token() {
  return localStorage.getItem('printer-token');
}

export default function UploadPage() {
  const router = useRouter();
  const [file, setFile] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [message, setMessage] = useState('');

  async function loadJobs() {
    const response = await fetch('/api/jobs', { headers: { 'x-user': token() || '' } });
    if (response.status === 401) {
      router.push('/');
      return;
    }
    const data = await response.json();
    setJobs(data.jobs || []);
  }

  useEffect(() => { loadJobs(); }, []);

  async function upload(event) {
    event.preventDefault();
    if (!file) return;
    setMessage('Uploading...');
    const form = new FormData();
    form.append('document', file);
    const response = await fetch('/api/jobs', { method: 'POST', headers: { 'x-user': token() || '' }, body: form });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error || 'Upload failed');
      return;
    }
    router.push(`/jobs/${data.job.id}`);
  }

  return (
    <main className="shell">
      <nav className="topnav"><Link href="/">Home</Link><Link href="/admin">Admin</Link></nav>
      <section className="card">
        <h1>Upload print document</h1>
        <form onSubmit={upload}>
          <label>Image or PDF
            <input type="file" accept="application/pdf,image/png,image/jpeg,image/gif,image/webp" onChange={(event) => setFile(event.target.files?.[0])} required />
          </label>
          <button className="button" type="submit">Upload and continue</button>
        </form>
        {message && <p className="hint">{message}</p>}
      </section>

      <section className="card">
        <h2>Your recent print jobs</h2>
        <div className="job-list">
          {jobs.map((job) => <Link key={job.id} href={`/jobs/${job.id}`}>#{job.id} · {job.originalFilename} · {job.paymentStatus}/{job.printStatus}</Link>)}
          {!jobs.length && <p className="hint">No print jobs yet.</p>}
        </div>
      </section>
    </main>
  );
}
