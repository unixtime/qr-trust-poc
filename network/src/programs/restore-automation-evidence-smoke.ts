import { Console, Effect } from "effect"

import {
  RESTORE_AUTOMATION_REQUIRED_DRILLS,
  assertRestoreAutomationEvidencePacket,
  collectRestoreAutomationEvidenceRefs,
  makeRestoreAutomationEvidencePacket,
  type RestoreAutomationDrill,
  type RestoreAutomationEvidencePacket,
  type RestoreAutomationEvidenceRef,
} from "../index.js"

const program = Effect.gen(function* () {
  const packet = makeReferencePacket()
  assertRestoreAutomationEvidencePacket(packet)
  const refs = collectRestoreAutomationEvidenceRefs(packet)

  yield* assertSmoke(
    packet.artifact_type === "restore_automation_evidence_packet",
    "artifact type should be stable",
  )
  yield* assertSmoke(
    packet.drills.map((drill) => drill.drill_id).join(",") ===
      RESTORE_AUTOMATION_REQUIRED_DRILLS.join(","),
    "packet should use canonical restore drill order",
  )
  yield* assertSmoke(
    packet.drills.every((drill) => drill.status === "passed"),
    "reference restore drills should all pass",
  )
  yield* assertSmoke(
    refs.every(
      (ref) =>
        ref.startsWith("docs/public/") ||
        ref.startsWith("network/") ||
        ref.startsWith("ops://qrtrust/"),
    ),
    "restore evidence refs should be public repo paths or scoped ops refs",
  )
  yield* assertSmoke(
    throwsMissingDrill(),
    "packet should fail closed when a required restore drill is missing",
  )
  yield* assertSmoke(
    throwsWrongDrillOrder(),
    "packet should fail closed when restore drills are out of canonical order",
  )
  yield* assertSmoke(
    throwsFailedDrill(),
    "packet should fail closed when a restore drill fails",
  )
  yield* assertSmoke(
    throwsProductionCandidateWithoutOpsRefs(),
    "production candidates should require ops-scoped restore evidence refs",
  )
  yield* assertSmoke(
    throwsUnsafeEvidenceRef(),
    "packet should fail closed when restore evidence leaves public/ops paths",
  )
  yield* assertSmoke(
    throwsPrivateMaterial(),
    "packet should fail closed when private material markers appear",
  )
  yield* assertSmoke(
    throwsMalformedReviewerReviewDate(),
    "packet should fail closed when reviewer review date is malformed",
  )
  yield* assertSmoke(
    throwsNonScratchRestoreGuardrail(),
    "packet should fail closed when scratch-only restore guardrail is disabled",
  )
  yield* assertSmoke(
    throwsInvalidBackupDigest(),
    "packet should fail closed when backup artifact digest is malformed",
  )
  yield* assertSmoke(
    throwsBackwardsDrillWindow(),
    "packet should fail closed when a restore drill completes before it starts",
  )

  yield* Console.log(
    JSON.stringify(
      {
        status: "ok",
        packet_id: packet.packet_id,
        drills: packet.drills.length,
        refs: refs.length,
      },
      null,
      2,
    ),
  )
})

