from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
from typing import Any, Protocol

from backend.app.services.management_auth import ManagementPrincipal

CONTROL_PLANE_SUBJECT_ROOT = "control-plane"


class AsyncTransaction(Protocol):
    async def __aenter__(self) -> Any: ...
    async def __aexit__(self, exc_type: Any, exc: Any, tb: Any) -> Any: ...


class ManagementConnection(Protocol):
    def transaction(self) -> AsyncTransaction: ...
    async def execute(self, *args: Any) -> str: ...
    async def fetchrow(self, *args: Any) -> Any: ...


class IdempotencyConflictError(RuntimeError):
    pass


class IdempotencyInProgressError(RuntimeError):
    pass


class GovernancePreconditionFailedError(RuntimeError):
    pass


@dataclass(frozen=True)
class GovernanceMutation:
    action: str
    target_type: str
    target_id: str
    root_program_id: str | None
    delegated_authority_id: str | None
    issuer_id: str | None
    state_sql: str
    state_values: tuple[Any, ...]
    after_json: dict[str, Any]
    event_type: str
    destination_policy_id: str | None = None
    require_state_rows: bool = False
    precondition_failure_detail: str = "governance mutation precondition failed"


@dataclass(frozen=True)
class GovernanceMutationResult:
    state_rows: int
    audit_rows: int
    outbox_rows: int


class ManagementPlaneService:
    def __init__(self, connection: ManagementConnection) -> None:
        self._connection = connection

    async def record_governance_mutation(
        self,
        *,
        principal: ManagementPrincipal,
        mutation: GovernanceMutation,
        request_id: str,
        idempotency_key: str | None,
    ) -> GovernanceMutationResult:
        async with self._connection.transaction():
            request_hash = _request_hash(principal, mutation)
            if idempotency_key:
                existing_result = await self._begin_idempotent_mutation(
                    idempotency_key=idempotency_key,
                    request_hash=request_hash,
                )
                if existing_result is not None:
                    return existing_result

            if mutation.require_state_rows:
                state_row = await self._connection.fetchrow(
                    mutation.state_sql,
                    *mutation.state_values,
                )
                state_rows = _changed_rows_from_row(state_row)
                if state_rows == 0:
                    raise GovernancePreconditionFailedError(
                        mutation.precondition_failure_detail
                    )
            else:
                state_status = await self._connection.execute(
                    mutation.state_sql,
                    *mutation.state_values,
                )
                state_rows = _inserted_count(state_status)
            audit_status = await self._connection.execute(
                _AUDIT_INSERT,
                principal.operator_id,
                principal.key_id,
                mutation.action,
                mutation.target_type,
                mutation.target_id,
                mutation.root_program_id,
                mutation.delegated_authority_id,
                mutation.issuer_id,
                None,
                _json_dumps(mutation.after_json),
                request_id,
                idempotency_key,
            )
            outbox_event_id = _event_id(
                _event_deduplication_key(
                    request_id=request_id,
                    idempotency_key=idempotency_key,
                    request_hash=request_hash,
                ),
                mutation,
            )
            outbox_body = {
                "action": mutation.action,
                "target_type": mutation.target_type,
                "target_id": mutation.target_id,
                "after": mutation.after_json,
            }
            outbox_artifact_hash = _artifact_hash(outbox_body)
            outbox_status = await self._connection.execute(
                _OUTBOX_INSERT,
                outbox_event_id,
                mutation.event_type,
                mutation.target_type,
                mutation.target_id,
                mutation.target_id,
                outbox_artifact_hash,
                mutation.root_program_id,
                mutation.delegated_authority_id,
                mutation.issuer_id,
                mutation.destination_policy_id
                or mutation.after_json.get("destination_policy_id"),
                _json_dumps(
                    _outbox_payload(
                        mutation,
                        event_id=outbox_event_id,
                        artifact_hash=outbox_artifact_hash,
                        body=outbox_body,
                    )
                ),
            )

            result = GovernanceMutationResult(
                state_rows=state_rows,
                audit_rows=_inserted_count(audit_status),
                outbox_rows=_inserted_count(outbox_status),
            )
            if idempotency_key:
                await self._complete_idempotent_mutation(
                    idempotency_key=idempotency_key,
                    result=result,
                )

        return result

    async def _begin_idempotent_mutation(
        self,
        *,
        idempotency_key: str,
        request_hash: str,
    ) -> GovernanceMutationResult | None:
        insert_status = await self._connection.execute(
            _IDEMPOTENCY_BEGIN,
            idempotency_key,
            request_hash,
        )
        if _inserted_count(insert_status) > 0:
            return None

        row = await self._connection.fetchrow(
            _IDEMPOTENCY_SELECT,
            idempotency_key,
        )
        if row is None:
            raise IdempotencyInProgressError(
                "idempotency key is currently being processed"
            )
        if str(row["request_hash"]) != request_hash:
            raise IdempotencyConflictError(
                "idempotency key was already used for a different request"
            )
        if row["status"] == "completed" and row["response_json"] is not None:
            return _result_from_json(row["response_json"])
        raise IdempotencyInProgressError(
            "idempotency key is currently being processed"
        )

    async def _complete_idempotent_mutation(
        self,
        *,
        idempotency_key: str,
        result: GovernanceMutationResult,
    ) -> None:
        await self._connection.execute(
            _IDEMPOTENCY_COMPLETE,
            idempotency_key,
            _json_dumps(_result_to_json(result)),
        )


