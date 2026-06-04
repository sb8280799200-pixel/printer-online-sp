#!/usr/bin/env python3
"""Printer Online SP - a small self-contained print ordering web app.

Run with: python3 app.py
Default logins:
  user  / user123
  admin / admin123
"""
from __future__ import annotations

import hashlib
import html
import importlib
import importlib.util
import io
import json
import mimetypes
import os
import secrets
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.parse
from dataclasses import dataclass
from email.parser import BytesParser
from email.policy import default
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_DATA_DIR = Path(os.environ.get("PRINTER_DATA_DIR", "/tmp/printer-online-sp" if os.environ.get("VERCEL") else BASE_DIR / "data"))
DATA_DIR = DEFAULT_DATA_DIR
UPLOAD_DIR = DATA_DIR / "uploads"
DB_PATH = DATA_DIR / "printer_online.sqlite3"
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
ALLOWED_CONTENT_TYPES = {"application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp"}
ALLOWED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png", ".gif", ".webp"}

SESSIONS: dict[str, dict[str, str]] = {}


@dataclass
class User:
    id: int
    username: str
    role: str


def db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 120_000).hex()
    return f"{salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    salt, digest = stored.split("$", 1)
    return secrets.compare_digest(hash_password(password, salt), stored)


def init_db() -> None:
    DATA_DIR.mkdir(exist_ok=True)
    UPLOAD_DIR.mkdir(exist_ok=True)
    with db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('user','admin'))
            );
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS print_jobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                original_filename TEXT NOT NULL,
                stored_filename TEXT NOT NULL,
                content_type TEXT NOT NULL,
                print_type TEXT,
                copies INTEGER,
                unit_price_rupees REAL,
                amount_rupees REAL,
                payment_status TEXT NOT NULL DEFAULT 'pending',
                print_status TEXT NOT NULL DEFAULT 'not_ready',
                payment_reference TEXT,
                printer_message TEXT,
                created_at INTEGER NOT NULL,
                paid_at INTEGER,
                printed_at INTEGER,
                FOREIGN KEY(user_id) REFERENCES users(id)
            );
            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id INTEGER NOT NULL,
                amount_rupees REAL NOT NULL,
                status TEXT NOT NULL,
                payment_reference TEXT,
                created_at INTEGER NOT NULL,
                FOREIGN KEY(job_id) REFERENCES print_jobs(id)
            );
            """
        )
        for username, password, role in (("admin", "admin123", "admin"), ("user", "user123", "user")):
            conn.execute(
                "INSERT OR IGNORE INTO users(username, password_hash, role) VALUES (?, ?, ?)",
                (username, hash_password(password), role),
            )
        defaults = {
            "mono_price": "2.00",
            "color_price": "10.00",
            "payment_account": "printershop@upi",
            "shop_name": "Printer Online SP",
            "printer_command": "",
        }
        for key, value in defaults.items():
            conn.execute("INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)", (key, value))


def get_setting(key: str, fallback: str = "") -> str:
    with db() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return row["value"] if row else fallback


def all_settings() -> dict[str, str]:
    with db() as conn:
        return {row["key"]: row["value"] for row in conn.execute("SELECT key, value FROM settings")}


def money(value: Any) -> str:
    try:
        return f"₹{float(value):,.2f}"
    except (TypeError, ValueError):
        return "₹0.00"


def now() -> int:
    return int(time.time())


def fmt_ts(ts: Any) -> str:
    if not ts:
        return "—"
    return time.strftime("%Y-%m-%d %H:%M", time.localtime(int(ts)))


def h(value: Any) -> str:
    return html.escape(str(value), quote=True)


def payment_payload(job: sqlite3.Row) -> str:
    account = get_setting("payment_account", "printershop@upi")
    shop = urllib.parse.quote(get_setting("shop_name", "Printer Online SP"))
    amount = f"{float(job['amount_rupees'] or 0):.2f}"
    ref = urllib.parse.quote(f"PRINT-{job['id']}")
    return f"upi://pay?pa={urllib.parse.quote(account)}&pn={shop}&am={amount}&cu=INR&tn={ref}"


def payment_qr_svg(payload: str, amount: float) -> str:
    """Render a payment QR SVG.

    When the optional `qrcode` dependency is installed, this returns a scannable QR code.
    Otherwise it falls back to a deterministic QR-style SVG so the app remains runnable with
    only the Python standard library.
    """
    if importlib.util.find_spec("qrcode") is not None:
        qrcode = importlib.import_module("qrcode")
        svg_factory = importlib.import_module("qrcode.image.svg").SvgPathImage
        image = qrcode.make(payload, image_factory=svg_factory, border=2)
        buffer = io.BytesIO()
        image.save(buffer)
        svg = buffer.getvalue().decode("utf-8")
        return svg.replace("<svg ", f"<svg class=\"qr\" role=\"img\" aria-label=\"Payment QR for {money(amount)}\" ", 1)

    digest = hashlib.sha256(payload.encode()).digest()
    size = 29
    cell = 7
    pad = 12
    rects: list[str] = []

    def finder(x: int, y: int) -> None:
        for yy in range(7):
            for xx in range(7):
                border = xx in (0, 6) or yy in (0, 6)
                center = 2 <= xx <= 4 and 2 <= yy <= 4
                if border or center:
                    rects.append(f'<rect x="{pad + (x + xx) * cell}" y="{pad + (y + yy) * cell}" width="{cell}" height="{cell}"/>')

    finder(0, 0)
    finder(size - 7, 0)
    finder(0, size - 7)
    bit_index = 0
    for y in range(size):
        for x in range(size):
            if (x < 8 and y < 8) or (x >= size - 8 and y < 8) or (x < 8 and y >= size - 8):
                continue
            b = digest[(bit_index // 8) % len(digest)]
            bit = (b >> (bit_index % 8)) & 1
            if bit or ((x * 3 + y * 5 + digest[0]) % 11 == 0):
                rects.append(f'<rect x="{pad + x * cell}" y="{pad + y * cell}" width="{cell}" height="{cell}"/>')
            bit_index += 1
    svg_size = size * cell + pad * 2
    return (
        f'<svg class="qr" role="img" aria-label="Payment QR for {money(amount)}" '
        f'viewBox="0 0 {svg_size} {svg_size}" xmlns="http://www.w3.org/2000/svg">'
        f'<rect width="100%" height="100%" fill="#fff"/><g fill="#111">{"".join(rects)}</g></svg>'
    )


def layout(title: str, body: str, user: User | None = None) -> bytes:
    nav = '<a href="/">Home</a>'
    if user:
        nav += ' <a href="/upload">New print</a>'
        if user.role == "admin":
            nav += ' <a href="/admin">Admin</a>'
        nav += f' <span class="pill">{h(user.username)} ({h(user.role)})</span> <a href="/logout">Logout</a>'
    else:
        nav += ' <a href="/login">Login</a>'
    page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{h(title)} · Printer Online SP</title>
<link rel="stylesheet" href="/static/style.css">
</head>
<body>
<header><h1>Printer Online SP</h1><nav>{nav}</nav></header>
<main>{body}</main>
<footer>Upload → choose mono/color and copies → pay exact amount → approved jobs print automatically.</footer>
</body></html>"""
    return page.encode()