const makeReferencePacket = (
  overrides: Partial<{
    claimMode: "reference_drill" | "production_candidate"
    backupArtifact: RestoreAutomationEvidencePacket["backup_artifact"]
    recoveryObjective: RestoreAutomationEvidencePacket["recovery_objective"]
    drills: ReadonlyArray<RestoreAutomationDrill>
    guardrails: RestoreAutomationEvidencePacket["guardrails"]
    reviewer: RestoreAutomationEvidencePacket["reviewer"]
  }> = {},
): RestoreAutomationEvidencePacket =>
  makeRestoreAutomationEvidencePacket({
    packetId: "restore-automation-evidence:smoke:reference:2026-05-21",
    generatedAt: "2026-05-21T00:00:00.000Z",
    claimMode: overrides.claimMode ?? "reference_drill",
    backupArtifact:
      overrides.backupArtifact ?? {
        artifact_id: "qrtrust-postgres-reference-backup-2026-05-21",
        storage_ref: "docs/public/network-contracts/reference-postgres-schema.sql",
        sha256: "a".repeat(64),
        created_at: "2026-05-21T00:00:00.000Z",
        retention_policy: "reference artifact retained with public contract fixtures",
        encryption_mode: "reference fixture only; no secret material",
      },
    recoveryObjective:
      overrides.recoveryObjective ?? {
        rpo_minutes: 15,
        rto_minutes: 60,
        owner: "QR Trust restore operator",
        escalation_ref:
          "docs/public/network-contracts/deployment-readiness-operator-guide.md#restore-automation",
      },
    drills: overrides.drills ?? makeDrills(),
    guardrails:
      overrides.guardrails ?? {
        postgres_authoritative: true,
        restore_targets_scratch_only: true,
        no_secret_material: true,
        destructive_restore_requires_operator_approval: true,
      },
    reviewer: {
      name: "QR Trust reviewer",
      role: "restore automation evidence smoke",
      reviewed_at: "2026-05-21",
      ...overrides.reviewer,
    },
  })

const makeDrills = (): ReadonlyArray<RestoreAutomationDrill> => [
  {
    drill_id: "scheduled_backup_created",
    objective: "prove that Postgres trust-state backups are scheduled and inspectable",
    command_ref: "network/package.json#deployment-readiness-smoke",
    started_at: "2026-05-21T00:01:00.000Z",
    completed_at: "2026-05-21T00:02:00.000Z",
    status: "passed",
    evidence_refs: [
      ref(
        "Backup artifact fixture",
        "docs/public/network-contracts/reference-postgres-schema.sql",
      ),
    ],
  },
  {
    drill_id: "scratch_restore_completed",
    objective: "prove that the backup can restore into scratch infrastructure only",
    command_ref: "network/package.json#deployment-readiness-bundle-smoke",
    started_at: "2026-05-21T00:03:00.000Z",
    completed_at: "2026-05-21T00:04:00.000Z",
    status: "passed",
    evidence_refs: [
      ref(
        "Scratch restore operator guide",
        "docs/public/network-contracts/deployment-readiness-operator-guide.md#restore-automation",
      ),
    ],
  },
  {
    drill_id: "migration_rollback_rehearsed",
    objective: "prove that schema changes can be rolled back before adoption claims",
    command_ref: "network/package.json#postgres-migrations-plan-smoke",
    started_at: "2026-05-21T00:05:00.000Z",
    completed_at: "2026-05-21T00:06:00.000Z",
    status: "passed",
    evidence_refs: [
      ref(
        "Migration rollback policy",
        "docs/public/network-contracts/postgres-migration-deployment-policy.md#rollback-drill",
      ),
    ],
  },
  {
    drill_id: "operator_failover_handoff",
    objective: "prove that another operator can follow the restore handoff without hidden state",
    command_ref: "network/package.json#deployment-readiness-bundle-smoke",
    started_at: "2026-05-21T00:07:00.000Z",
    completed_at: "2026-05-21T00:08:00.000Z",
    status: "passed",
    evidence_refs: [
      ref(
        "Deployment readiness bundle",
        "docs/public/network-contracts/examples/deployment-readiness-bundle-reference.json",
      ),
    ],
  },
]

const ref = (label: string, uri: string): RestoreAutomationEvidenceRef => ({
  label,
  uri,
  owner: "QR Trust reference operator",
  reviewed_at: "2026-05-21",
})

const throwsMissingDrill = (): boolean => {
  try {
    assertRestoreAutomationEvidencePacket(
      makeReferencePacket({ drills: makeDrills().slice(0, -1) }),
    )
    return false
  } catch {
    return true
  }
}

