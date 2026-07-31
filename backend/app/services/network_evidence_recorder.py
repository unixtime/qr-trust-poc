from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from hashlib import sha256
from typing import Any
from urllib.parse import urlparse

import asyncpg

from backend.app.core.config import config
from backend.app.schemas.poc import ScannerDecisionResponse, ScannerDecisionSignal


_SCANNER_DECISION_INSERT = """
insert into qr_trust.scanner_decisions (
  decision_id,
  verifier_id,
  decision_color,
  decision_state,
  reason_codes,
  risk_score,
  destination_url,
  destination_fingerprint,
  root_program_id,
  delegated_authority_id,
  issuer_id,
  destination_policy_id,
  usage_policy,
  hold_to_open_required,
  hold_to_open_duration_ms,
  decision_path,
  created_at
) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17::timestamptz)
on conflict (decision_id) do nothing
""".strip()

_RUNTIME_OBSERVATION_INSERT = """
insert into qr_trust.runtime_observations (
  provider_id,
  destination_host,
  destination_url,
  final_url,
  verdict,
  risk_score,
  reason_codes,
  observed_at,
  expires_at
) values ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz, $9::timestamptz)
""".strip()

_EVENT_OUTBOX_INSERT = """
insert into qr_trust.event_outbox (
  event_id,
  event_type,
  aggregate_type,
  aggregate_id,
  artifact_id,
  artifact_hash,
  root_program_id,
  delegated_authority_id,
  issuer_id,
  destination_policy_id,
  payload
) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
on conflict (event_id) do nothing
""".strip()

_RUNTIME_PROVIDER_ID = "deterministic-runtime-safety"
_SCANNER_DECISION_EVENT_TYPE = "scanner.decision.recorded"
_RUNTIME_VERDICT_BY_STATE = {
    "clean": "clear",
    "risky": "risky",
    "blocked": "blocked",
    "stale": "unknown",
    "unavailable": "unavailable",
}
_RUNTIME_RISK_BY_VERDICT = {
    "clear": 0,
    "risky": 35,
    "blocked": 70,
    "unknown": 30,
    "unavailable": 30,
}


@dataclass(frozen=True)
class EvidenceRecordingResult:
    scanner_decisions_inserted: int = 0
    runtime_observations_inserted: int = 0
    scanner_events_enqueued: int = 0
    error: str | None = None


async def record_scanner_evidence(
    response: ScannerDecisionResponse,
) -> EvidenceRecordingResult:
    dsn = config.QRTRUST_NETWORK_DATABASE_URL
    if not dsn or response.contract is None:
        return EvidenceRecordingResult()

    connection: asyncpg.Connection | None = None
    scanner_decisions_inserted = 0
    runtime_observations_inserted = 0
    scanner_events_enqueued = 0
    try:
        connection = await asyncpg.connect(
            _asyncpg_dsn(dsn),
            timeout=1.5,
            command_timeout=2.0,
        )
        async with connection.transaction():
            scanner_status = await connection.execute(
                _SCANNER_DECISION_INSERT,
                response.contract.decision_id,
                config.QRTRUST_SCANNER_VERIFIER_ID,
                response.contract.decision_color,
                response.contract.decision_state,
                response.contract.reason_codes,
                response.contract.risk_score,
                response.contract.destination.url,
                response.contract.destination.fingerprint,
                _governance_value(response, "root_program_id"),
                _governance_value(response, "delegated_authority_id"),
                _governance_value(response, "issuer_id"),
                _governance_value(response, "destination_policy_id"),
                response.usage_policy,
                response.contract.hold_to_open.required,
                response.contract.hold_to_open.duration_ms,
                json.dumps(response.contract.trust_path.model_dump(mode="json")),
                _timestamp(response.contract.decided_at),
            )
            scanner_decisions_inserted = _inserted_count(scanner_status)

            runtime_observation = _runtime_observation_values(response)
            if runtime_observation is not None:
                runtime_status = await connection.execute(
                    _RUNTIME_OBSERVATION_INSERT,
                    *runtime_observation,
                )
                runtime_observations_inserted = _inserted_count(runtime_status)

            if _governance_value(response, "root_program_id") is not None:
                outbox_status = await connection.execute(
                    _EVENT_OUTBOX_INSERT,
                    *_scanner_decision_event_values(response),
                )
                scanner_events_enqueued = _inserted_count(outbox_status)

        return EvidenceRecordingResult(
            scanner_decisions_inserted=scanner_decisions_inserted,
            runtime_observations_inserted=runtime_observations_inserted,
            scanner_events_enqueued=scanner_events_enqueued,
        )
    except Exception as exc:
        return EvidenceRecordingResult(
            scanner_decisions_inserted=0,
            runtime_observations_inserted=0,
            scanner_events_enqueued=0,
            error=str(exc),
        )
    finally:
        if connection is not None:
            await connection.close()


