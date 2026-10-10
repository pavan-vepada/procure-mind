"""Web server: a password gate, the API, and the built React app.

Run:  uv run uvicorn app.main:app --reload
"""
import hashlib
import hmac
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app import db
from app.api import router
from app.config import settings

app = FastAPI(title="Kill the Quote Spreadsheet")
SESSION = hashlib.sha256(f"session:{settings.app_password}".encode()).hexdigest()
WEB = Path("web/dist")


@app.middleware("http")
async def password_gate(request: Request, call_next):
    """Every API call needs the session cookie, because the API spends the OpenAI key."""
    path = request.url.path
    if path.startswith("/api") and path != "/api/login" and request.cookies.get("session") != SESSION:
        return JSONResponse({"detail": "Not signed in"}, status_code=401)
    return await call_next(request)


class Login(BaseModel):
    password: str


@app.post("/api/login")
def login(body: Login):
    if not hmac.compare_digest(body.password, settings.app_password):
        return JSONResponse({"detail": "Wrong password"}, status_code=401)
    response = JSONResponse({"ok": True})
    response.set_cookie("session", SESSION, httponly=True, samesite="lax", max_age=7 * 24 * 3600)
    return response


@app.post("/api/logout")
def logout():
    response = JSONResponse({"ok": True})
    response.delete_cookie("session")
    return response


app.include_router(router)
db.restore_demo()  # first start on a fresh machine: load the demo RFx from its committed snapshot

if WEB.exists():
    app.mount("/assets", StaticFiles(directory=WEB / "assets"), name="assets")

    @app.get("/{path:path}")
    def web_app(path: str):
        if path.startswith("api/"):
            return JSONResponse({"detail": "Not found"}, status_code=404)
        return FileResponse(WEB / "index.html")
