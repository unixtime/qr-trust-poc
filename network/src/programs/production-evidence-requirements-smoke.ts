import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import {
  assertProductionEvidenceRequirements,
  collectProductionEvidenceRequirementControls,
  OPERATOR_EVIDENCE_CONTROL_IDS,
  type ProductionEvidenceRequirements,
} from "../index.js"

const REFERENCE_REQUIREMENTS_PATH = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/examples/production-evidence-requirements-reference.json",
    import.meta.url,
  ),
)

const REFERENCE_REQUIREMENTS = JSON.parse(
  readFileSync(REFERENCE_REQUIREMENTS_PATH, "utf8"),
) as ProductionEvidenceRequirements

const cloneRequirements = (
  requirements: ProductionEvidenceRequirements,
): ProductionEvidenceRequirements => structuredClone(requirements)

const expectInvalidRequirements = (
  label: string,
  mutate: (
    requirements: ProductionEvidenceRequirements,
  ) => ProductionEvidenceRequirements,
): void => {
  try {
    assertProductionEvidenceRequirements(
      mutate(cloneRequirements(REFERENCE_REQUIREMENTS)),
    )
  } catch {
    return
  }

  throw new Error(`Expected invalid production evidence requirements: ${label}`)
}

assertProductionEvidenceRequirements(REFERENCE_REQUIREMENTS)

expectInvalidRequirements("missing canonical control", (requirements) => ({
  ...requirements,
  controls: requirements.controls.slice(0, OPERATOR_EVIDENCE_CONTROL_IDS.length - 1),
}))

expectInvalidRequirements("wrong canonical control order", (requirements) => {
  const [first, second, ...rest] = requirements.controls
  if (first === undefined || second === undefined) {
    throw new Error("Reference production evidence requirements need two controls")
  }
  return {
    ...requirements,
    controls: [second, first, ...rest],
  }
})

expectInvalidRequirements("wrong required ref scheme", (requirements) => ({
  ...requirements,
  controls: requirements.controls.map((control) =>
    control.control_id === "managed_key_material"
      ? { ...control, required_ref_scheme: "docs/public/" as "ops://qrtrust/" }
      : control,
  ),
}))

expectInvalidRequirements("missing required artifacts", (requirements) => ({
  ...requirements,
  controls: requirements.controls.map((control) =>
    control.control_id === "operator_runbooks"
      ? { ...control, required_artifacts: [] }
      : control,
  ),
}))

expectInvalidRequirements("requirements presented as evidence", (requirements) => ({
  ...requirements,
  guardrails: {
    ...requirements.guardrails,
    requirements_are_not_evidence: false as true,
  },
}))

expectInvalidRequirements("private material marker", (requirements) => ({
  ...requirements,
  controls: requirements.controls.map((control) =>
    control.control_id === "managed_key_material"
      ? {
          ...control,
          required_artifacts: ["env://QRTRUST_PRIVATE_KEY"],
        }
      : control,
  ),
}))

console.log(
  JSON.stringify(
    {
      status: "ok",
      requirements_id: REFERENCE_REQUIREMENTS.requirements_id,
      controls: collectProductionEvidenceRequirementControls(
        REFERENCE_REQUIREMENTS,
      ).length,
      required_ref_scheme: "ops://qrtrust/",
    },
    null,
    2,
  ),
)