def _scanner_decision_event_values(
    response: ScannerDecisionResponse,
) -> tuple[Any, ...]:
    if response.contract is None:
        raise ValueError("scanner decision event requires a decision contract")

    body = response.contract.model_dump(mode="json")
    artifact_hash = f"sha256:{_hash_json(body)}"
    root_program_id = _governance_value(response, "root_program_id")
    if root_program_id is None:
        raise ValueError("scanner decision event requires a governance root")
    delegated_authority_id = _governance_value(response, "delegated_authority_id")
    issuer_id = _governance_value(response, "issuer_id")
    destination_policy_id = _governance_value(response, "destination_policy_id")
    event_id = f"evt_{response.contract.decision_id}"
    envelope = {
        "event_id": event_id,
        "type": _SCANNER_DECISION_EVENT_TYPE,
        "occurred_at": response.contract.decided_at,
        "root_program_id": root_program_id,
        "artifact_id": response.contract.decision_id,
        "artifact_hash": artifact_hash,
        "artifact_ref": (
            f"postgres://qr_trust.scanner_decisions/{response.contract.decision_id}"
        ),
        "version": 1,
        "reason": ",".join(response.contract.reason_codes),
    }
    if delegated_authority_id is not None:
        envelope["delegated_authority_id"] = delegated_authority_id
    if issuer_id is not None:
        envelope["issuer_id"] = issuer_id
    if destination_policy_id is not None:
        envelope["destination_policy_id"] = destination_policy_id

    return (
        event_id,
        _SCANNER_DECISION_EVENT_TYPE,
        "scanner_decision",
        response.contract.decision_id,
        response.contract.decision_id,
        artifact_hash,
        root_program_id,
        delegated_authority_id,
        issuer_id,
        destination_policy_id,
        _json_dumps({"envelope": envelope, "body": body}),
    )


def _runtime_observation_values(
    response: ScannerDecisionResponse,
) -> tuple[Any, ...] | None:
    if response.contract is None:
        return None

    signal = _signal_for_layer(response, "runtime_safety")
    if signal is None:
        return None

    verdict = _RUNTIME_VERDICT_BY_STATE.get(signal.state)
    if verdict is None:
        return None

    destination_url = (
        response.destination.display_url or response.contract.destination.url
    )
    final_url = (
        response.destination.final_url
        or response.contract.destination.final_url
        or destination_url
    )
    destination_host = (
        response.destination.host
        or response.contract.destination.display_host
        or _host_from_url(destination_url)
        or "unknown-host"
    )
    return (
        _RUNTIME_PROVIDER_ID,
        destination_host,
        destination_url,
        final_url,
        verdict,
        _RUNTIME_RISK_BY_VERDICT[verdict],
        _runtime_reason_codes(response, verdict, signal),
        _timestamp(response.contract.decided_at),
        None,
    )


def _runtime_reason_codes(
    response: ScannerDecisionResponse,
    verdict: str,
    signal: ScannerDecisionSignal,
) -> list[str]:
    if verdict == "clear":
        return ["runtime_clear"]

    scanner_codes = (
        response.scanner_ux.reason_codes if response.scanner_ux is not None else []
    )
    runtime_codes = [code for code in scanner_codes if code.startswith("runtime_")]
    if runtime_codes:
        return runtime_codes
    return [f"runtime_{signal.state}"]


def _signal_for_layer(
    response: ScannerDecisionResponse,
    layer: str,
) -> ScannerDecisionSignal | None:
    return next((signal for signal in response.signals if signal.layer == layer), None)


def _governance_value(response: ScannerDecisionResponse, key: str) -> str | None:
    if response.governance is not None:
        value = getattr(response.governance, key)
        return str(value) if value else None
    if response.contract is not None:
        value = response.contract.governance.get(key)
        return str(value) if value else None
    return None


def _host_from_url(url: str) -> str | None:
    parsed = urlparse(url)
    return parsed.hostname


def _timestamp(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _hash_json(value: Any) -> str:
    return sha256(_json_dumps(value).encode("utf-8")).hexdigest()


def _json_dumps(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def _asyncpg_dsn(dsn: str) -> str:
    if dsn.startswith("postgresql+asyncpg://"):
        return dsn.replace("postgresql+asyncpg://", "postgresql://", 1)
    return dsn


def _inserted_count(status: str) -> int:
    parts = status.split()
    if len(parts) >= 3 and parts[0] == "INSERT":
        try:
            return int(parts[-1])
        except ValueError:
            return 1
    return 1