class App(BaseHTTPRequestHandler):
    server_version = "PrinterOnlineSP/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("%s - - [%s] %s\n" % (self.client_address[0], self.log_date_time_string(), fmt % args))

    def send_html(self, title: str, body: str, status: HTTPStatus = HTTPStatus.OK, user: User | None = None) -> None:
        data = layout(title, body, user)
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def redirect(self, path: str) -> None:
        self.send_response(HTTPStatus.SEE_OTHER)
        self.send_header("Location", path)
        self.end_headers()

    def current_user(self) -> User | None:
        cookie = SimpleCookie(self.headers.get("Cookie", ""))
        sid = cookie.get("sid")
        if not sid or sid.value not in SESSIONS:
            return None
        session = SESSIONS[sid.value]
        with db() as conn:
            row = conn.execute("SELECT id, username, role FROM users WHERE id=?", (session["user_id"],)).fetchone()
        return User(row["id"], row["username"], row["role"]) if row else None

    def require_user(self) -> User | None:
        user = self.current_user()
        if not user:
            self.redirect("/login")
        return user

    def parse_form(self) -> dict[str, str]:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length)
        return {k: v[0] for k, v in urllib.parse.parse_qs(raw.decode(), keep_blank_values=True).items()}

    def parse_multipart(self) -> tuple[dict[str, str], dict[str, Any]]:
        length = int(self.headers.get("Content-Length", "0"))
        if length > MAX_UPLOAD_BYTES:
            raise ValueError("Upload is too large. Maximum file size is 25 MB.")
        body = self.rfile.read(length)
        content_type = self.headers.get("Content-Type", "")
        msg = BytesParser(policy=default).parsebytes(f"Content-Type: {content_type}\r\n\r\n".encode() + body)
        fields: dict[str, str] = {}
        files: dict[str, Any] = {}
        for part in msg.iter_parts():
            name = part.get_param("name", header="content-disposition")
            filename = part.get_filename()
            payload = part.get_payload(decode=True) or b""
            if filename:
                files[name] = {"filename": filename, "content_type": part.get_content_type(), "data": payload}
            elif name:
                fields[name] = payload.decode(errors="replace")
        return fields, files

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        user = self.current_user()
        if path == "/static/style.css":
            self.serve_static_css()
        elif path == "/":
            self.home(user)
        elif path == "/login":
            self.login_form(user)
        elif path == "/logout":
            self.logout()
        elif path == "/upload":
            if u := self.require_user():
                self.upload_form(u)
        elif path.startswith("/job/"):
            if u := self.require_user():
                self.job_page(u, int(path.rsplit("/", 1)[-1]))
        elif path == "/admin":
            if u := self.require_user():
                self.admin_page(u)
        else:
            self.send_html("Not found", "<section class='card'><h2>404</h2><p>Page not found.</p></section>", HTTPStatus.NOT_FOUND, user)

    def do_POST(self) -> None:
        path = urllib.parse.urlparse(self.path).path
        if path == "/login":
            self.login_submit()
        elif path == "/upload":
            if u := self.require_user():
                self.upload_submit(u)
        elif path.startswith("/job/") and path.endswith("/options"):
            if u := self.require_user():
                self.options_submit(u, int(path.split("/")[2]))
        elif path.startswith("/job/") and path.endswith("/pay"):
            if u := self.require_user():
                self.pay_submit(u, int(path.split("/")[2]))
        elif path == "/admin/settings":
            if u := self.require_user():
                self.admin_settings_submit(u)
        else:
            self.send_html("Not found", "<section class='card'><h2>404</h2><p>Page not found.</p></section>", HTTPStatus.NOT_FOUND, self.current_user())

    def serve_static_css(self) -> None:
        data = CSS.encode()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/css; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def home(self, user: User | None) -> None:
        body = """
<section class="hero"><div><h2>Online print orders with payment-controlled printing</h2>
<p>Users upload an image or PDF, choose mono or colour copies, pay the calculated rupee amount, and only successful payments are released to the printer.</p>
<p><a class="button" href="/upload">Start a print order</a> <a class="button secondary" href="/admin">Admin dashboard</a></p></div></section>
<section class="grid"><article class="card"><h3>User rights</h3><ul><li>Login securely.</li><li>Upload PDF/image documents.</li><li>Select mono/colour and number of copies.</li><li>Pay the exact generated amount.</li></ul></article>
<article class="card"><h3>Admin rights</h3><ul><li>Edit mono and colour rates.</li><li>Set payment account and printer command.</li><li>Review payment and document history.</li></ul></article></section>
"""
        self.send_html("Home", body, user=user)

    def login_form(self, user: User | None) -> None:
        if user:
            self.redirect("/")
            return
        self.send_html("Login", LOGIN_FORM)

    def login_submit(self) -> None:
        form = self.parse_form()
        with db() as conn:
            row = conn.execute("SELECT * FROM users WHERE username=?", (form.get("username", ""),)).fetchone()
        if not row or not verify_password(form.get("password", ""), row["password_hash"]):
            self.send_html("Login", LOGIN_FORM + "<p class='error'>Invalid username or password.</p>", HTTPStatus.UNAUTHORIZED)
            return
        sid = secrets.token_urlsafe(32)
        SESSIONS[sid] = {"user_id": str(row["id"])}
        self.send_response(HTTPStatus.SEE_OTHER)
        self.send_header("Location", "/admin" if row["role"] == "admin" else "/upload")
        self.send_header("Set-Cookie", f"sid={sid}; HttpOnly; SameSite=Lax; Path=/")
        self.end_headers()

    def logout(self) -> None:
        cookie = SimpleCookie(self.headers.get("Cookie", ""))
        if sid := cookie.get("sid"):
            SESSIONS.pop(sid.value, None)
        self.send_response(HTTPStatus.SEE_OTHER)
        self.send_header("Location", "/")
        self.send_header("Set-Cookie", "sid=; Max-Age=0; Path=/")
        self.end_headers()

    def upload_form(self, user: User) -> None:
        body = """
<section class="card"><h2>Upload print document</h2>
<form method="post" enctype="multipart/form-data" action="/upload">
<label>Image or PDF file <input type="file" name="document" accept="application/pdf,image/*" required></label>
<button type="submit">Upload and continue</button>
</form><p class="hint">Allowed: PDF, JPG, PNG, GIF, WebP up to 25 MB.</p></section>
"""
        self.send_html("Upload", body, user=user)

    def upload_submit(self, user: User) -> None:
        try:
            _fields, files = self.parse_multipart()
            document = files.get("document")
            if not document:
                raise ValueError("Choose a file to upload.")
            original = Path(document["filename"]).name
            ext = Path(original).suffix.lower()
            ctype = document["content_type"]
            if ext not in ALLOWED_EXTENSIONS or ctype not in ALLOWED_CONTENT_TYPES:
                raise ValueError("Only PDF and image files are allowed.")
            stored = f"{int(time.time())}-{secrets.token_hex(12)}{ext}"
            (UPLOAD_DIR / stored).write_bytes(document["data"])
            with db() as conn:
                cur = conn.execute(
                    "INSERT INTO print_jobs(user_id, original_filename, stored_filename, content_type, created_at) VALUES (?, ?, ?, ?, ?)",
                    (user.id, original, stored, ctype, now()),
                )
                job_id = cur.lastrowid
            self.redirect(f"/job/{job_id}")
        except ValueError as exc:
            self.send_html("Upload", f"<section class='card'><h2>Upload failed</h2><p class='error'>{h(exc)}</p><p><a href='/upload'>Try again</a></p></section>", HTTPStatus.BAD_REQUEST, user)

    def get_job(self, job_id: int, user: User) -> sqlite3.Row | None:
        with db() as conn:
            if user.role == "admin":
                return conn.execute("SELECT j.*, u.username FROM print_jobs j JOIN users u ON u.id=j.user_id WHERE j.id=?", (job_id,)).fetchone()
            return conn.execute("SELECT j.*, u.username FROM print_jobs j JOIN users u ON u.id=j.user_id WHERE j.id=? AND j.user_id=?", (job_id, user.id)).fetchone()

    def job_page(self, user: User, job_id: int) -> None:
        job = self.get_job(job_id, user)
        if not job:
            self.send_html("Job not found", "<section class='card'><h2>Job not found</h2></section>", HTTPStatus.NOT_FOUND, user)
            return
        if not job["print_type"]:
            settings = all_settings()
            body = f"""
<section class="card"><h2>Print options for #{job['id']}</h2><p>Document: <strong>{h(job['original_filename'])}</strong></p>
<form method="post" action="/job/{job['id']}/options">
<label>Printing type <select name="print_type"><option value="mono">Mono / black & white ({money(settings['mono_price'])} per copy)</option><option value="color">Colour ({money(settings['color_price'])} per copy)</option></select></label>
<label>How many copies? <input type="number" name="copies" min="1" max="500" value="1" required></label>
<button type="submit">Calculate amount</button></form></section>"""
        else:
            payload = payment_payload(job)
            qr = payment_qr_svg(payload, float(job["amount_rupees"] or 0))
            pay_controls = ""
            if job["payment_status"] == "pending":
                pay_controls = f"""
<form method="post" action="/job/{job['id']}/pay" class="actions">
<button name="result" value="success" type="submit">Simulate payment success</button>
<button class="danger" name="result" value="fail" type="submit">Simulate payment fail</button></form>"""
            body = f"""
<section class="card"><h2>Payment for print job #{job['id']}</h2>
<div class="summary"><p><strong>Document:</strong> {h(job['original_filename'])}</p><p><strong>Type:</strong> {h(job['print_type'])}</p><p><strong>Copies:</strong> {job['copies']}</p><p><strong>Unit price:</strong> {money(job['unit_price_rupees'])}</p><p class="amount"><strong>Total:</strong> {money(job['amount_rupees'])}</p></div>
<div class="paybox">{qr}<div><h3>Scan/pay exact amount</h3><p><strong>Account:</strong> {h(get_setting('payment_account'))}</p><p><strong>Reference:</strong> PRINT-{job['id']}</p><p class="payload">{h(payload)}</p></div></div>
{pay_controls}
<p><strong>Payment status:</strong> <span class="status {h(job['payment_status'])}">{h(job['payment_status'])}</span></p>
<p><strong>Print status:</strong> <span class="status {h(job['print_status'])}">{h(job['print_status'])}</span></p>
<p class="hint">Failed payment jobs are not sent to the printer.</p>
{('<p class="hint">Printer message: ' + h(job['printer_message']) + '</p>') if job['printer_message'] else ''}</section>"""
        self.send_html("Print job", body, user=user)

    def options_submit(self, user: User, job_id: int) -> None:
        job = self.get_job(job_id, user)
        if not job:
            self.send_html("Job not found", "<section class='card'><h2>Job not found</h2></section>", HTTPStatus.NOT_FOUND, user)
            return
        form = self.parse_form()
        print_type = form.get("print_type", "mono")
        if print_type not in {"mono", "color"}:
            print_type = "mono"
        copies = max(1, min(500, int(form.get("copies") or "1")))
        unit = float(get_setting("color_price" if print_type == "color" else "mono_price", "0"))
        amount = round(unit * copies, 2)
        with db() as conn:
            conn.execute(
                "UPDATE print_jobs SET print_type=?, copies=?, unit_price_rupees=?, amount_rupees=?, payment_status='pending', print_status='not_ready' WHERE id=?",
                (print_type, copies, unit, amount, job_id),
            )
        self.redirect(f"/job/{job_id}")

    def pay_submit(self, user: User, job_id: int) -> None:
        job = self.get_job(job_id, user)
        if not job:
            self.send_html("Job not found", "<section class='card'><h2>Job not found</h2></section>", HTTPStatus.NOT_FOUND, user)
            return
        form = self.parse_form()
        success = form.get("result") == "success"
        ref = f"PAY-{job_id}-{secrets.token_hex(4).upper()}"
        status = "success" if success else "failed"
        printer_message = "Payment failed; print request blocked."
        print_status = "blocked"
        printed_at = None
        paid_at = now() if success else None
        if success:
            print_status, printer_message, printed_at = self.dispatch_print(job_id)
        with db() as conn:
            conn.execute(
                "UPDATE print_jobs SET payment_status=?, payment_reference=?, paid_at=?, print_status=?, printer_message=?, printed_at=? WHERE id=?",
                (status, ref, paid_at, print_status, printer_message, printed_at, job_id),
            )
            conn.execute(
                "INSERT INTO transactions(job_id, amount_rupees, status, payment_reference, created_at) VALUES (?, ?, ?, ?, ?)",
                (job_id, job["amount_rupees"], status, ref, now()),
            )
        self.redirect(f"/job/{job_id}")

    def dispatch_print(self, job_id: int) -> tuple[str, str, int | None]:
        with db() as conn:
            job = conn.execute("SELECT * FROM print_jobs WHERE id=?", (job_id,)).fetchone()
        path = UPLOAD_DIR / job["stored_filename"]
        command = get_setting("printer_command", "").strip()
        if command:
            try:
                result = subprocess.run(command.replace("{file}", str(path)).replace("{copies}", str(job["copies"])).replace("{type}", job["print_type"]), shell=True, check=False, capture_output=True, text=True, timeout=60)
                if result.returncode == 0:
                    return "sent", (result.stdout or "Print command completed successfully.").strip(), now()
                return "failed", (result.stderr or result.stdout or f"Print command exited {result.returncode}.").strip(), None
            except Exception as exc:  # command execution failures should not crash the web request
                return "failed", f"Print command failed: {exc}", None
        system = shutil.which("lp") or shutil.which("lpr")
        if system:
            args = [system]
            if Path(system).name == "lp":
                args += ["-n", str(job["copies"])]
            args.append(str(path))
            result = subprocess.run(args, check=False, capture_output=True, text=True, timeout=60)
            if result.returncode == 0:
                return "sent", (result.stdout or "Sent to default printer.").strip(), now()
            return "failed", (result.stderr or result.stdout or f"Printer command exited {result.returncode}.").strip(), None
        return "queued", "No OS printer command configured. Job is safely queued for the admin system.", now()

    def admin_page(self, user: User) -> None:
        if user.role != "admin":
            self.send_html("Forbidden", "<section class='card'><h2>Admin only</h2></section>", HTTPStatus.FORBIDDEN, user)
            return
        settings = all_settings()
        with db() as conn:
            jobs = conn.execute("SELECT j.*, u.username FROM print_jobs j JOIN users u ON u.id=j.user_id ORDER BY j.created_at DESC LIMIT 100").fetchall()
            txns = conn.execute("SELECT t.*, j.original_filename FROM transactions t JOIN print_jobs j ON j.id=t.job_id ORDER BY t.created_at DESC LIMIT 100").fetchall()
        job_rows = "".join(
            f"<tr><td>#{r['id']}</td><td>{h(r['username'])}</td><td>{h(r['original_filename'])}</td><td>{h(r['print_type'] or '—')}</td><td>{h(r['copies'] or '—')}</td><td>{money(r['amount_rupees'])}</td><td>{h(r['payment_status'])}</td><td>{h(r['print_status'])}</td><td>{fmt_ts(r['created_at'])}</td></tr>" for r in jobs
        ) or "<tr><td colspan='9'>No print jobs yet.</td></tr>"
        txn_rows = "".join(
            f"<tr><td>#{r['id']}</td><td>Job #{r['job_id']}</td><td>{h(r['original_filename'])}</td><td>{money(r['amount_rupees'])}</td><td>{h(r['status'])}</td><td>{h(r['payment_reference'] or '—')}</td><td>{fmt_ts(r['created_at'])}</td></tr>" for r in txns
        ) or "<tr><td colspan='7'>No transactions yet.</td></tr>"
        body = f"""
<section class="card"><h2>Admin settings</h2>
<form method="post" action="/admin/settings" class="settings">
<label>Mono price per copy (₹) <input name="mono_price" type="number" min="0" step="0.01" value="{h(settings['mono_price'])}" required></label>
<label>Colour price per copy (₹) <input name="color_price" type="number" min="0" step="0.01" value="{h(settings['color_price'])}" required></label>
<label>Online payment account / UPI ID <input name="payment_account" value="{h(settings['payment_account'])}" required></label>
<label>Shop/payment display name <input name="shop_name" value="{h(settings['shop_name'])}" required></label>
<label>Printer command (optional; use {{file}}, {{copies}}, {{type}}) <input name="printer_command" value="{h(settings.get('printer_command',''))}" placeholder="lp -n {{copies}} {{file}}"></label>
<button type="submit">Save admin settings</button></form></section>
<section class="card"><h2>Printing document history</h2><div class="tablewrap"><table><thead><tr><th>Job</th><th>User</th><th>Document</th><th>Type</th><th>Copies</th><th>Amount</th><th>Payment</th><th>Print</th><th>Created</th></tr></thead><tbody>{job_rows}</tbody></table></div></section>
<section class="card"><h2>Online payment transaction history</h2><div class="tablewrap"><table><thead><tr><th>ID</th><th>Job</th><th>Document</th><th>Amount</th><th>Status</th><th>Reference</th><th>Date</th></tr></thead><tbody>{txn_rows}</tbody></table></div></section>"""
        self.send_html("Admin", body, user=user)

    def admin_settings_submit(self, user: User) -> None:
        if user.role != "admin":
            self.send_html("Forbidden", "<section class='card'><h2>Admin only</h2></section>", HTTPStatus.FORBIDDEN, user)
            return
        form = self.parse_form()
        updates = {
            "mono_price": f"{max(0, float(form.get('mono_price') or 0)):.2f}",
            "color_price": f"{max(0, float(form.get('color_price') or 0)):.2f}",
            "payment_account": form.get("payment_account", "").strip() or "printershop@upi",
            "shop_name": form.get("shop_name", "").strip() or "Printer Online SP",
            "printer_command": form.get("printer_command", "").strip(),
        }
        with db() as conn:
            for key, value in updates.items():
                conn.execute("INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))
        self.redirect("/admin")


LOGIN_FORM = """
<section class="card auth"><h2>Login</h2>
<form method="post" action="/login">
<label>Username <input name="username" autocomplete="username" required></label>
<label>Password <input name="password" type="password" autocomplete="current-password" required></label>
<button type="submit">Login</button>
</form><p class="hint">Demo user: <code>user/user123</code> · admin: <code>admin/admin123</code></p></section>
"""

CSS = """
:root{--ink:#172033;--muted:#63708a;--brand:#2563eb;--ok:#059669;--bad:#dc2626;--paper:#fff;--bg:#eef4ff}*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif;background:linear-gradient(135deg,#eef4ff,#f8fafc);color:var(--ink)}header,main,footer{max-width:1100px;margin:auto}header{display:flex;align-items:center;justify-content:space-between;padding:24px 18px}h1{font-size:24px;margin:0}nav{display:flex;gap:14px;align-items:center;flex-wrap:wrap}a{color:var(--brand);font-weight:700;text-decoration:none}.pill{background:#dbeafe;border-radius:999px;padding:6px 10px;color:#1e40af}main{padding:0 18px 30px}.hero{background:radial-gradient(circle at top left,#60a5fa,#1d4ed8);color:white;border-radius:28px;padding:46px;margin-bottom:22px;box-shadow:0 20px 50px #1e3a8a33}.hero h2{font-size:42px;line-height:1.05;margin:0 0 14px}.hero p{max-width:760px;font-size:18px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px}.card{background:rgba(255,255,255,.9);border:1px solid #dbe3f0;border-radius:22px;padding:24px;margin-bottom:20px;box-shadow:0 14px 35px #0f172a12}.auth{max-width:480px;margin:30px auto}label{display:block;margin:14px 0 8px;font-weight:700}input,select{width:100%;padding:12px 14px;border:1px solid #cbd5e1;border-radius:12px;font:inherit;background:white}button,.button{display:inline-block;border:0;border-radius:12px;background:var(--brand);color:white;padding:12px 16px;font-weight:800;cursor:pointer;margin-top:12px}.secondary{background:#0f172a}.danger{background:var(--bad)}.error{color:var(--bad);font-weight:800}.hint{color:var(--muted)}.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}.amount{font-size:24px;color:#0f766e}.paybox{display:grid;grid-template-columns:auto 1fr;gap:22px;align-items:center;margin:20px 0}.qr{width:230px;border:10px solid white;border-radius:18px;box-shadow:0 10px 30px #0f172a22}.payload{word-break:break-all;color:var(--muted);font-size:13px}.status{font-weight:900;text-transform:uppercase}.success,.sent,.queued{color:var(--ok)}.failed,.blocked{color:var(--bad)}.pending,.not_ready{color:#ca8a04}.actions{display:flex;gap:12px;flex-wrap:wrap}.settings{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px;align-items:end}.tablewrap{overflow:auto}table{width:100%;border-collapse:collapse;min-width:820px}th,td{text-align:left;border-bottom:1px solid #e2e8f0;padding:10px;vertical-align:top}th{background:#f8fafc}footer{padding:22px 18px 40px;color:var(--muted)}@media(max-width:700px){header{align-items:flex-start;flex-direction:column}.hero{padding:28px}.hero h2{font-size:31px}.paybox{grid-template-columns:1fr}.qr{width:100%;max-width:250px}}
"""


def main() -> None:
    init_db()
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), App)
    print(f"Printer Online SP running at http://127.0.0.1:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