def _result_to_json(result: GovernanceMutationResult) -> dict[str, int]:
    return {
        "state_rows": result.state_rows,
        "audit_rows": result.audit_rows,
        "outbox_rows": result.outbox_rows,
    }


def _result_from_json(payload: Any) -> GovernanceMutationResult:
    decoded = json.loads(payload) if isinstance(payload, str) else payload
    if not isinstance(decoded, dict):
        raise RuntimeError("idempotency response_json must be a JSON object")
    return GovernanceMutationResult(
        state_rows=_json_int(decoded.get("state_rows")),
        audit_rows=_json_int(decoded.get("audit_rows")),
        outbox_rows=_json_int(decoded.get("outbox_rows")),
    )


def _json_int(value: Any) -> int:
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str) and value.isnumeric():
        return int(value)
    raise RuntimeError("idempotency response_json contains a non-integer field")


def _request_hash(
    principal: ManagementPrincipal,
    mutation: GovernanceMutation,
) -> str:
    payload = {
        "principal": {
            "key_id": principal.key_id,
            "operator_id": principal.operator_id,
            "scopes": sorted(principal.scopes),
        },
        "mutation": {
            "action": mutation.action,
            "target_type": mutation.target_type,
            "target_id": mutation.target_id,
            "root_program_id": mutation.root_program_id,
            "delegated_authority_id": mutation.delegated_authority_id,
            "issuer_id": mutation.issuer_id,
            "state_values": _json_safe(mutation.state_values),
            "after_json": mutation.after_json,
            "event_type": mutation.event_type,
        },
    }
    return f"sha256:{sha256(_json_dumps(payload).encode('utf-8')).hexdigest()}"


def _json_safe(value: Any) -> Any:
    if value is None or isinstance(value, str | int | float | bool):
        return value
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, list | tuple | set | frozenset):
        return [_json_safe(item) for item in value]
    return str(value)


_AUDIT_INSERT = """
insert into qr_trust.governance_audit_log (
  actor_operator_id,
  actor_key_id,
  action,
  target_type,
  target_id,
  root_program_id,
  delegated_authority_id,
  issuer_id,
  before_json,
  after_json,
  request_id,
  idempotency_key
) values ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12)
""".strip()

