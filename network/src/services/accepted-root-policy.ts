export interface AcceptedRootPolicyShape {
  readonly accepts: (rootProgramId: string) => boolean
}

export const makeAcceptedRootPolicy = (
  acceptedRootProgramIds: ReadonlyArray<string>,
): AcceptedRootPolicyShape => {
  const accepted = new Set(acceptedRootProgramIds)
  return { accepts: (rootProgramId) => accepted.has(rootProgramId) }
}

export const acceptAllRootsPolicy: AcceptedRootPolicyShape = {
  accepts: () => true,
}
