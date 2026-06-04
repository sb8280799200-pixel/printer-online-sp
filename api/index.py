"""Vercel serverless entrypoint for Printer Online SP.

Vercel's Python runtime turns a file in /api that exposes a BaseHTTPRequestHandler
subclass named `handler` into a serverless function. The main app remains runnable
locally with `python3 app.py`.
"""
from app import App, init_db

init_db()


class handler(App):
    """Expose the standard-library request handler for Vercel."""

    pass
