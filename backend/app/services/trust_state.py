"""Governance version tokens for the trust projection.

The scanner projection reloads only when this token changes, so every
governance write that affects trust state must bump it inside the same
transaction. A deleted row is recreated with a fresh epoch, which forces
every cached consumer to treat its state as stale.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class TrustStateToken:
    epoch: str
    version: int


TRUST_STATE_BUMP_SQL = """
insert into qr_trust.governance_versions (name)
values ($1)
on conflict (name)
do update set version = qr_trust.governance_versions.version + 1,
              updated_at = now()
returning epoch::text as epoch, version
""".strip()

_TRUST_STATE_PROBE_SQL = """
select epoch::text as epoch, version
from qr_trust.governance_versions
where name = $1
""".strip()


async def bump_trust_state(connection, name: str = "trust_state") -> TrustStateToken:
    row = await connection.fetchrow(TRUST_STATE_BUMP_SQL, name)
    return TrustStateToken(epoch=row["epoch"], version=int(row["version"]))


async def probe_trust_state(
    connection, name: str = "trust_state"
) -> TrustStateToken | None:
    try:
        row = await connection.fetchrow(_TRUST_STATE_PROBE_SQL, name)
    except Exception:
        return None
    if row is None:
        return None
    return TrustStateToken(epoch=row["epoch"], version=int(row["version"]))
