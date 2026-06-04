import tempfile
import unittest
from pathlib import Path

import app


class PrinterOnlineTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.old_data = app.DATA_DIR
        self.old_upload = app.UPLOAD_DIR
        self.old_db = app.DB_PATH
        app.DATA_DIR = Path(self.tmp.name)
        app.UPLOAD_DIR = app.DATA_DIR / "uploads"
        app.DB_PATH = app.DATA_DIR / "test.sqlite3"
        app.init_db()

    def tearDown(self):
        app.DATA_DIR = self.old_data
        app.UPLOAD_DIR = self.old_upload
        app.DB_PATH = self.old_db
        self.tmp.cleanup()

    def test_default_users_and_prices_exist(self):
        settings = app.all_settings()
        self.assertEqual(settings["mono_price"], "2.00")
        self.assertEqual(settings["color_price"], "10.00")
        with app.db() as conn:
            users = {row["username"]: row["role"] for row in conn.execute("SELECT username, role FROM users")}
        self.assertEqual(users["user"], "user")
        self.assertEqual(users["admin"], "admin")

    def test_password_hash_verification(self):
        stored = app.hash_password("secret")
        self.assertTrue(app.verify_password("secret", stored))
        self.assertFalse(app.verify_password("wrong", stored))

    def test_payment_payload_contains_exact_amount_and_account(self):
        with app.db() as conn:
            cur = conn.execute(
                "INSERT INTO print_jobs(user_id, original_filename, stored_filename, content_type, print_type, copies, unit_price_rupees, amount_rupees, created_at) VALUES (1, 'a.pdf', 'a.pdf', 'application/pdf', 'color', 3, 10, 30, 1)"
            )
            job = conn.execute("SELECT * FROM print_jobs WHERE id=?", (cur.lastrowid,)).fetchone()
        payload = app.payment_payload(job)
        self.assertIn("pa=printershop%40upi", payload)
        self.assertIn("am=30.00", payload)
        self.assertIn("tn=PRINT-1", payload)

    def test_failed_payment_blocks_printing(self):
        with app.db() as conn:
            conn.execute(
                "INSERT INTO print_jobs(id, user_id, original_filename, stored_filename, content_type, print_type, copies, unit_price_rupees, amount_rupees, payment_status, print_status, printer_message, created_at) VALUES (7, 1, 'a.pdf', 'a.pdf', 'application/pdf', 'mono', 2, 2, 4, 'failed', 'blocked', 'Payment failed; print request blocked.', 1)"
            )
            job = conn.execute("SELECT * FROM print_jobs WHERE id=7").fetchone()
        self.assertEqual(job["payment_status"], "failed")
        self.assertEqual(job["print_status"], "blocked")
        self.assertIn("blocked", job["printer_message"])

    def test_vercel_handler_entrypoint_extends_app_handler(self):
        from api.index import handler

        self.assertTrue(issubclass(handler, app.App))


if __name__ == "__main__":
    unittest.main()
