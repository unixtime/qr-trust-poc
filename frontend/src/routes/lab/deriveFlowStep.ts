import type { useLabController } from "@/routes/lab/useLabController"

export type FlowStepId = 1 | 2 | 3 | 4

export type LabState = ReturnType<typeof useLabController>

export type FlowState = {
  maxUnlockedStep: FlowStepId
  completed: Record<FlowStepId, boolean>
}

export function deriveFlowState(lab: LabState): FlowState {
  const hasDemo = lab.demo !== null
  const hasScanEvidence = lab.result !== null || lab.scannerDecision !== null
  const maxUnlockedStep: FlowStepId =
    hasDemo && hasScanEvidence ? 4 : hasDemo ? 3 : 2
  return {
    maxUnlockedStep,
    completed: {
      1: true,
      2: hasDemo,
      3: hasScanEvidence,
      4: lab.scannerDecision !== null,
    },
  }
}
