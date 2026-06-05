# Printer Online SP

A modern online print shop web application with **User** and **Admin** roles. The runnable demo uses Next.js route handlers plus a shared Node domain layer; `backend/server.js` shows the equivalent Express API entry point for deployments that split frontend and backend services.

## Included features

- User registration, login, forgot-password request, signed JWT sessions, and role-based permissions.
- Upload PDF/JPG/JPEG/PNG documents with configurable max size, preview, estimated PDF page count, AES-256-GCM encrypted local storage, and optional virus scan command.
- Print settings: mono/color, copies, portrait/landscape, A4/A3, all pages or custom ranges.
- Automatic pricing: `price per page × billable pages × copies`.
- Dynamic UPI QR payload with exact amount, order ID, status tracking, and simulated gateway success/failure for local development.
- Automatic print dispatch only after verified payment success via admin printer command, default `lp`/`lpr`, or a local printer agent endpoint.
- User dashboard scoped to the logged-in user only.
- Admin dashboard for price, payment, printer, file-retention, order, transaction, and audit-log management.
- Privacy-safe admin order views: admins see file name, size, page count, settings, and statuses, but no document preview/download/open endpoint.
- PostgreSQL schema in `db/schema.sql`; equivalent MySQL types can be used for MySQL deployments.

## Run locally

```bash
npm install
npm run dev
```

Open <http://127.0.0.1:3000>.

Demo accounts:

- User: `user` / `user123`
- Admin: `admin` / `admin123`

## Environment variables

```bash
JWT_SECRET="replace-with-a-long-random-secret"
FILE_ENCRYPTION_KEY="replace-with-a-separate-random-secret"
PRINTER_DATA_DIR="./data-next"
```

Use HTTPS in production so JWTs and payment/order data are protected in transit.

## Printer integration

In **Admin → Printer management**, configure either:

- `printerCommand`, for the admin computer connected to a Windows/USB/network printer; or
- `printerEndpoint`, for a local print-agent service.

Supported command placeholders:

- `{file}` - temporary decrypted file path, available only during dispatch
- `{copies}` - number of copies
- `{type}` - `mono` or `color`
- `{orientation}` - `portrait` or `landscape`
- `{paperSize}` - `A4` or `A3`
- `{pages}` - `all` or the custom page range

Example Linux/macOS command:

```bash
lp -n {copies} -o media={paperSize} {file}
```

Example Windows command through a local script:

```bash
node C:\\print-agent\\print.js "{file}" "{copies}" "{type}" "{orientation}" "{paperSize}"
```

Printing is blocked unless payment status is `success`. Failed payments mark the order failed/blocked and never dispatch a print command.

## Payment integration notes

The local app generates UPI QR payloads and simulates payment verification. For production, connect Razorpay, PhonePe, Paytm, or BharatPe webhooks to the payment route so only signed gateway callbacks can set `paymentStatus=success`. Store only gateway response metadata, transaction ID, amount, status, and date; never store UPI PINs, card data, or banking credentials.

## Express backend

A separate Express API starter is provided:

```bash
npm run start:api
```

The Next.js app remains the primary runnable full-stack app for this repository, while the Express server demonstrates how to expose the same Node domain layer in a dedicated backend process.

## Production deployment checklist

1. Provision PostgreSQL or MySQL and apply `db/schema.sql`.
2. Replace the JSON demo store with database adapters using the schema.
3. Configure `JWT_SECRET`, `FILE_ENCRYPTION_KEY`, HTTPS, secure cookies if desired, and trusted CORS origins.
4. Configure a real payment gateway webhook and verify webhook signatures.
5. Configure ClamAV or another scanner with `virusScanCommand`.
6. Run the app on the admin computer or install a local print agent that can access the printer.
7. Schedule a retention cleanup job that deletes encrypted files after printing or after `retentionHours`.
8. Keep audit logs and gateway responses for reconciliation without exposing documents or banking details.

## Tests

```bash
npm test
python3 -m unittest tests/test_app.py
```
