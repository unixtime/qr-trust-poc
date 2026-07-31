export type NetworkError =
  | ContractValidationError
  | DestinationParseError
  | EventPublicationError
  | KeyMaterialError
  | PersistenceError
  | PolicyPublicationError
  | SigningCustodyError

export interface ContractValidationError {
  readonly _tag: "ContractValidationError"
  readonly message: string
  readonly cause: unknown
}

export interface DestinationParseError {
  readonly _tag: "DestinationParseError"
  readonly message: string
  readonly payload: string
}

export interface EventPublicationError {
  readonly _tag: "EventPublicationError"
  readonly message: string
  readonly cause: unknown
}

export interface KeyMaterialError {
  readonly _tag: "KeyMaterialError"
  readonly message: string
  readonly cause: unknown
}

export interface PersistenceError {
  readonly _tag: "PersistenceError"
  readonly message: string
  readonly cause: unknown
}

export interface PolicyPublicationError {
  readonly _tag: "PolicyPublicationError"
  readonly message: string
  readonly cause: unknown
}

export interface SigningCustodyError {
  readonly _tag: "SigningCustodyError"
  readonly message: string
  readonly cause: unknown
}

export const contractValidationError = (
  message: string,
  cause: unknown,
): ContractValidationError => ({
  _tag: "ContractValidationError",
  message,
  cause,
})

export const destinationParseError = (
  payload: string,
): DestinationParseError => ({
  _tag: "DestinationParseError",
  message: "Decoded QR payload does not contain a URL destination.",
  payload,
})

export const eventPublicationError = (
  message: string,
  cause: unknown,
): EventPublicationError => ({
  _tag: "EventPublicationError",
  message,
  cause,
})

export const keyMaterialError = (
  message: string,
  cause: unknown,
): KeyMaterialError => ({
  _tag: "KeyMaterialError",
  message,
  cause,
})

export const persistenceError = (
  message: string,
  cause: unknown,
): PersistenceError => ({
  _tag: "PersistenceError",
  message,
  cause,
})

export const policyPublicationError = (
  message: string,
  cause: unknown,
): PolicyPublicationError => ({
  _tag: "PolicyPublicationError",
  message,
  cause,
})

export const signingCustodyError = (
  message: string,
  cause: unknown,
): SigningCustodyError => ({
  _tag: "SigningCustodyError",
  message,
  cause,
})