_OUTBOX_INSERT = """
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

_IDEMPOTENCY_BEGIN = """
insert into qr_trust.idempotency_keys (
  idempotency_key,
  request_hash,
  status,
  expires_at
) values ($1, $2, 'processing', now() + interval '24 hours')
on conflict (idempotency_key) do update set
  request_hash = excluded.request_hash,
  response_json = null,
  status = 'processing',
  created_at = now(),
  expires_at = excluded.expires_at
where qr_trust.idempotency_keys.expires_at <= now()
""".strip()

_IDEMPOTENCY_SELECT = """
select
  request_hash,
  response_json,
  status
from qr_trust.idempotency_keys
where idempotency_key = $1
for update
""".strip()

_IDEMPOTENCY_COMPLETE = """
update qr_trust.idempotency_keys
set
  response_json = $2::jsonb,
  status = 'completed'
where idempotency_key = $1
""".strip()


def _inserted_count(status: str) -> int:
    parts = status.split()
    if len(parts) == 3 and parts[0] == "INSERT":
        return int(parts[2])
    if len(parts) == 2 and parts[0] == "SELECT":
        return int(parts[1])
    return 0


def _changed_rows_from_row(row: Any) -> int:
    if row is None:
        return 0
    try:
        return _json_int(row["changed_rows"])
    except (KeyError, TypeError):
        raise RuntimeError("required management mutation must return changed_rows")


def _artifact_hash(payload: dict[str, Any]) -> str:
    return f"sha256:{sha256(_json_dumps(payload).encode('utf-8')).hexdigest()}"


def _outbox_payload(
    mutation: GovernanceMutation,
    *,
    event_id: str,
    artifact_hash: str,
    body: dict[str, Any],
) -> dict[str, Any]:
    envelope: dict[str, Any] = {
        "event_id": event_id,
        "type": mutation.event_type,
        "occurred_at": _utc_now_iso(),
        "root_program_id": _event_root_program_id(mutation),
        "artifact_id": mutation.target_id,
        "artifact_hash": artifact_hash,
        "artifact_ref": _artifact_ref(mutation),
        "version": 1,
        "reason": mutation.action,
    }
    if mutation.delegated_authority_id is not None:
        envelope["delegated_authority_id"] = mutation.delegated_authority_id
    if mutation.issuer_id is not None:
        envelope["issuer_id"] = mutation.issuer_id
    destination_policy_id = mutation.destination_policy_id or mutation.after_json.get(
        "destination_policy_id"
    )
    if isinstance(destination_policy_id, str) and destination_policy_id:
        envelope["destination_policy_id"] = destination_policy_id
    return {"envelope": envelope, "body": body}


def _event_root_program_id(mutation: GovernanceMutation) -> str:
    if mutation.root_program_id:
        return mutation.root_program_id
    root_program_id = mutation.after_json.get("root_program_id")
    if isinstance(root_program_id, str) and root_program_id:
        return root_program_id
    return CONTROL_PLANE_SUBJECT_ROOT


def _artifact_ref(mutation: GovernanceMutation) -> str:
    return f"postgres://qr_trust.{mutation.target_type}/{mutation.target_id}"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _event_id(request_id: str, mutation: GovernanceMutation) -> str:
    digest = sha256(
        (
            f"{request_id}:{mutation.action}:"
            f"{mutation.target_type}:{mutation.target_id}"
        ).encode("utf-8")
    ).hexdigest()[:24]
    return f"evt_mgmt_{digest}"


def _event_deduplication_key(
    *,
    request_id: str,
    idempotency_key: str | None,
    request_hash: str,
) -> str:
    if idempotency_key:
        return f"{idempotency_key}:{request_hash}:{request_id}"
    return request_id


def _json_dumps(payload: Any) -> str:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


def build_root_program_upsert_mutation(
    *,
    root_program_id: str,
    name: str,
    program_scope: str,
    accepted_algorithm_ids: list[str],
    policy_constraints: dict[str, Any],
) -> GovernanceMutation:
    return GovernanceMutation(
        action="root_program.upsert",
        target_type="root_program",
        target_id=root_program_id,
        root_program_id=root_program_id,
        delegated_authority_id=None,
        issuer_id=None,
        state_sql="""
