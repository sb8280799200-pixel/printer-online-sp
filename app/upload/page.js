'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
function token(){return localStorage.getItem('printer-token');}
function size(bytes){return bytes?`${(bytes/1024/1024).toFixed(2)} MB`:'—';}

export default function UploadPage(){
  const router=useRouter(); const[file,setFile]=useState(null); const[preview,setPreview]=useState(''); const[jobs,setJobs]=useState([]); const[settings,setSettings]=useState({maxFileSizeMb:25}); const[message,setMessage]=useState('');
  const accept='application/pdf,image/png,image/jpeg';
  useEffect(()=>{loadJobs();},[]);
  useEffect(()=>{if(!file){setPreview('');return;} const url=URL.createObjectURL(file); setPreview(url); return()=>URL.revokeObjectURL(url);},[file]);
  const valid=useMemo(()=>file&&accept.split(',').includes(file.type)&&file.size<=settings.maxFileSizeMb*1024*1024,[file,settings]);
  async function loadJobs(){const response=await fetch('/api/jobs',{headers:{'x-user':token()||''}}); if(response.status===401){router.push('/');return;} const data=await response.json(); setJobs(data.jobs||[]); if(data.settings)setSettings(data.settings);}
  async function upload(event){event.preventDefault(); if(!valid)return setMessage('Choose a valid PDF, JPG, JPEG, or PNG within the shop size limit.'); setMessage('Encrypting and uploading...'); const form=new FormData(); form.append('document',file); const response=await fetch('/api/jobs',{method:'POST',headers:{'x-user':token()||''},body:form}); const data=await response.json(); if(!response.ok){setMessage(data.error||'Upload failed');return;} router.push(`/jobs/${data.job.id}`);}
  return <main className="shell"><nav className="topnav"><Link href="/">Home</Link><Link href="/dashboard">Dashboard</Link><Link href="/admin">Admin</Link></nav><section className="card"><h1>Upload document</h1><p className="hint">Accepted: PDF, JPG, JPEG, PNG. Maximum size configured by admin: {settings.maxFileSizeMb} MB.</p><form onSubmit={upload}><label>Document<input type="file" accept={accept} onChange={e=>setFile(e.target.files?.[0]||null)} required /></label>{file&&<div className="preview"><div><h3>{file.name}</h3><p className={valid?'success':'error'}>{file.type} · {size(file.size)} · {valid?'Ready':'Invalid file or too large'}</p></div>{file.type==='application/pdf'?<embed src={preview} type="application/pdf" />:<img src={preview} alt="Document preview" />}</div>}<button className="button" type="submit">Upload and continue to print settings</button></form>{message&&<p className="hint">{message}</p>}</section><section className="card"><h2>Your recent print jobs</h2><div className="job-list">{jobs.map(job=><Link key={job.id} href={`/jobs/${job.id}`}>#{job.id} · {job.originalFilename} · {job.status} · {job.paymentStatus}/{job.printStatus}</Link>)}{!jobs.length&&<p className="hint">No print jobs yet.</p>}</div></section></main>;
}