const throwsWrongDrillOrder = (): boolean => {
  const drills = [...makeDrills()]
  const swapped = [drills[1]!, drills[0]!, ...drills.slice(2)]
  try {
    assertRestoreAutomationEvidencePacket(
      makeReferencePacket({ drills: swapped }),
    )
    return false
  } catch {
    return true
  }
}

const throwsFailedDrill = (): boolean => {
  const drills = makeDrills().map((drill, index) =>
    index === 0 ? { ...drill, status: "failed" as const } : drill,
  )
  try {
    assertRestoreAutomationEvidencePacket(makeReferencePacket({ drills }))
    return false
  } catch {
    return true
  }
}

const throwsProductionCandidateWithoutOpsRefs = (): boolean => {
  try {
    assertRestoreAutomationEvidencePacket(
      makeReferencePacket({ claimMode: "production_candidate" }),
    )
    return false
  } catch {
    return true
  }
}

const throwsUnsafeEvidenceRef = (): boolean => {
  const drills = makeDrills().map((drill, index) =>
    index === 0
      ? {
          ...drill,
          evidence_refs: [ref("Unsafe path", "/tmp/restore-output.log")],
        }
      : drill,
  )
  try {
    assertRestoreAutomationEvidencePacket(makeReferencePacket({ drills }))
    return false
  } catch {
    return true
  }
}

const throwsPrivateMaterial = (): boolean => {
  try {
    assertRestoreAutomationEvidencePacket(
      makeReferencePacket({
        backupArtifact: {
          artifact_id: "qrtrust-postgres-reference-backup-2026-05-21",
          storage_ref: "docs/public/network-contracts/reference-postgres-schema.sql",
          sha256: "a".repeat(64),
          created_at: "2026-05-21T00:00:00.000Z",
          retention_policy: "operator password copied into notes",
          encryption_mode: "reference fixture only",
        },
      }),
    )
    return false
  } catch {
    return true
  }
}

const throwsMalformedReviewerReviewDate = (): boolean => {
  try {
    assertRestoreAutomationEvidencePacket(
      makeReferencePacket({
        reviewer: {
          name: "QR Trust reviewer",
          role: "restore automation evidence smoke",
          reviewed_at: "05/21/2026",
        },
      }),
    )
    return false
  } catch {
    return true
  }
}

const throwsNonScratchRestoreGuardrail = (): boolean => {
  try {
    assertRestoreAutomationEvidencePacket(
      makeReferencePacket({
        guardrails: {
          postgres_authoritative: true,
          restore_targets_scratch_only: false,
          no_secret_material: true,
          destructive_restore_requires_operator_approval: true,
        } as unknown as RestoreAutomationEvidencePacket["guardrails"],
      }),
    )
    return false
  } catch {
    return true
  }
}

const throwsInvalidBackupDigest = (): boolean => {
  try {
    assertRestoreAutomationEvidencePacket(
      makeReferencePacket({
        backupArtifact: {
          artifact_id: "qrtrust-postgres-reference-backup-2026-05-21",
          storage_ref: "docs/public/network-contracts/reference-postgres-schema.sql",
          sha256: "not-a-sha",
          created_at: "2026-05-21T00:00:00.000Z",
          retention_policy: "reference artifact retained with public contract fixtures",
          encryption_mode: "reference fixture only",
        },
      }),
    )
    return false
  } catch {
    return true
  }
}

const throwsBackwardsDrillWindow = (): boolean => {
  const drills = makeDrills().map((drill, index) =>
    index === 0
      ? {
          ...drill,
          started_at: "2026-05-21T00:02:00.000Z",
          completed_at: "2026-05-21T00:01:00.000Z",
        }
      : drill,
  )
  try {
    assertRestoreAutomationEvidencePacket(makeReferencePacket({ drills }))
    return false
  } catch {
    return true
  }
}

const assertSmoke = (condition: boolean, message: string) =>
  condition ? Effect.void : Effect.fail(new Error(message))

Effect.runPromise(program).catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
