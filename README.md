# Printer Online SP

A Vercel-ready full-stack print-ordering website. Customers upload a PDF/image, choose mono or colour printing and copy count, pay the exact calculated rupee amount, and only successful payments are released to the print queue/agent. Admins control prices, payment details, printer endpoint settings, and can review print/payment history.

## Full-stack features

- **Frontend:** Next.js App Router pages for login, upload, job payment, and admin dashboard.
- **Backend:** Next.js API routes for authentication, uploads, pricing, payment status updates, settings, and history.
- **Storage:** Local temporary JSON/file storage for preview. For production, connect the documented storage layer to Vercel Blob/S3 and a managed database.
- **Payment QR:** Generates a QR data URL for the exact UPI-style amount/account payload.
- **Payment-gated printing:** Failed payments set the job to `blocked`; successful payments call the configured printer endpoint or queue the job safely.
- **Admin rights:** Edit mono/colour copy prices, payment account, shop name, and printer endpoint; view transaction and document history.

## Local development

Install dependencies and run the Next.js app:

```bash
npm install
npm run dev
```

Open <http://localhost:3000>.

Demo logins:

- User: `user` / `user123`
- Admin: `admin` / `admin123`

## Deploy from GitHub to Vercel

This project is now a complete Next.js full-stack app, so Vercel can host both the website pages and API routes.

### Step-by-step hosting

1. Push this repository to GitHub.
2. Sign in to [Vercel](https://vercel.com/).
3. Choose **Add New → Project**.
4. Import your GitHub repository.
5. Use these Vercel project settings:
   - **Framework Preset:** Next.js
   - **Root Directory:** repository root
   - **Install Command:** `npm install`
   - **Build Command:** `npm run build`
   - **Output Directory:** leave empty
6. Click **Deploy**.
7. Open the Vercel deployment URL and log in with the demo user/admin credentials above.
8. Push future commits to GitHub; Vercel will automatically create new deployments.

## Printer endpoint / automatic printing

A Vercel serverless function cannot directly print to a USB/local printer connected to your shop computer. For real automatic printing from Vercel, run a small trusted print-agent service on the admin computer or shop LAN, then enter its HTTPS endpoint in the admin dashboard.

When payment succeeds, the app sends the job JSON to the configured printer endpoint. If no endpoint is configured, the job is marked `queued` so the admin can release it later.

## Production checklist

Before accepting real customers or money:

- Replace demo login handling with a secure auth provider or hashed-password database.
- Use managed persistent storage for settings/jobs/transactions, such as Vercel Postgres, Neon, Supabase, or another database.
- Use Vercel Blob or S3-compatible object storage for uploaded PDFs/images.
- Replace simulated payment success/failure buttons with a verified payment gateway webhook.
- Protect the printer endpoint with authentication and run it only on trusted infrastructure.

## Legacy Python prototype

`app.py` and `api/index.py` are kept as a standard-library Python prototype, but Vercel will deploy the Next.js full-stack app because this repository includes `package.json` and `vercel.json` with `framework: nextjs`.
