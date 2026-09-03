"""Canonical destination parsing for issuer destination-policy matching.

Implements the enforced subset of RFC 3986 canonicalization the verifier
promises publicly: lowercased scheme and host, IDNA-encoded hosts, a single
trailing host dot stripped, default ports dropped, percent-encoding
normalized (unreserved octets decoded, everything else uppercased), and
dot-segments resolved. Prefix matching is segment-boundary aware, so
"/pay" matches "/pay" and "/pay/now" but never "/payments".
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import TypeVar
from urllib.parse import urlsplit

_SCHEME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9+.\-]*:")
_PORT_AUTHORITY_RE = re.compile(r"^\d{1,5}(?:[/?#]|$)")
_DEFAULT_PORTS = {"http": 80, "https": 443}
_UNRESERVED = frozenset(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
)
_HEX = frozenset("0123456789abcdefABCDEF")
_DomainValue = TypeVar("_DomainValue")


class CanonicalizationError(ValueError):
    """The destination cannot be canonicalized; callers fail closed."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.cause = "normalization-failure"
        self.reason = reason


@dataclass(frozen=True)
class CanonicalDestination:
    scheme: str
    host: str
    port: int | None
    path: str
    query: str


def _normalize_percent_encoding(component: str) -> str:
    out: list[str] = []
    index = 0
    while index < len(component):
        char = component[index]
        if char != "%":
            out.append(char)
            index += 1
            continue
        digits = component[index + 1 : index + 3]
        if len(digits) != 2 or digits[0] not in _HEX or digits[1] not in _HEX:
            raise CanonicalizationError(
                "Destination contains a truncated or invalid percent escape "
                f"near index {index}"
            )
        value = int(digits, 16)
        if value == 0:
            raise CanonicalizationError("Destination contains an encoded null byte")
        decoded = chr(value)
        if decoded in _UNRESERVED:
            out.append(decoded)
        else:
            out.append("%" + digits.upper())
        index += 3
    return "".join(out)


def _remove_dot_segments(path: str) -> str:
    resolved: list[str] = []
    for segment in path.split("/")[1:]:
        if segment == ".":
            continue
        if segment == "..":
            if resolved:
                resolved.pop()
            continue
        resolved.append(segment)
    return "/" + "/".join(resolved)


def _strip_trailing_slashes(path: str) -> str:
    while len(path) > 1 and path.endswith("/"):
        path = path[:-1]
    return path


def _canonicalize_host(raw_host: str) -> str:
    host = raw_host.strip().lower()
    if host.endswith("."):
        host = host[:-1]
    if not host or "" in host.split("."):
        raise CanonicalizationError(
            f"Destination host {raw_host!r} is not a valid DNS name"
        )
    try:
        return host.encode("idna").decode("ascii")
    except UnicodeError as exc:
        raise CanonicalizationError(
            f"Destination host {raw_host!r} cannot be IDNA-encoded: {exc}"
        ) from exc


def canonicalize_verified_domain(raw_domain: str) -> str:
    """Return the canonical hostname key used by issuer domain proofs.

    Host labels are security-relevant: ``www.example`` and ``example`` remain
    distinct. Centralizing case, IDNA, and trailing-dot handling here keeps
    enrollment, projection, and matching on the same exact-host key space.
    """

    candidate = raw_domain.strip()
    if (
        not candidate
        or "://" in candidate
        or "/" in candidate
        or ":" in candidate
        or any(character.isspace() for character in candidate)
    ):
        raise CanonicalizationError("Verified domain must be a hostname, not a URL")
    host = _canonicalize_host(candidate)
    labels = host.split(".")
    if (
        len(host) > 253
        or any(not label or len(label) > 63 for label in labels)
        or any(label.startswith("-") or label.endswith("-") for label in labels)
        or any(
            character != "-" and not character.isalnum()
            for label in labels
            for character in label
        )
    ):
        raise CanonicalizationError("Verified domain is not a valid DNS hostname")
    return host


def canonicalize_verified_domain_map(
    verified_domains: Mapping[str, _DomainValue],
    *,
    ignore_blank: bool = False,
) -> dict[str, _DomainValue]:
    """Canonicalize domain keys and reject ambiguous post-normalization input."""

    normalized: dict[str, _DomainValue] = {}
    raw_keys: dict[str, str] = {}
    for raw_domain, value in verified_domains.items():
        if ignore_blank and not raw_domain.strip():
            continue
        domain = canonicalize_verified_domain(raw_domain)
        if domain in normalized:
            raise CanonicalizationError(
                "Verified domain keys "
                f"{raw_keys[domain]!r} and {raw_domain!r} both normalize to "
                f"{domain!r}"
            )
        normalized[domain] = value
        raw_keys[domain] = raw_domain
    return normalized


def canonicalize_destination(raw: str) -> CanonicalDestination:
    candidate = raw.strip()
    if not candidate:
        raise CanonicalizationError("Destination payload is empty")
    if "\\" in candidate:
        raise CanonicalizationError("Destination contains a backslash")
    if "\x00" in candidate:
        raise CanonicalizationError("Destination contains a null byte")
    scheme_match = _SCHEME_RE.match(candidate)
    if scheme_match:
        declared = scheme_match.group(0)[:-1].lower()
        suffix = candidate[scheme_match.end() :]
        if declared not in ("http", "https") and _PORT_AUTHORITY_RE.match(suffix):
            # RFC scheme syntax and a schemeless host:port authority are
            # lexically ambiguous. A numeric port makes the caller's URL intent
            # explicit enough to apply the same HTTPS default as host/path.
            candidate = f"https://{candidate}"
        elif declared not in ("http", "https"):
            raise CanonicalizationError(
                f"Destination scheme {declared!r} is not supported"
            )
    else:
        candidate = f"https://{candidate}"
    parsed = urlsplit(candidate)
    if parsed.username is not None or parsed.password is not None:
        raise CanonicalizationError(
            "Destination contains userinfo, which is not allowed"
        )
    if parsed.hostname is None:
        raise CanonicalizationError("Destination has no host")
    try:
        port = parsed.port
    except ValueError as exc:
        raise CanonicalizationError(f"Destination port is invalid: {exc}") from exc
    scheme = parsed.scheme.lower()
    host = _canonicalize_host(parsed.hostname)
    if port is not None and port == _DEFAULT_PORTS.get(scheme):
        port = None
    path = _strip_trailing_slashes(
        _remove_dot_segments(_normalize_percent_encoding(parsed.path or "/"))
    )
    query = _normalize_percent_encoding(parsed.query)
    return CanonicalDestination(
        scheme=scheme, host=host, port=port, path=path, query=query
    )


def canonicalize_rule_prefix(prefix: str) -> str:
    candidate = prefix.strip()
    if not candidate.startswith("/"):
        candidate = "/" + candidate
    return _strip_trailing_slashes(
        _remove_dot_segments(_normalize_percent_encoding(candidate))
    )


def path_matches_prefix(path: str, prefix: str) -> bool:
    if prefix == "/":
        return True
    return path == prefix or path.startswith(prefix + "/")
