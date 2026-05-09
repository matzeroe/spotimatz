from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
from dataclasses import dataclass
from pathlib import Path
from time import time

from .config import ROOT_DIR


AUTH_DB = ROOT_DIR / "data" / "auth.json"
SESSION_COOKIE = "spotimatz_session"
SESSION_TTL_SECONDS = 60 * 60 * 24 * 30
INVITE_TTL_SECONDS = 60 * 60 * 24 * 7


@dataclass(frozen=True)
class AuthUser:
    id: str
    username: str
    role: str


class AuthStore:
    def __init__(self, path: Path = AUTH_DB) -> None:
        self.path = path

    def has_users(self) -> bool:
        return bool(self._load()["users"])

    def get_session_user(self, token: str | None) -> AuthUser | None:
        if not token:
            return None
        data = self._load()
        session = data["sessions"].get(token)
        if not session or session.get("expires_at", 0) < time():
            if session:
                data["sessions"].pop(token, None)
                self._save(data)
            return None
        user = data["users"].get(session.get("user_id", ""))
        if not user:
            return None
        return AuthUser(id=user["id"], username=user["username"], role=user.get("role", "user"))

    def setup_admin(self, username: str, password: str) -> tuple[AuthUser, str]:
        username = _clean_username(username)
        _validate_password(password)
        data = self._load()
        if data["users"]:
            raise ValueError("Setup is already complete.")
        user = self._create_user(data, username, password, role="admin")
        token = self._create_session(data, user.id)
        self._save(data)
        return user, token

    def login(self, username: str, password: str) -> tuple[AuthUser, str]:
        username = _clean_username(username)
        data = self._load()
        for stored in data["users"].values():
            if stored["username"].lower() != username.lower():
                continue
            if not _verify_password(password, stored["password_hash"]):
                break
            user = AuthUser(id=stored["id"], username=stored["username"], role=stored.get("role", "user"))
            token = self._create_session(data, user.id)
            self._save(data)
            return user, token
        raise ValueError("Invalid username or password.")

    def logout(self, token: str | None) -> None:
        if not token:
            return
        data = self._load()
        data["sessions"].pop(token, None)
        self._save(data)

    def create_invite(self, created_by: str, note: str = "") -> dict:
        data = self._load()
        token = secrets.token_urlsafe(24)
        invite = {
            "token": token,
            "created_by": created_by,
            "note": note.strip()[:500],
            "created_at": time(),
            "expires_at": time() + INVITE_TTL_SECONDS,
            "used_by": "",
            "used_at": 0,
        }
        data["invites"][token] = invite
        self._save(data)
        return invite

    def list_users(self) -> list[dict]:
        data = self._load()
        return [
            {
                "id": user["id"],
                "username": user["username"],
                "role": user.get("role", "user"),
                "is_admin": user.get("role") == "admin",
                "created_at": user.get("created_at", 0),
            }
            for user in data["users"].values()
        ]

    def list_invites(self) -> list[dict]:
        data = self._load()
        return [
            {
                "token": invite["token"],
                "created_by": invite.get("created_by", ""),
                "note": invite.get("note", ""),
                "created_at": invite.get("created_at", 0),
                "expires_at": invite.get("expires_at", 0),
                "used_by": invite.get("used_by", ""),
                "used_at": invite.get("used_at", 0),
                "expired": invite.get("expires_at", 0) < time(),
            }
            for invite in data["invites"].values()
        ]

    def revoke_invite(self, token: str) -> None:
        data = self._load()
        if token not in data["invites"]:
            raise ValueError("Invite not found.")
        data["invites"].pop(token, None)
        self._save(data)

    def delete_user(self, user_id: str, requested_by: str) -> None:
        data = self._load()
        user = data["users"].get(user_id)
        if not user:
            raise ValueError("User not found.")
        if user_id == requested_by:
            raise ValueError("You cannot delete your own account.")
        if user.get("role") == "admin":
            admin_count = sum(1 for item in data["users"].values() if item.get("role") == "admin")
            if admin_count <= 1:
                raise ValueError("Cannot delete the last admin.")
        data["users"].pop(user_id, None)
        for token, session in list(data["sessions"].items()):
            if session.get("user_id") == user_id:
                data["sessions"].pop(token, None)
        self._save(data)

    def get_invite(self, token: str) -> dict | None:
        invite = self._load()["invites"].get(token)
        if not invite or invite.get("used_by") or invite.get("expires_at", 0) < time():
            return None
        return invite

    def accept_invite(self, token: str, username: str, password: str) -> tuple[AuthUser, str]:
        username = _clean_username(username)
        _validate_password(password)
        data = self._load()
        invite = data["invites"].get(token)
        if not invite or invite.get("used_by") or invite.get("expires_at", 0) < time():
            raise ValueError("Invite link is invalid or expired.")
        user = self._create_user(data, username, password, role="user")
        invite["used_by"] = user.id
        invite["used_at"] = time()
        session = self._create_session(data, user.id)
        self._save(data)
        return user, session

    def generate_invite_account(self, token: str) -> tuple[AuthUser, str]:
        data = self._load()
        invite = data["invites"].get(token)
        if not invite or invite.get("used_by") or invite.get("expires_at", 0) < time():
            raise ValueError("Invite link is invalid or expired.")

        for _ in range(20):
            username = f"user-{secrets.token_hex(3)}"
            if not any(user["username"].lower() == username for user in data["users"].values()):
                break
        else:
            raise ValueError("Could not generate a unique account id.")

        password = secrets.token_urlsafe(12)
        user = self._create_user(data, username, password, role="user")
        invite["used_by"] = user.id
        invite["used_at"] = time()
        self._save(data)
        return user, password

    def _create_user(self, data: dict, username: str, password: str, role: str) -> AuthUser:
        if any(user["username"].lower() == username.lower() for user in data["users"].values()):
            raise ValueError("Username already exists.")
        user_id = secrets.token_urlsafe(12)
        stored = {
            "id": user_id,
            "username": username,
            "role": role,
            "password_hash": _hash_password(password),
            "created_at": time(),
        }
        data["users"][user_id] = stored
        return AuthUser(id=user_id, username=username, role=role)

    def _create_session(self, data: dict, user_id: str) -> str:
        token = secrets.token_urlsafe(32)
        data["sessions"][token] = {"user_id": user_id, "created_at": time(), "expires_at": time() + SESSION_TTL_SECONDS}
        return token

    def _load(self) -> dict:
        if not self.path.exists():
            return {"users": {}, "sessions": {}, "invites": {}}
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            data = {}
        return {
            "users": data.get("users", {}),
            "sessions": data.get("sessions", {}),
            "invites": data.get("invites", {}),
        }

    def _save(self, data: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
        tmp.replace(self.path)


def public_user(user: AuthUser | None) -> dict | None:
    if not user:
        return None
    return {"id": user.id, "username": user.username, "role": user.role, "is_admin": user.role == "admin"}


def _clean_username(username: str) -> str:
    clean = username.strip()
    if len(clean) < 2:
        raise ValueError("Username must be at least 2 characters.")
    if len(clean) > 40:
        raise ValueError("Username must be 40 characters or less.")
    return clean


def _validate_password(password: str) -> None:
    if len(password) < 8:
        raise ValueError("Password must be at least 8 characters.")


def _hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 260_000)
    return f"pbkdf2_sha256${base64.b64encode(salt).decode()}${base64.b64encode(digest).decode()}"


def _verify_password(password: str, stored_hash: str) -> bool:
    try:
        algorithm, salt_b64, digest_b64 = stored_hash.split("$", 2)
        if algorithm != "pbkdf2_sha256":
            return False
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(digest_b64)
    except Exception:
        return False
    actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 260_000)
    return hmac.compare_digest(actual, expected)