insert into qr_trust.root_programs (
  root_program_id,
  name,
  program_scope,
  accepted_algorithm_ids,
  policy_constraints,
  status
) values ($1, $2, $3, $4::text[], $5::jsonb, 'active')
on conflict (root_program_id) do update set
  name = excluded.name,
  program_scope = excluded.program_scope,
  accepted_algorithm_ids = excluded.accepted_algorithm_ids,
  policy_constraints = excluded.policy_constraints,
  status = 'active',
  updated_at = now(),
  version = qr_trust.root_programs.version + 1
""".strip(),
        state_values=(
            root_program_id,
            name,
            program_scope,
            accepted_algorithm_ids,
            _json_dumps(policy_constraints),
        ),
        after_json={
            "root_program_id": root_program_id,
            "name": name,
            "program_scope": program_scope,
            "accepted_algorithm_ids": accepted_algorithm_ids,
            "policy_constraints": policy_constraints,
            "status": "active",
        },
        event_type="root_program.upserted",
    )


def build_delegated_authority_upsert_mutation(
    *,
    root_program_id: str,
    delegated_authority_id: str,
    name: str,
    authority_type: str,
    scope: dict[str, Any],
    assurance_requirements: dict[str, Any],
) -> GovernanceMutation:
    return GovernanceMutation(
        action="delegated_authority.upsert",
        target_type="delegated_authority",
        target_id=delegated_authority_id,
        root_program_id=root_program_id,
        delegated_authority_id=delegated_authority_id,
        issuer_id=None,
        state_sql="""
insert into qr_trust.delegated_authorities (
  root_program_id,
  delegated_authority_id,
  name,
  authority_type,
  scope,
  assurance_requirements,
  status
) values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, 'active')
on conflict (root_program_id, delegated_authority_id) do update set
  name = excluded.name,
  authority_type = excluded.authority_type,
  scope = excluded.scope,
  assurance_requirements = excluded.assurance_requirements,
  status = 'active',
  updated_at = now(),
  version = qr_trust.delegated_authorities.version + 1
""".strip(),
        state_values=(
            root_program_id,
            delegated_authority_id,
            name,
            authority_type,
            _json_dumps(scope),
            _json_dumps(assurance_requirements),
        ),
        after_json={
            "root_program_id": root_program_id,
            "delegated_authority_id": delegated_authority_id,
            "name": name,
            "authority_type": authority_type,
            "scope": scope,
            "assurance_requirements": assurance_requirements,
            "status": "active",
        },
        event_type="delegated_authority.upserted",
    )


def build_issuer_enrollment_mutation(
    *,
    root_program_id: str,
    delegated_authority_id: str,
    issuer_id: str,
    display_name: str,
    issuer_class: str,
    assurance_tier: str,
) -> GovernanceMutation:
    return GovernanceMutation(
        action="issuer.enroll",
        target_type="issuer",
        target_id=issuer_id,
        root_program_id=root_program_id,
        delegated_authority_id=delegated_authority_id,
        issuer_id=issuer_id,
        state_sql="""
insert into qr_trust.issuers (
  root_program_id,
  delegated_authority_id,
  issuer_id,
  display_name,
  issuer_class,
  assurance_tier,
  assurance_evidence,
  enrollment_status
) values ($1, $2, $3, $4, $5, $6, '{}'::jsonb, 'pending')
on conflict (root_program_id, delegated_authority_id, issuer_id) do update set
  display_name = excluded.display_name,
  issuer_class = excluded.issuer_class,
  assurance_tier = excluded.assurance_tier,
  enrollment_status = 'pending',
  updated_at = now(),
  version = qr_trust.issuers.version + 1
