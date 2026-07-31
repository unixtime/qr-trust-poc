import {
  assertPackagedDeploymentApprovalEvidencePacket,
  collectPackagedDeploymentApprovalEvidenceRefs,
  makePackagedDeploymentApprovalEvidencePacket,
  type PackagedDeploymentApprovalEvidencePacket,
} from "../services/packaged-deployment-approval-evidence.js"

const GENERATED_AT = "2026-05-21T09:00:00Z"

const REFERENCE_PACKET = makePackagedDeploymentApprovalEvidencePacket({
  packetId: "packaged-deployment-approval:smoke:reference:2026-05-21",
  generatedAt: GENERATED_AT,
  claimMode: "reference_drill",
  deploymentArtifact: {
    artifact_id: "qrtrust-reference-bundle",
    version: "2026.05.21-reference",
    artifact_ref:
      "docs/public/network-contracts/examples/deployment-readiness-bundle-reference.json",
    sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    created_at: GENERATED_AT,
  },
  environment: {
    environment_id: "local-reference-lab",
    stage: "reference_lab",
    owner: "QR Trust reference operator",
    boundary_ref:
      "docs/public/network-contracts/deployment-readiness-operator-guide.md#environment-boundary",
  },
  gates: [
    {
      gate_id: "artifact_fingerprinted",
      status: "passed",
      evidence_ref:
        "docs/public/network-contracts/examples/deployment-readiness-bundle-reference.json",
      checked_at: GENERATED_AT,
      summary: "Reference bundle includes stable file-role fingerprints.",
    },
    {
      gate_id: "contract_smoke_passed",
      status: "passed",
      evidence_ref: "network/src/programs/deployment-readiness-bundle-smoke.ts",
      checked_at: GENERATED_AT,
      summary: "Contract smoke path validates bundle role coverage.",
    },
    {
      gate_id: "operator_approval_recorded",
      status: "passed",
      evidence_ref:
        "docs/public/network-contracts/deployment-readiness-operator-guide.md#approval-boundary",
      checked_at: GENERATED_AT,
      summary: "Approval is represented as an evidence reference, not a public secret.",
    },
    {
      gate_id: "rollback_plan_accepted",
      status: "passed",
      evidence_ref: "docs/public/network-contracts/restore-automation-evidence.md",
      checked_at: GENERATED_AT,
      summary: "Rollback acceptance points at the restore-automation evidence packet.",
    },
  ],
  approvals: [
    {
      role: "release_owner",
      approver: "Reference release owner",
      decision: "approved",
      approval_ref:
        "docs/public/network-contracts/deployment-readiness-operator-guide.md#release-owner",
      approved_at: GENERATED_AT,
      scope: "Reference packaged deployment packet shape.",
    },
    {
      role: "security_reviewer",
      approver: "Reference security reviewer",
      decision: "approved",
      approval_ref:
        "docs/public/network-contracts/managed-signing-custody-deployment-policy.md#review-boundary",
      approved_at: GENERATED_AT,
      scope: "Public-safe boundary and custody separation.",
    },
    {
      role: "operations_reviewer",
      approver: "Reference operations reviewer",
      decision: "approved",
      approval_ref: "docs/public/network-contracts/worker-operations-evidence.md",
      approved_at: GENERATED_AT,
      scope: "Worker, restore, and operator handoff readiness.",
    },
  ],
  rollbackPlan: {
    plan_ref:
      "docs/public/network-contracts/restore-automation-evidence.md#rollback-and-restore-boundary",
    rehearsal_ref:
      "docs/public/network-contracts/examples/restore-automation-evidence-reference.json",
    owner: "QR Trust reference operator",
    accepted_at: GENERATED_AT,
  },
  guardrails: {
    public_repo_contains_no_secrets: true,
    operator_controls_remain_external: true,
    rollback_plan_required: true,
    production_approval_requires_ops_refs: true,
  },
  reviewer: {
    name: "QR Trust reference maintainer",
    role: "contract reviewer",
    reviewed_at: "2026-05-21",
  },
})

const expectInvalidPacket = (
  label: string,
  mutate: (
    packet: PackagedDeploymentApprovalEvidencePacket,
  ) => PackagedDeploymentApprovalEvidencePacket,
): void => {
  try {
    assertPackagedDeploymentApprovalEvidencePacket(mutate(REFERENCE_PACKET))
  } catch {
    return
  }

  throw new Error(`Expected invalid packaged deployment approval packet: ${label}`)
}

assertPackagedDeploymentApprovalEvidencePacket(REFERENCE_PACKET)

expectInvalidPacket("missing canonical gate", (packet) => ({
  ...packet,
  gates: packet.gates.slice(0, 3),
}))

expectInvalidPacket("failed gate", (packet) => ({
  ...packet,
  gates: packet.gates.map((gate) =>
    gate.gate_id === "contract_smoke_passed"
      ? { ...gate, status: "failed" }
      : gate,
  ),
}))

expectInvalidPacket("missing approval role", (packet) => ({
  ...packet,
  approvals: packet.approvals.filter(
    (approval) => approval.role !== "security_reviewer",
  ),
}))

expectInvalidPacket("deferred approval", (packet) => ({
  ...packet,
  approvals: packet.approvals.map((approval) =>
    approval.role === "operations_reviewer"
      ? { ...approval, decision: "deferred" }
      : approval,
  ),
}))

expectInvalidPacket("production candidate with public refs", (packet) => ({
  ...packet,
  claim_mode: "production_candidate",
  environment: {
    ...packet.environment,
    stage: "production_candidate",
  },
}))

expectInvalidPacket("private material marker", (packet) => ({
  ...packet,
  approvals: packet.approvals.map((approval) =>
    approval.role === "release_owner"
      ? { ...approval, approval_ref: "env://QRTRUST_RELEASE_PASSWORD" }
      : approval,
  ),
}))

expectInvalidPacket("bad artifact fingerprint", (packet) => ({
  ...packet,
  deployment_artifact: {
    ...packet.deployment_artifact,
    sha256: "not-a-sha",
  },
}))

console.log(
  JSON.stringify(
    {
      status: "ok",
      packet_id: REFERENCE_PACKET.packet_id,
      gates: REFERENCE_PACKET.gates.length,
      approvals: REFERENCE_PACKET.approvals.length,
      refs: collectPackagedDeploymentApprovalEvidenceRefs(REFERENCE_PACKET).length,
    },
    null,
    2,
  ),
)
