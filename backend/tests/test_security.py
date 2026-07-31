from __future__ import annotations

from backend.app.core.security import hash_password, verify_password


def test_hash_password_uses_bcrypt_and_verifies() -> None:
    hashed_password = hash_password("correct horse battery staple")

    assert hashed_password.startswith("$2")
    assert verify_password("correct horse battery staple", hashed_password) is True
    assert verify_password("incorrect password", hashed_password) is False