""".strip(),
        state_values=(
            root_program_id,
            delegated_authority_id,
            issuer_id,
            display_name,
            issuer_class,
            assurance_tier,
        ),
        after_json={
            "root_program_id": root_program_id,
            "delegated_authority_id": delegated_authority_id,
            "issuer_id": issuer_id,
            "display_name": display_name,
            "issuer_class": issuer_class,
            "assurance_tier": assurance_tier,
            "enrollment_status": "pending",
        },
        event_type="issuer.enrollment.requested",
    )


def build_domain_proof_upsert_mutation(
    *,
    root_program_id: str,
    delegated_authority_id: str,
    issuer_id: str,
    domain: str,
    proof_method: str,
    verification_status: str,
    expires_at: datetime | None,
    evidence_ref: str | None,
) -> GovernanceMutation:
    return GovernanceMutation(
        action="domain_proof.upsert",
        target_type="domain_proof",
        target_id=domain,
        root_program_id=root_program_id,
        delegated_authority_id=delegated_authority_id,
        issuer_id=issuer_id,
        state_sql="""
with updated as (
  update qr_trust.issuer_domain_proofs
  set
    proof_method = $5,
    verification_status = $6,
    verified_at = case
      when $6 = 'verified' then coalesce(verified_at, now())
      else null
    end,
    expires_at = $7::timestamptz,
    evidence_ref = $8
  where root_program_id = $1
    and delegated_authority_id = $2
    and issuer_id = $3
    and domain = $4
    and verification_status in ('pending','verified')
  returning domain_proof_id
),
inserted as (
  insert into qr_trust.issuer_domain_proofs (
    root_program_id,
    delegated_authority_id,
    issuer_id,
    domain,
    proof_method,
    verification_status,
    verified_at,
    expires_at,
    evidence_ref
  )
  select
    $1,
    $2,
    $3,
    $4,
    $5,
    $6,
    case when $6 = 'verified' then now() else null end,
    $7::timestamptz,
    $8
  where not exists (select 1 from updated)
  returning domain_proof_id
)
select count(*)::integer as changed_rows
from (
  select domain_proof_id from updated
  union all
  select domain_proof_id from inserted
) changed
""".strip(),
        state_values=(
            root_program_id,
            delegated_authority_id,
            issuer_id,
            domain,
            proof_method,
            verification_status,
            expires_at,
            evidence_ref,
        ),
        after_json={
            "root_program_id": root_program_id,
            "delegated_authority_id": delegated_authority_id,
            "issuer_id": issuer_id,
            "domain": domain,
            "proof_method": proof_method,
            "verification_status": verification_status,
            "expires_at": expires_at.isoformat() if expires_at is not None else None,
            "evidence_ref": evidence_ref,
        },
        event_type="domain_proof.upserted",
    )


def build_issuer_status_update_mutation(
    *,
    root_program_id: str,
    delegated_authority_id: str,
    issuer_id: str,
    enrollment_status: str,
) -> GovernanceMutation:
    return GovernanceMutation(
        action="issuer.status.update",
        target_type="issuer",
        target_id=issuer_id,
        root_program_id=root_program_id,
        delegated_authority_id=delegated_authority_id,
        issuer_id=issuer_id,
        require_state_rows=True,
        precondition_failure_detail=(
            "issuer status update requires an existing issuer enrollment"
        ),
        state_sql="""
