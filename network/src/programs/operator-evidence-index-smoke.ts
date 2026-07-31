import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import {
  assertOperatorEvidenceIndex,
  collectOperatorEvidenceRefs,
  OPERATOR_EVIDENCE_CONTROL_IDS,
  type OperatorEvidenceIndex,
} from "../services/operator-evidence-index.js"

const REFERENCE_INDEX_PATH = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/examples/operator-evidence-index-reference.json",
    import.meta.url,
  ),
)
const PRODUCTION_INDEX_PATH = fileURLToPath(
  new URL(
    "../../../docs/public/network-contracts/examples/operator-evidence-index-production-candidate.json",
    import.meta.url,
  ),
)

const REFERENCE_INDEX = JSON.parse(
  readFileSync(REFERENCE_INDEX_PATH, "utf8"),
) as OperatorEvidenceIndex
const PRODUCTION_INDEX = JSON.parse(
  readFileSync(PRODUCTION_INDEX_PATH, "utf8"),
) as OperatorEvidenceIndex

const cloneIndex = (index: OperatorEvidenceIndex): OperatorEvidenceIndex =>
  structuredClone(index)

const expectInvalidIndex = (
  label: string,
  mutate: (index: OperatorEvidenceIndex) => OperatorEvidenceIndex,
  baseIndex: OperatorEvidenceIndex = REFERENCE_INDEX,
): void => {
  try {
    assertOperatorEvidenceIndex(mutate(cloneIndex(baseIndex)))
  } catch {
    return
  }

  throw new Error(`Expected invalid operator evidence index: ${label}`)
}

assertOperatorEvidenceIndex(REFERENCE_INDEX)
assertOperatorEvidenceIndex(PRODUCTION_INDEX)

expectInvalidIndex("missing canonical control", (index) => ({
  ...index,
  controls: index.controls.slice(0, OPERATOR_EVIDENCE_CONTROL_IDS.length - 1),
}))

expectInvalidIndex("wrong canonical control order", (index) => {
  const [first, second, ...rest] = index.controls
  if (first === undefined || second === undefined) {
    throw new Error("Reference operator evidence index needs at least two controls")
  }
  return {
    ...index,
    controls: [second, first, ...rest],
  }
})

expectInvalidIndex("production candidate with public refs", (index) => ({
  ...index,
  claim_mode: "production_candidate",
}))

expectInvalidIndex("blocked production candidate", (index) => ({
  ...index,
  claim_mode: "production_candidate",
  controls: index.controls.map((control) => ({
    ...control,
    status:
      control.control_id === "operator_runbooks" ? "blocked" : "operator_backed",
  })),
}))

expectInvalidIndex(
  "production candidate missing review roles",
  (index) => ({
    ...index,
    controls: index.controls.map((control) => ({
      ...control,
      evidence_refs: control.evidence_refs.map((ref) => ({
        label: ref.label,
        uri: ref.uri,
        owner: ref.owner,
        reviewed_at: ref.reviewed_at,
      })),
    })),
  }),
  PRODUCTION_INDEX,
)

expectInvalidIndex(
  "production candidate with unsupported review role",
  (index) => ({
    ...index,
    controls: index.controls.map((control) => ({
      ...control,
      evidence_refs: control.evidence_refs.map((ref) => ({
        ...ref,
        review_role: "unrecognized_reviewer",
      })),
    })),
  }) as unknown as OperatorEvidenceIndex,
  PRODUCTION_INDEX,
)

expectInvalidIndex("private material marker", (index) => ({
  ...index,
  controls: index.controls.map((control) =>
    control.control_id === "managed_key_material"
      ? {
          ...control,
          evidence_refs: [
            {
              ...control.evidence_refs[0]!,
              uri: "env://QRTRUST_PRIVATE_KEY",
            },
          ],
        }
      : control,
  ),
}))

expectInvalidIndex("missing evidence refs", (index) => ({
  ...index,
  controls: index.controls.map((control) =>
    control.control_id === "operator_runbooks"
      ? { ...control, evidence_refs: [] }
      : control,
  ),
}))

console.log(
  JSON.stringify(
    {
      status: "ok",
      index_id: REFERENCE_INDEX.index_id,
      production_index_id: PRODUCTION_INDEX.index_id,
      controls: REFERENCE_INDEX.controls.length,
      refs: collectOperatorEvidenceRefs(REFERENCE_INDEX).length,
      production_refs: collectOperatorEvidenceRefs(PRODUCTION_INDEX).length,
    },
    null,
    2,
  ),
)
