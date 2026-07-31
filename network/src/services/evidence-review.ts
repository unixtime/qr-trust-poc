const REVIEW_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export const isEvidenceReviewDate = (value: unknown): value is string =>
  typeof value === "string" && REVIEW_DATE_RE.test(value)

export const assertEvidenceReviewDate = (
  value: unknown,
  context: string,
  field: string,
  subject: string,
): void => {
  if (!isEvidenceReviewDate(value)) {
    throw new Error(`${context} ${field} must be YYYY-MM-DD for ${subject}`)
  }
}