with updated as (
  update qr_trust.issuers
  set
    enrollment_status = $4,
    updated_at = now(),
    version = version + 1
  where root_program_id = $1
    and delegated_authority_id = $2
    and issuer_id = $3
  returning issuer_id
)
select count(*)::integer as changed_rows
from updated
""".strip(),
        state_values=(
            root_program_id,
            delegated_authority_id,
            issuer_id,
            enrollment_status,
        ),
        after_json={
            "root_program_id": root_program_id,
            "delegated_authority_id": delegated_authority_id,
            "issuer_id": issuer_id,
            "enrollment_status": enrollment_status,
        },
        event_type="issuer.status.changed",
    )


def build_destination_policy_upsert_mutation(
    *,
    root_program_id: str,
    delegated_authority_id: str,
    issuer_id: str,
    destination_policy_id: str,
    usage_policy: str,
    approved_destinations: list[dict[str, Any]],
    redirect_policy: dict[str, Any],
    runtime_safety_policy: dict[str, Any],
    host_scopes: list[dict[str, Any]],
) -> GovernanceMutation:
    return GovernanceMutation(
        action="destination_policy.upsert",
        target_type="destination_policy",
        target_id=destination_policy_id,
        root_program_id=root_program_id,
        delegated_authority_id=delegated_authority_id,
        issuer_id=issuer_id,
        destination_policy_id=destination_policy_id,
        require_state_rows=True,
        precondition_failure_detail=(
            "destination policy requires an active issuer and verified domain proof "
            "for every approved host"
        ),
        state_sql="""
with issuer_ok as (
  select 1
  from qr_trust.issuers
  where root_program_id = $1
    and delegated_authority_id = $2
    and issuer_id = $3
    and enrollment_status = 'active'
),
policy_hosts as (
  select
    host,
    allow_subdomains
  from jsonb_to_recordset($9::jsonb) as host_scope(
    host text,
    allow_subdomains boolean
  )
),
missing_hosts as (
  select policy_hosts.host
  from policy_hosts
  where not exists (
    select 1
    from qr_trust.issuer_domain_proofs proof
    where proof.root_program_id = $1
      and proof.delegated_authority_id = $2
      and proof.issuer_id = $3
      and proof.verification_status = 'verified'
      and (proof.expires_at is null or proof.expires_at > now())
      and (
        proof.domain = policy_hosts.host
        or (
          policy_hosts.allow_subdomains
          and policy_hosts.host like ('%.' || proof.domain)
        )
      )
  )
),
upserted as (
  insert into qr_trust.destination_policies (
    root_program_id,
    delegated_authority_id,
    issuer_id,
    destination_policy_id,
    usage_policy,
    approved_destinations,
    redirect_policy,
    runtime_safety_policy,
    status
  )
  select
    $1,
    $2,
    $3,
    $4,
    $5,
    $6::jsonb,
    $7::jsonb,
    $8::jsonb,
    'active'
  where exists (select 1 from issuer_ok)
    and not exists (select 1 from missing_hosts)
  on conflict (
    root_program_id,
    delegated_authority_id,
    issuer_id,
    destination_policy_id
  ) do update set
    usage_policy = excluded.usage_policy,
    approved_destinations = excluded.approved_destinations,
    redirect_policy = excluded.redirect_policy,
    runtime_safety_policy = excluded.runtime_safety_policy,
    status = 'active',
    updated_at = now(),
    version = qr_trust.destination_policies.version + 1
  returning destination_policy_id
)
select count(*)::integer as changed_rows
from upserted
""".strip(),
        state_values=(
            root_program_id,
            delegated_authority_id,
            issuer_id,
            destination_policy_id,
            usage_policy,
            _json_dumps(approved_destinations),
            _json_dumps(redirect_policy),
            _json_dumps(runtime_safety_policy),
            _json_dumps(host_scopes),
        ),
        after_json={
            "root_program_id": root_program_id,
            "delegated_authority_id": delegated_authority_id,
            "issuer_id": issuer_id,
            "destination_policy_id": destination_policy_id,
            "usage_policy": usage_policy,
            "approved_destinations": approved_destinations,
            "redirect_policy": redirect_policy,
            "runtime_safety_policy": runtime_safety_policy,
            "status": "active",
            "publication_gate": {
                "requires_active_issuer": True,
                "requires_verified_domain_proofs": True,
                "required_hosts": host_scopes,
            },
        },
        event_type="destination_policy.upserted",
    )


def build_destination_policy_status_update_mutation(
    *,
    root_program_id: str,
    delegated_authority_id: str,
    issuer_id: str,
    destination_policy_id: str,
    status: str,
) -> GovernanceMutation:
    return GovernanceMutation(
        action="destination_policy.status.update",
        target_type="destination_policy",
        target_id=destination_policy_id,
        root_program_id=root_program_id,
        delegated_authority_id=delegated_authority_id,
        issuer_id=issuer_id,
        destination_policy_id=destination_policy_id,
        require_state_rows=True,
        precondition_failure_detail=(
            "destination policy status update requires an existing destination policy"
        ),
        state_sql="""
with updated as (
  update qr_trust.destination_policies
  set
    status = $5,
    updated_at = now(),
    version = version + 1
  where root_program_id = $1
    and delegated_authority_id = $2
    and issuer_id = $3
    and destination_policy_id = $4
  returning destination_policy_id
)
select count(*)::integer as changed_rows
from updated
""".strip(),
        state_values=(
            root_program_id,
            delegated_authority_id,
            issuer_id,
            destination_policy_id,
            status,
        ),
        after_json={
            "root_program_id": root_program_id,
            "delegated_authority_id": delegated_authority_id,
            "issuer_id": issuer_id,
            "destination_policy_id": destination_policy_id,
            "status": status,
        },
        event_type="destination_policy.status.changed",
    )


def build_trust_key_upsert_mutation(
    *,
    key_id: str,
    root_program_id: str,
    delegated_authority_id: str | None,
    signer_id: str,
    algorithm_id: str,
    public_key_material_ref: str,
    public_key_material_pem: str | None,
    scope: str,
    key_status: str,
    not_before: datetime | None,
    not_after: datetime | None,
) -> GovernanceMutation:
    return GovernanceMutation(
        action="trust_key.upsert",
        target_type="trust_key",
        target_id=key_id,
        root_program_id=root_program_id,
        delegated_authority_id=delegated_authority_id,
        issuer_id=None,
        state_sql="""
insert into qr_trust.trust_keys (
  key_id,
  root_program_id,
  delegated_authority_id,
  signer_id,
  algorithm_id,
  public_key_material_ref,
  public_key_material_pem,
  scope,
  key_status,
  not_before,
  not_after
) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::timestamptz, $11::timestamptz)
on conflict (key_id) do update set
  root_program_id = excluded.root_program_id,
  delegated_authority_id = excluded.delegated_authority_id,
  signer_id = excluded.signer_id,
  algorithm_id = excluded.algorithm_id,
  public_key_material_ref = excluded.public_key_material_ref,
  public_key_material_pem = excluded.public_key_material_pem,
  scope = excluded.scope,
  key_status = excluded.key_status,
  not_before = excluded.not_before,
  not_after = excluded.not_after
""".strip(),
        state_values=(
            key_id,
            root_program_id,
            delegated_authority_id,
            signer_id,
            algorithm_id,
            public_key_material_ref,
            public_key_material_pem,
            scope,
            key_status,
            not_before,
            not_after,
        ),
        after_json={
            "key_id": key_id,
            "root_program_id": root_program_id,
            "delegated_authority_id": delegated_authority_id,
            "signer_id": signer_id,
            "algorithm_id": algorithm_id,
            "public_key_material_ref": public_key_material_ref,
            "public_key_material_pem": public_key_material_pem,
            "scope": scope,
            "key_status": key_status,
            "not_before": not_before.isoformat() if not_before is not None else None,
            "not_after": not_after.isoformat() if not_after is not None else None,
        },
        event_type="trust_key.upserted",
    )


def build_trust_key_status_update_mutation(
    *,
    root_program_id: str,
    key_id: str,
    key_status: str,
) -> GovernanceMutation:
    return GovernanceMutation(
        action="trust_key.status.update",
        target_type="trust_key",
        target_id=key_id,
        root_program_id=root_program_id,
        delegated_authority_id=None,
        issuer_id=None,
        require_state_rows=True,
        precondition_failure_detail=(
            "trust key status update requires an existing trust key"
        ),
        state_sql="""
with updated as (
  update qr_trust.trust_keys
  set key_status = $3
  where root_program_id = $1
    and key_id = $2
  returning key_id
)
select count(*)::integer as changed_rows
from updated
""".strip(),
        state_values=(root_program_id, key_id, key_status),
        after_json={
            "root_program_id": root_program_id,
            "key_id": key_id,
            "key_status": key_status,
        },
        event_type="trust_key.status.changed",
    )


def build_runtime_safety_provider_upsert_mutation(
    *,
    provider_id: str,
    display_name: str,
    base_url: str | None,
    verdict_ttl_seconds: int,
    stale_behavior: str,
    unavailable_behavior: str,
    status: str,
) -> GovernanceMutation:
    return GovernanceMutation(
        action="runtime_provider.upsert",
        target_type="runtime_safety_provider",
        target_id=provider_id,
        root_program_id=None,
        delegated_authority_id=None,
        issuer_id=None,
        state_sql="""
insert into qr_trust.runtime_safety_providers (
  provider_id,
  display_name,
  base_url,
  verdict_ttl_seconds,
  stale_behavior,
  unavailable_behavior,
  status
) values ($1, $2, $3, $4, $5, $6, $7)
on conflict (provider_id) do update set
  display_name = excluded.display_name,
  base_url = excluded.base_url,
  verdict_ttl_seconds = excluded.verdict_ttl_seconds,
  stale_behavior = excluded.stale_behavior,
  unavailable_behavior = excluded.unavailable_behavior,
  status = excluded.status,
  updated_at = now()
""".strip(),
        state_values=(
            provider_id,
            display_name,
            base_url,
            verdict_ttl_seconds,
            stale_behavior,
            unavailable_behavior,
            status,
        ),
        after_json={
            "provider_id": provider_id,
            "display_name": display_name,
            "base_url": base_url,
            "verdict_ttl_seconds": verdict_ttl_seconds,
            "stale_behavior": stale_behavior,
            "unavailable_behavior": unavailable_behavior,
            "status": status,
        },
        event_type="runtime_provider.upserted",
    )


def build_nats_subscriber_authorization_mutation(
    *,
    subscriber_id: str,
    display_name: str,
    durable_name: str,
    description: str,
    subjects: list[str],
) -> GovernanceMutation:
    return GovernanceMutation(
        action="nats_subscriber.authorize",
        target_type="nats_subscriber",
        target_id=subscriber_id,
        root_program_id=None,
        delegated_authority_id=None,
        issuer_id=None,
        state_sql="""
with upserted_subscriber as (
  insert into qr_trust.nats_subscribers (
    subscriber_id,
    display_name,
    durable_name,
    description,
    status
  ) values ($1, $2, $3, $4, 'active')
  on conflict (subscriber_id) do update set
    display_name = excluded.display_name,
    durable_name = excluded.durable_name,
    description = excluded.description,
    status = 'active',
    updated_at = now()
  returning subscriber_id
),
deleted_subjects as (
  delete from qr_trust.nats_subscriber_subjects
  where subscriber_id = $1
),
inserted_subjects as (
  insert into qr_trust.nats_subscriber_subjects (
    subscriber_id,
    subject,
    permission
  )
  select $1, subject, 'subscribe'
  from jsonb_array_elements_text($5::jsonb) as subject
  on conflict (subscriber_id, subject) do update set
    permission = 'subscribe'
  returning subject
)
select subscriber_id from upserted_subscriber
""".strip(),
        state_values=(
            subscriber_id,
            display_name,
            durable_name,
            description,
            _json_dumps(subjects),
        ),
        after_json={
            "subscriber_id": subscriber_id,
            "display_name": display_name,
            "durable_name": durable_name,
            "description": description,
            "status": "active",
            "subjects": subjects,
        },
        event_type="nats.subscriber.authorization.changed",
    )
