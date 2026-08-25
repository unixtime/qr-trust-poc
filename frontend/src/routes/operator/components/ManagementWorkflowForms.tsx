import { RotateCcw, Send } from "lucide-react"
import { type ReactNode, type SubmitEvent, useReducer, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { type MessageKey, useT } from "@/i18n"

type ManagementWorkflowPayload = Record<string, unknown>

type ManagementWorkflowFormProps = {
  workflowId: string
  isSubmitting: boolean
  onSubmit: (workflowId: string, payload: ManagementWorkflowPayload) => void
  onRefreshEvidence: () => void
}

type RuntimeProviderFormState = {
  providerId: string
  displayName: string
  baseUrl: string
  verdictTtlSeconds: string
  staleBehavior: string
  unavailableBehavior: string
  providerStatus: string
}

type TrustKeyFormState = {
  rootProgramId: string
  delegatedAuthorityId: string
  keyId: string
  signerId: string
  algorithmId: string
  publicKeyMaterialRef: string
  publicKeyMaterialPem: string
  scope: string
  keyStatus: string
  statusUpdate: string
  notBefore: string
  notAfter: string
}

// These prefill the forms, so they are the ids most demo mutations actually
// carry. Two constraints bind them, and an id can satisfy the first while
// failing the second:
//
//  1. Shape — governance ids are URN-style, and EventEnvelopeSchema in
//     network/src/contracts.ts rejects any envelope whose ids lack the
//     registry prefix. Unprefixed defaults ("qr-trust-local") were accepted by
//     the API, written to the outbox, and only rejected by the publisher, so
//     the operator saw a retry-exhausted row instead of a form error.
//  2. Existence — root ids are additionally checked against the
//     QRTRUST_ACCEPTED_ROOT_PROGRAM_IDS trust anchor allowlist, which is
//     seeded to root:qrtrust-demo:2026 alone. Merely prefixing the old value
//     ("root:qr-trust-local") clears the schema and then fails at the
//     subscriber instead.
//
// So these mirror `qrtrustctl demo-bootstrap` exactly rather than naming a
// separate "local" persona: the forms open pointing at rows that are already
// seeded, already accepted, and already published end to end.
const defaultRootProgramId = "root:qrtrust-demo:2026"
const defaultDelegatedAuthorityId = "authority:qrtrust-demo:merchant-web"
const defaultIssuerId = "issuer:acme-demo"
const defaultDomain = "acme.example"
const defaultDestinationPolicyId = "policy:acme-demo:web-payments:v1"

const defaultTrustKeyFormState: TrustKeyFormState = {
  rootProgramId: defaultRootProgramId,
  delegatedAuthorityId: defaultDelegatedAuthorityId,
  keyId: "key:authority:qrtrust-demo:merchant-web:ed25519:v1",
  signerId: defaultDelegatedAuthorityId,
  algorithmId: "ed25519",
  publicKeyMaterialRef: "managed://qrtrust/authority/public/v1",
  publicKeyMaterialPem: "",
  scope: "delegated_authority",
  keyStatus: "active",
  statusUpdate: "no_change",
  notBefore: "",
  notAfter: "",
}

const selectClassName =
  "h-10 rounded-lg border border-white/10 bg-[rgba(5,10,18,0.45)] px-2.5 text-sm shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)] outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"

function splitTextItems(value: string) {
  return value
    .split(/[,\n]/)
    .flatMap((item) => {
      const trimmed = item.trim()
      return trimmed ? [trimmed] : []
    })
}

function optionalText(value: string) {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function datetimeLocalToIsoUtc(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return trimmed
  return parsed.toISOString()
}

function parsePositiveInteger(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return parsed
}

function WorkflowFormShell({
  title,
  description,
  endpoint,
  submitLabel,
  isSubmitting,
  onSubmit,
  children,
}: {
  title: MessageKey
  description: MessageKey
  // Not a message key: this is the literal HTTP route the form calls, and it
  // reads the same in every locale.
  endpoint: string
  submitLabel: MessageKey
  isSubmitting: boolean
  onSubmit: (event: SubmitEvent<HTMLFormElement>) => void
  children: ReactNode
}) {
  const t = useT()

  return (
    <form
      onSubmit={onSubmit}
      className="grid gap-4 rounded-2xl border border-white/8 bg-white/3 p-4"
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h4 className="text-base font-semibold text-foreground">{t(title)}</h4>
          <p className="text-sm leading-6 text-muted-foreground">
            {t(description)}
          </p>
        </div>
        <Badge variant="outline" className="max-w-full truncate" title={endpoint}>
          {endpoint}
        </Badge>
      </div>
      {children}
      <Button type="submit" className="w-full justify-center" disabled={isSubmitting}>
        <Send className="size-4" />
        {t(isSubmitting ? "operator.workflow.recording" : submitLabel)}
      </Button>
    </form>
  )
}

function GovernanceScopeFields({
  rootProgramId,
  delegatedAuthorityId,
  issuerId,
  onRootProgramIdChange,
  onDelegatedAuthorityIdChange,
  onIssuerIdChange,
}: {
  rootProgramId: string
  delegatedAuthorityId: string
  issuerId?: string
  onRootProgramIdChange: (value: string) => void
  onDelegatedAuthorityIdChange: (value: string) => void
  onIssuerIdChange?: (value: string) => void
}) {
  const t = useT()

  return (
    <FieldGroup className="grid gap-4 md:grid-cols-3">
      <Field>
        <FieldLabel htmlFor="management-root-program-id">
          {t("operator.workflow.field.rootProgram")}
        </FieldLabel>
        <Input
          id="management-root-program-id"
          value={rootProgramId}
          onChange={(event) => onRootProgramIdChange(event.target.value)}
          required
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="management-delegated-authority-id">
          {t("operator.workflow.field.delegatedAuthority")}
        </FieldLabel>
        <Input
          id="management-delegated-authority-id"
          value={delegatedAuthorityId}
          onChange={(event) => onDelegatedAuthorityIdChange(event.target.value)}
          required
        />
      </Field>
      {issuerId !== undefined && onIssuerIdChange ? (
        <Field>
          <FieldLabel htmlFor="management-issuer-id">
            {t("operator.workflow.field.issuerId")}
          </FieldLabel>
          <Input
            id="management-issuer-id"
            value={issuerId}
            onChange={(event) => onIssuerIdChange(event.target.value)}
            required
          />
        </Field>
      ) : null}
    </FieldGroup>
  )
}

function AuthoritySetupForm({
  workflowId,
  isSubmitting,
  onSubmit,
}: ManagementWorkflowFormProps) {
  const t = useT()
  const [rootProgramId, setRootProgramId] = useState(defaultRootProgramId)
  const [rootName, setRootName] = useState("QR Trust Local Root")
  const [programScope, setProgramScope] = useState("local-development")
  const [algorithms, setAlgorithms] = useState("ed25519, es256")
  const [delegatedAuthorityId, setDelegatedAuthorityId] = useState(
    defaultDelegatedAuthorityId,
  )
  const [delegatedName, setDelegatedName] = useState("ACME Local Authority")
  const [authorityType, setAuthorityType] = useState("merchant_operator")

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    onSubmit(workflowId, {
      root_program: {
        root_program_id: rootProgramId.trim(),
        name: rootName.trim(),
        program_scope: programScope.trim(),
        accepted_algorithm_ids: splitTextItems(algorithms),
        policy_constraints: {},
      },
      delegated_authority: {
        root_program_id: rootProgramId.trim(),
        delegated_authority_id: delegatedAuthorityId.trim(),
        name: delegatedName.trim(),
        authority_type: authorityType.trim(),
        scope: {},
        assurance_requirements: {},
      },
    })
  }

  return (
    <WorkflowFormShell
      title="operator.workflow.authority.title"
      description="operator.workflow.authority.description"
      endpoint="POST /admin/root-programs -> /admin/delegated-authorities"
      submitLabel="operator.workflow.authority.submit"
      isSubmitting={isSubmitting}
      onSubmit={handleSubmit}
    >
      <FieldGroup className="grid gap-4 md:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="management-authority-root-id">
            {t("operator.workflow.field.rootProgram")}
          </FieldLabel>
          <Input
            id="management-authority-root-id"
            value={rootProgramId}
            onChange={(event) => setRootProgramId(event.target.value)}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="management-authority-root-name">
            {t("operator.workflow.field.rootName")}
          </FieldLabel>
          <Input
            id="management-authority-root-name"
            value={rootName}
            onChange={(event) => setRootName(event.target.value)}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="management-authority-scope">
            {t("operator.workflow.field.programScope")}
          </FieldLabel>
          <Input
            id="management-authority-scope"
            value={programScope}
            onChange={(event) => setProgramScope(event.target.value)}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="management-authority-algorithms">
            {t("operator.workflow.field.acceptedAlgorithms")}
          </FieldLabel>
          <Input
            id="management-authority-algorithms"
            value={algorithms}
            onChange={(event) => setAlgorithms(event.target.value)}
            required
          />
          <FieldDescription>
            {t("operator.workflow.hint.commaAlgorithms")}
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="management-authority-id">
            {t("operator.workflow.field.delegatedAuthority")}
          </FieldLabel>
          <Input
            id="management-authority-id"
            value={delegatedAuthorityId}
            onChange={(event) => setDelegatedAuthorityId(event.target.value)}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="management-authority-name">
            {t("operator.workflow.field.authorityName")}
          </FieldLabel>
          <Input
            id="management-authority-name"
            value={delegatedName}
            onChange={(event) => setDelegatedName(event.target.value)}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="management-authority-type">
            {t("operator.workflow.field.authorityType")}
          </FieldLabel>
          <select
            id="management-authority-type"
            className={selectClassName}
            value={authorityType}
            onChange={(event) => setAuthorityType(event.target.value)}
          >
            <option value="payment_operator">payment_operator</option>
            <option value="public_service_operator">
              public_service_operator
            </option>
            <option value="merchant_operator">merchant_operator</option>
            <option value="enterprise_operator">enterprise_operator</option>
            <option value="registry_operator">registry_operator</option>
          </select>
        </Field>
      </FieldGroup>
    </WorkflowFormShell>
  )
}

function TrustKeyForm({
  workflowId,
  isSubmitting,
  onSubmit,
}: ManagementWorkflowFormProps) {
  const t = useT()
  const [formState, updateFormState] = useReducer(
    (state: TrustKeyFormState, patch: Partial<TrustKeyFormState>) => ({
      ...state,
      ...patch,
    }),
    defaultTrustKeyFormState,
  )
  const {
    rootProgramId,
    delegatedAuthorityId,
    keyId,
    signerId,
    algorithmId,
    publicKeyMaterialRef,
    publicKeyMaterialPem,
    scope,
    keyStatus,
    statusUpdate,
    notBefore,
    notAfter,
  } = formState

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const keyScope = scope
    const scopedDelegatedAuthority =
      keyScope === "delegated_authority" ? delegatedAuthorityId.trim() : null
    onSubmit(workflowId, {
      trust_key: {
        key_id: keyId.trim(),
        root_program_id: rootProgramId.trim(),
        delegated_authority_id: scopedDelegatedAuthority,
        signer_id: signerId.trim(),
        algorithm_id: algorithmId.trim(),
        public_key_material_ref: publicKeyMaterialRef.trim(),
        public_key_material_pem: optionalText(publicKeyMaterialPem),
        scope: keyScope,
        key_status: keyStatus,
        not_before: datetimeLocalToIsoUtc(notBefore),
        not_after: datetimeLocalToIsoUtc(notAfter),
      },
      status_update:
        statusUpdate === "no_change"
          ? null
          : {
              root_program_id: rootProgramId.trim(),
              key_id: keyId.trim(),
              key_status: statusUpdate,
            },
    })
  }

  return (
    <WorkflowFormShell
      title="operator.workflow.trustKey.title"
      description="operator.workflow.trustKey.description"
      endpoint="POST /admin/trust-keys -> /admin/trust-keys/status"
      submitLabel="operator.workflow.trustKey.submit"
      isSubmitting={isSubmitting}
      onSubmit={handleSubmit}
    >
      <FieldGroup className="grid gap-4 md:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="management-trust-key-root-program">
            {t("operator.workflow.field.rootProgram")}
          </FieldLabel>
          <Input
            id="management-trust-key-root-program"
            value={rootProgramId}
            onChange={(event) =>
              updateFormState({ rootProgramId: event.target.value })
            }
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="management-trust-key-id">
            {t("operator.workflow.field.keyId")}
          </FieldLabel>
          <Input
            id="management-trust-key-id"
            value={keyId}
            onChange={(event) => updateFormState({ keyId: event.target.value })}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="management-trust-key-scope">
            {t("operator.workflow.field.scope")}
          </FieldLabel>
          <select
            id="management-trust-key-scope"
            className={selectClassName}
            value={scope}
            onChange={(event) => updateFormState({ scope: event.target.value })}
          >
            <option value="delegated_authority">delegated_authority</option>
            <option value="root_program">root_program</option>
          </select>
        </Field>
        <Field>
          <FieldLabel htmlFor="management-trust-key-authority">
            {t("operator.workflow.field.delegatedAuthority")}
          </FieldLabel>
          <Input
            id="management-trust-key-authority"
            value={delegatedAuthorityId}
            onChange={(event) =>
              updateFormState({ delegatedAuthorityId: event.target.value })
            }
            disabled={scope === "root_program"}
            required={scope === "delegated_authority"}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="management-trust-key-signer">
            {t("operator.workflow.field.signerId")}
          </FieldLabel>
          <Input
            id="management-trust-key-signer"
            value={signerId}
            onChange={(event) =>
              updateFormState({ signerId: event.target.value })
            }
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="management-trust-key-algorithm">
            {t("operator.workflow.field.algorithm")}
          </FieldLabel>
          <Input
            id="management-trust-key-algorithm"
            value={algorithmId}
            onChange={(event) =>
              updateFormState({ algorithmId: event.target.value })
            }
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="management-trust-key-ref">
            {t("operator.workflow.field.publicKeyRef")}
          </FieldLabel>
          <Input
            id="management-trust-key-ref"
            value={publicKeyMaterialRef}
            onChange={(event) =>
              updateFormState({ publicKeyMaterialRef: event.target.value })
            }
            required
          />
          <FieldDescription>
            {t("operator.workflow.hint.publicKeyRef")}
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="management-trust-key-status">
            {t("operator.workflow.field.keyStatus")}
          </FieldLabel>
          <select
            id="management-trust-key-status"
            className={selectClassName}
            value={keyStatus}
            onChange={(event) =>
              updateFormState({ keyStatus: event.target.value })
            }
          >
            <option value="active">active</option>
            <option value="suspended">suspended</option>
            <option value="revoked">revoked</option>
            <option value="expired">expired</option>
          </select>
        </Field>
        <Field>
          <FieldLabel htmlFor="management-trust-key-status-update">
            {t("operator.workflow.field.optionalStatusEvent")}
          </FieldLabel>
          <select
            id="management-trust-key-status-update"
            className={selectClassName}
            value={statusUpdate}
            onChange={(event) =>
              updateFormState({ statusUpdate: event.target.value })
            }
          >
            <option value="no_change">no_change</option>
            <option value="active">active</option>
            <option value="suspended">suspended</option>
            <option value="revoked">revoked</option>
            <option value="expired">expired</option>
          </select>
        </Field>
        <Field>
          <FieldLabel htmlFor="management-trust-key-not-before">
            {t("operator.workflow.field.notBefore")}
          </FieldLabel>
          <Input
            id="management-trust-key-not-before"
            type="datetime-local"
            value={notBefore}
            onChange={(event) =>
              updateFormState({ notBefore: event.target.value })
            }
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="management-trust-key-not-after">
            {t("operator.workflow.field.notAfter")}
          </FieldLabel>
          <Input
            id="management-trust-key-not-after"
            type="datetime-local"
            value={notAfter}
            onChange={(event) =>
              updateFormState({ notAfter: event.target.value })
            }
          />
        </Field>
      </FieldGroup>
      <Field>
        <FieldLabel htmlFor="management-trust-key-pem">
          {t("operator.workflow.field.publicKeyPem")}
        </FieldLabel>
        <Textarea
          id="management-trust-key-pem"
          value={publicKeyMaterialPem}
          onChange={(event) =>
            updateFormState({ publicKeyMaterialPem: event.target.value })
          }
          placeholder="-----BEGIN PUBLIC KEY-----"
        />
      </Field>
    </WorkflowFormShell>
  )
}

function IssuerEnrollmentForm({
  workflowId,
  isSubmitting,
  onSubmit,
}: ManagementWorkflowFormProps) {
  const t = useT()
  const [rootProgramId, setRootProgramId] = useState(defaultRootProgramId)
  const [delegatedAuthorityId, setDelegatedAuthorityId] = useState(
    defaultDelegatedAuthorityId,
  )
  const [issuerId, setIssuerId] = useState(defaultIssuerId)
  const [displayName, setDisplayName] = useState("ACME Demo Issuer")
  const [issuerClass, setIssuerClass] = useState("business")
  const [assuranceTier, setAssuranceTier] = useState("domain_controlled")

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    onSubmit(workflowId, {
      root_program_id: rootProgramId.trim(),
      delegated_authority_id: delegatedAuthorityId.trim(),
      issuer_id: issuerId.trim(),
      display_name: displayName.trim(),
      issuer_class: issuerClass.trim(),
      assurance_tier: assuranceTier.trim(),
    })
  }

  return (
    <WorkflowFormShell
      title="operator.workflow.issuerEnrollment.title"
      description="operator.workflow.issuerEnrollment.description"
      endpoint="POST /admin/issuers"
      submitLabel="operator.workflow.issuerEnrollment.submit"
      isSubmitting={isSubmitting}
      onSubmit={handleSubmit}
    >
      <GovernanceScopeFields
        rootProgramId={rootProgramId}
        delegatedAuthorityId={delegatedAuthorityId}
        issuerId={issuerId}
        onRootProgramIdChange={setRootProgramId}
        onDelegatedAuthorityIdChange={setDelegatedAuthorityId}
        onIssuerIdChange={setIssuerId}
      />
      <FieldGroup className="grid gap-4 md:grid-cols-3">
        <Field>
          <FieldLabel htmlFor="management-issuer-display-name">
            {t("operator.workflow.field.displayName")}
          </FieldLabel>
          <Input
            id="management-issuer-display-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="management-issuer-class">
            {t("operator.workflow.field.issuerClass")}
          </FieldLabel>
          <select
            id="management-issuer-class"
            className={selectClassName}
            value={issuerClass}
            onChange={(event) => setIssuerClass(event.target.value)}
          >
            <option value="individual">individual</option>
            <option value="business">business</option>
            <option value="institution">institution</option>
            <option value="public_service">public_service</option>
            <option value="payment_operator">payment_operator</option>
            <option value="platform">platform</option>
          </select>
        </Field>
        <Field>
          <FieldLabel htmlFor="management-assurance-tier">
            {t("operator.workflow.field.assuranceTier")}
          </FieldLabel>
          <select
            id="management-assurance-tier"
            className={selectClassName}
            value={assuranceTier}
            onChange={(event) => setAssuranceTier(event.target.value)}
          >
            <option value="self_asserted">self_asserted</option>
            <option value="domain_controlled">domain_controlled</option>
            <option value="verified_business">verified_business</option>
            <option value="regulated_operator">regulated_operator</option>
            <option value="public_authority">public_authority</option>
          </select>
        </Field>
      </FieldGroup>
    </WorkflowFormShell>
  )
}

function IssuerStatusForm({
  workflowId,
  isSubmitting,
  onSubmit,
}: ManagementWorkflowFormProps) {
  const t = useT()
  const [rootProgramId, setRootProgramId] = useState(defaultRootProgramId)
  const [delegatedAuthorityId, setDelegatedAuthorityId] = useState(
    defaultDelegatedAuthorityId,
  )
  const [issuerId, setIssuerId] = useState(defaultIssuerId)
  const [enrollmentStatus, setEnrollmentStatus] = useState("active")

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    onSubmit(workflowId, {
      root_program_id: rootProgramId.trim(),
      delegated_authority_id: delegatedAuthorityId.trim(),
      issuer_id: issuerId.trim(),
      enrollment_status: enrollmentStatus,
    })
  }

  return (
    <WorkflowFormShell
      title="operator.workflow.issuerStatus.title"
      description="operator.workflow.issuerStatus.description"
      endpoint="POST /admin/issuers/status"
      submitLabel="operator.workflow.issuerStatus.submit"
      isSubmitting={isSubmitting}
      onSubmit={handleSubmit}
    >
      <GovernanceScopeFields
        rootProgramId={rootProgramId}
        delegatedAuthorityId={delegatedAuthorityId}
        issuerId={issuerId}
        onRootProgramIdChange={setRootProgramId}
        onDelegatedAuthorityIdChange={setDelegatedAuthorityId}
        onIssuerIdChange={setIssuerId}
      />
      <Field>
        <FieldLabel htmlFor="management-issuer-status">
          {t("operator.workflow.field.status")}
        </FieldLabel>
        <select
          id="management-issuer-status"
          className={selectClassName}
          value={enrollmentStatus}
          onChange={(event) => setEnrollmentStatus(event.target.value)}
        >
          <option value="pending">pending</option>
          <option value="active">active</option>
          <option value="suspended">suspended</option>
          <option value="revoked">revoked</option>
          <option value="expired">expired</option>
        </select>
      </Field>
    </WorkflowFormShell>
  )
}

function DomainProofForm({
  workflowId,
  isSubmitting,
  onSubmit,
}: ManagementWorkflowFormProps) {
  const t = useT()
  const [rootProgramId, setRootProgramId] = useState(defaultRootProgramId)
  const [delegatedAuthorityId, setDelegatedAuthorityId] = useState(
    defaultDelegatedAuthorityId,
  )
  const [issuerId, setIssuerId] = useState(defaultIssuerId)
  const [domain, setDomain] = useState(defaultDomain)
  const [proofMethod, setProofMethod] = useState("manual_review")
  const [verificationStatus, setVerificationStatus] = useState("verified")
  const [evidenceRef, setEvidenceRef] = useState(
    "operator://local-demo/domain-proof",
  )

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    onSubmit(workflowId, {
      root_program_id: rootProgramId.trim(),
      delegated_authority_id: delegatedAuthorityId.trim(),
      issuer_id: issuerId.trim(),
      domain: domain.trim(),
      proof_method: proofMethod,
      verification_status: verificationStatus,
      evidence_ref: optionalText(evidenceRef),
    })
  }

  return (
    <WorkflowFormShell
      title="operator.workflow.domainProof.title"
      description="operator.workflow.domainProof.description"
      endpoint="POST /admin/domain-proofs"
      submitLabel="operator.workflow.domainProof.submit"
      isSubmitting={isSubmitting}
      onSubmit={handleSubmit}
    >
      <GovernanceScopeFields
        rootProgramId={rootProgramId}
        delegatedAuthorityId={delegatedAuthorityId}
        issuerId={issuerId}
        onRootProgramIdChange={setRootProgramId}
        onDelegatedAuthorityIdChange={setDelegatedAuthorityId}
        onIssuerIdChange={setIssuerId}
      />
      <FieldGroup className="grid gap-4 md:grid-cols-3">
        <Field>
          <FieldLabel htmlFor="management-domain">
            {t("operator.workflow.field.domain")}
          </FieldLabel>
          <Input
            id="management-domain"
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="management-proof-method">
            {t("operator.workflow.field.proofMethod")}
          </FieldLabel>
          <select
            id="management-proof-method"
            className={selectClassName}
            value={proofMethod}
            onChange={(event) => setProofMethod(event.target.value)}
          >
            <option value="dns_txt">dns_txt</option>
            <option value="https_well_known">https_well_known</option>
            <option value="payment_processor">payment_processor</option>
            <option value="enterprise_directory">enterprise_directory</option>
            <option value="manual_review">manual_review</option>
          </select>
        </Field>
        <Field>
          <FieldLabel htmlFor="management-verification-status">
            {t("operator.workflow.field.verificationStatus")}
          </FieldLabel>
          <select
            id="management-verification-status"
            className={selectClassName}
            value={verificationStatus}
            onChange={(event) => setVerificationStatus(event.target.value)}
          >
            <option value="pending">pending</option>
            <option value="verified">verified</option>
            <option value="failed">failed</option>
            <option value="expired">expired</option>
            <option value="revoked">revoked</option>
          </select>
        </Field>
      </FieldGroup>
      <Field>
        <FieldLabel htmlFor="management-evidence-ref">
          {t("operator.workflow.field.evidenceRef")}
        </FieldLabel>
        <Input
          id="management-evidence-ref"
          value={evidenceRef}
          onChange={(event) => setEvidenceRef(event.target.value)}
        />
      </Field>
    </WorkflowFormShell>
  )
}

function DestinationPolicyForm({
  workflowId,
  isSubmitting,
  onSubmit,
}: ManagementWorkflowFormProps) {
  const t = useT()
  const [rootProgramId, setRootProgramId] = useState(defaultRootProgramId)
  const [delegatedAuthorityId, setDelegatedAuthorityId] = useState(
    defaultDelegatedAuthorityId,
  )
  const [issuerId, setIssuerId] = useState(defaultIssuerId)
  const [destinationPolicyId, setDestinationPolicyId] = useState(
    defaultDestinationPolicyId,
  )
  const [usagePolicy, setUsagePolicy] = useState("reusable_public")
  const [destinationId, setDestinationId] = useState("acme-pay")
  const [expectedFinalUrl, setExpectedFinalUrl] = useState(
    "https://acme.example/pay",
  )
  const [allowedHosts, setAllowedHosts] = useState(defaultDomain)
  const [pathPrefixes, setPathPrefixes] = useState("/pay")
  const [queryPolicy, setQueryPolicy] = useState("none")
  const [allowSubdomains, setAllowSubdomains] = useState(false)
  const [maxRedirectHops, setMaxRedirectHops] = useState("0")
  const [runtimeProvider, setRuntimeProvider] = useState(
    "deterministic-runtime-safety",
  )

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    const hostList = splitTextItems(allowedHosts)
    onSubmit(workflowId, {
      root_program_id: rootProgramId.trim(),
      delegated_authority_id: delegatedAuthorityId.trim(),
      issuer_id: issuerId.trim(),
      destination_policy_id: destinationPolicyId.trim(),
      usage_policy: usagePolicy,
      approved_destinations: [
        {
          destination_id: destinationId.trim(),
          expected_final_url: expectedFinalUrl.trim(),
          allowed_hosts: hostList,
          allow_subdomains: allowSubdomains,
          path_prefixes: splitTextItems(pathPrefixes),
          query_policy: queryPolicy.trim(),
        },
      ],
      redirect_policy: {
        max_redirect_hops: parsePositiveInteger(maxRedirectHops, 0),
        allowed_redirect_hosts: hostList,
        expected_final_destinations: [expectedFinalUrl.trim()],
      },
      runtime_safety_policy: {
        provider: runtimeProvider.trim(),
      },
    })
  }

  return (
    <WorkflowFormShell
      title="operator.workflow.destinationPolicy.title"
      description="operator.workflow.destinationPolicy.description"
      endpoint="POST /admin/destination-policies"
      submitLabel="operator.workflow.destinationPolicy.submit"
      isSubmitting={isSubmitting}
      onSubmit={handleSubmit}
    >
      <GovernanceScopeFields
        rootProgramId={rootProgramId}
        delegatedAuthorityId={delegatedAuthorityId}
        issuerId={issuerId}
        onRootProgramIdChange={setRootProgramId}
        onDelegatedAuthorityIdChange={setDelegatedAuthorityId}
        onIssuerIdChange={setIssuerId}
      />
      <FieldGroup className="grid gap-4 md:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="management-policy-id">
            {t("operator.workflow.field.destinationPolicyId")}
          </FieldLabel>
          <Input
            id="management-policy-id"
            value={destinationPolicyId}
            onChange={(event) => setDestinationPolicyId(event.target.value)}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="management-usage-policy">
            {t("operator.workflow.field.usagePolicy")}
          </FieldLabel>
          <select
            id="management-usage-policy"
            className={selectClassName}
            value={usagePolicy}
            onChange={(event) => setUsagePolicy(event.target.value)}
          >
            <option value="reusable_public">reusable_public</option>
            <option value="one_time">one_time</option>
            <option value="time_limited">time_limited</option>
          </select>
        </Field>
        <Field>
          <FieldLabel htmlFor="management-destination-id">
            {t("operator.workflow.field.destinationId")}
          </FieldLabel>
          <Input
            id="management-destination-id"
            value={destinationId}
            onChange={(event) => setDestinationId(event.target.value)}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="management-expected-final-url">
            {t("operator.workflow.field.expectedFinalUrl")}
          </FieldLabel>
          <Input
            id="management-expected-final-url"
            value={expectedFinalUrl}
            onChange={(event) => setExpectedFinalUrl(event.target.value)}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="management-allowed-hosts">
            {t("operator.workflow.field.allowedHosts")}
          </FieldLabel>
          <Textarea
            id="management-allowed-hosts"
            value={allowedHosts}
            onChange={(event) => setAllowedHosts(event.target.value)}
            required
          />
          <FieldDescription>
            {t("operator.workflow.hint.hostnames")}
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="management-path-prefixes">
            {t("operator.workflow.field.pathPrefixes")}
          </FieldLabel>
          <Input
            id="management-path-prefixes"
            value={pathPrefixes}
            onChange={(event) => setPathPrefixes(event.target.value)}
          />
          <FieldDescription>
            {t("operator.workflow.hint.pathPrefixes")}
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="management-query-policy">
            {t("operator.workflow.field.queryPolicy")}
          </FieldLabel>
          <select
            id="management-query-policy"
            className={selectClassName}
            value={queryPolicy}
            onChange={(event) => setQueryPolicy(event.target.value)}
          >
            <option value="none">none</option>
            <option value="allow_known_payment_query">
              allow_known_payment_query
            </option>
          </select>
        </Field>
        <Field>
          <FieldLabel htmlFor="management-max-redirects">
            {t("operator.workflow.field.maxRedirectHops")}
          </FieldLabel>
          <Input
            id="management-max-redirects"
            type="number"
            min="0"
            value={maxRedirectHops}
            onChange={(event) => setMaxRedirectHops(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="management-runtime-provider">
            {t("operator.workflow.field.runtimeSafetyProvider")}
          </FieldLabel>
          <Input
            id="management-runtime-provider"
            value={runtimeProvider}
            onChange={(event) => setRuntimeProvider(event.target.value)}
            required
          />
        </Field>
        <Field orientation="horizontal" className="items-center">
          <input
            id="management-allow-subdomains"
            type="checkbox"
            aria-label={t("operator.workflow.field.allowSubdomains")}
            checked={allowSubdomains}
            onChange={(event) => setAllowSubdomains(event.target.checked)}
            className="size-4 rounded border border-white/15 bg-[rgba(5,10,18,0.45)] accent-[#45D483]"
          />
          <FieldLabel htmlFor="management-allow-subdomains">
            {t("operator.workflow.field.allowSubdomains")}
          </FieldLabel>
        </Field>
      </FieldGroup>
    </WorkflowFormShell>
  )
}

function DestinationPolicyStatusForm({
  workflowId,
  isSubmitting,
  onSubmit,
}: ManagementWorkflowFormProps) {
  const t = useT()
  const [rootProgramId, setRootProgramId] = useState(defaultRootProgramId)
  const [delegatedAuthorityId, setDelegatedAuthorityId] = useState(
    defaultDelegatedAuthorityId,
  )
  const [issuerId, setIssuerId] = useState(defaultIssuerId)
  const [destinationPolicyId, setDestinationPolicyId] = useState(
    defaultDestinationPolicyId,
  )
  const [policyStatus, setPolicyStatus] = useState("active")

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    onSubmit(workflowId, {
      root_program_id: rootProgramId.trim(),
      delegated_authority_id: delegatedAuthorityId.trim(),
      issuer_id: issuerId.trim(),
      destination_policy_id: destinationPolicyId.trim(),
      status: policyStatus,
    })
  }

  return (
    <WorkflowFormShell
      title="operator.workflow.policyStatus.title"
      description="operator.workflow.policyStatus.description"
      endpoint="POST /admin/destination-policies/status"
      submitLabel="operator.workflow.policyStatus.submit"
      isSubmitting={isSubmitting}
      onSubmit={handleSubmit}
    >
      <GovernanceScopeFields
        rootProgramId={rootProgramId}
        delegatedAuthorityId={delegatedAuthorityId}
        issuerId={issuerId}
        onRootProgramIdChange={setRootProgramId}
        onDelegatedAuthorityIdChange={setDelegatedAuthorityId}
        onIssuerIdChange={setIssuerId}
      />
      <FieldGroup className="grid gap-4 md:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="management-policy-status-id">
            {t("operator.workflow.field.destinationPolicyId")}
          </FieldLabel>
          <Input
            id="management-policy-status-id"
            value={destinationPolicyId}
            onChange={(event) => setDestinationPolicyId(event.target.value)}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="management-policy-status">
            {t("operator.workflow.field.status")}
          </FieldLabel>
          <select
            id="management-policy-status"
            className={selectClassName}
            value={policyStatus}
            onChange={(event) => setPolicyStatus(event.target.value)}
          >
            <option value="active">active</option>
            <option value="suspended">suspended</option>
            <option value="revoked">revoked</option>
            <option value="expired">expired</option>
          </select>
        </Field>
      </FieldGroup>
    </WorkflowFormShell>
  )
}

function NatsSubscriberForm({
  workflowId,
  isSubmitting,
  onSubmit,
}: ManagementWorkflowFormProps) {
  const t = useT()
  const [subscriberId, setSubscriberId] = useState("network-governance-worker")
  const [displayName, setDisplayName] = useState("Network Governance Worker")
  const [durableName, setDurableName] = useState("qrtrust-governance")
  const [description, setDescription] = useState(
    "Consumes approved governance events from the QR Trust outbox stream.",
  )
  const [subjects, setSubjects] = useState(() =>
    [
      "qrtrust.*.root.>",
      "qrtrust.*.authority.>",
      "qrtrust.*.issuer.>",
      "qrtrust.*.destination.>",
      "qrtrust.*.certificate.>",
    ].join("\n"),
  )

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    onSubmit(workflowId, {
      subscriber_id: subscriberId.trim(),
      display_name: displayName.trim(),
      durable_name: durableName.trim(),
      description: description.trim(),
      subjects: splitTextItems(subjects),
    })
  }

  return (
    <WorkflowFormShell
      title="operator.workflow.natsSubscriber.title"
      description="operator.workflow.natsSubscriber.description"
      endpoint="POST /admin/nats/subscribers"
      submitLabel="operator.workflow.natsSubscriber.submit"
      isSubmitting={isSubmitting}
      onSubmit={handleSubmit}
    >
      <FieldGroup className="grid gap-4 md:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="management-subscriber-id">
            {t("operator.workflow.field.subscriberId")}
          </FieldLabel>
          <Input
            id="management-subscriber-id"
            value={subscriberId}
            onChange={(event) => setSubscriberId(event.target.value)}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="management-subscriber-display-name">
            {t("operator.workflow.field.displayName")}
          </FieldLabel>
          <Input
            id="management-subscriber-display-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="management-durable-name">
            {t("operator.workflow.field.durableName")}
          </FieldLabel>
          <Input
            id="management-durable-name"
            value={durableName}
            onChange={(event) => setDurableName(event.target.value)}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="management-subscriber-description">
            {t("operator.workflow.field.description")}
          </FieldLabel>
          <Input
            id="management-subscriber-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
      </FieldGroup>
      <Field>
        <FieldLabel htmlFor="management-subscriber-subjects">
          {t("operator.workflow.field.subjects")}
        </FieldLabel>
        <Textarea
          id="management-subscriber-subjects"
          value={subjects}
          onChange={(event) => setSubjects(event.target.value)}
          required
        />
        <FieldDescription>
          {t("operator.workflow.hint.subjects")}
        </FieldDescription>
      </Field>
    </WorkflowFormShell>
  )
}

function RuntimeProviderForm({
  workflowId,
  isSubmitting,
  onSubmit,
}: ManagementWorkflowFormProps) {
  const t = useT()
  const [form, setForm] = useState<RuntimeProviderFormState>({
    providerId: "deterministic-runtime-safety",
    displayName: "Deterministic runtime safety",
    baseUrl: "",
    verdictTtlSeconds: "300",
    staleBehavior: "downgrade_to_caution",
    unavailableBehavior: "block",
    providerStatus: "active",
  })

  function updateField(
    field: keyof RuntimeProviderFormState,
    value: string,
  ) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    onSubmit(workflowId, {
      provider_id: form.providerId.trim(),
      display_name: form.displayName.trim(),
      base_url: optionalText(form.baseUrl),
      verdict_ttl_seconds: Math.max(
        1,
        parsePositiveInteger(form.verdictTtlSeconds, 300),
      ),
      stale_behavior: form.staleBehavior,
      unavailable_behavior: form.unavailableBehavior,
      status: form.providerStatus,
    })
  }

  return (
    <WorkflowFormShell
      title="operator.workflow.runtimeProvider.title"
      description="operator.workflow.runtimeProvider.description"
      endpoint="POST /admin/runtime-providers"
      submitLabel="operator.workflow.runtimeProvider.submit"
      isSubmitting={isSubmitting}
      onSubmit={handleSubmit}
    >
      <FieldGroup className="grid gap-4 md:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="management-runtime-provider-id">
            {t("operator.workflow.field.providerId")}
          </FieldLabel>
          <Input
            id="management-runtime-provider-id"
            value={form.providerId}
            onChange={(event) => updateField("providerId", event.target.value)}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="management-runtime-provider-name">
            {t("operator.workflow.field.displayName")}
          </FieldLabel>
          <Input
            id="management-runtime-provider-name"
            value={form.displayName}
            onChange={(event) => updateField("displayName", event.target.value)}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="management-runtime-provider-base-url">
            {t("operator.workflow.field.baseUrl")}
          </FieldLabel>
          <Input
            id="management-runtime-provider-base-url"
            value={form.baseUrl}
            onChange={(event) => updateField("baseUrl", event.target.value)}
            placeholder="https://runtime.example"
          />
          <FieldDescription>
            {t("operator.workflow.hint.baseUrl")}
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="management-runtime-provider-ttl">
            {t("operator.workflow.field.verdictTtlSeconds")}
          </FieldLabel>
          <Input
            id="management-runtime-provider-ttl"
            type="number"
            min="1"
            value={form.verdictTtlSeconds}
            onChange={(event) =>
              updateField("verdictTtlSeconds", event.target.value)
            }
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="management-runtime-provider-stale">
            {t("operator.workflow.field.staleBehavior")}
          </FieldLabel>
          <select
            id="management-runtime-provider-stale"
            className={selectClassName}
            value={form.staleBehavior}
            onChange={(event) => updateField("staleBehavior", event.target.value)}
          >
            <option value="downgrade_to_caution">downgrade_to_caution</option>
            <option value="block">block</option>
          </select>
        </Field>
        <Field>
          <FieldLabel htmlFor="management-runtime-provider-unavailable">
            {t("operator.workflow.field.unavailableBehavior")}
          </FieldLabel>
          <select
            id="management-runtime-provider-unavailable"
            className={selectClassName}
            value={form.unavailableBehavior}
            onChange={(event) =>
              updateField("unavailableBehavior", event.target.value)
            }
          >
            <option value="downgrade_to_caution">downgrade_to_caution</option>
            <option value="block">block</option>
          </select>
        </Field>
        <Field>
          <FieldLabel htmlFor="management-runtime-provider-status">
            {t("operator.workflow.field.status")}
          </FieldLabel>
          <select
            id="management-runtime-provider-status"
            className={selectClassName}
            value={form.providerStatus}
            onChange={(event) => updateField("providerStatus", event.target.value)}
          >
            <option value="active">active</option>
            <option value="suspended">suspended</option>
            <option value="retired">retired</option>
          </select>
        </Field>
      </FieldGroup>
    </WorkflowFormShell>
  )
}

function OutboxRemediationForm({
  workflowId,
  isSubmitting,
  onSubmit,
}: ManagementWorkflowFormProps) {
  const t = useT()
  const [eventId, setEventId] = useState("")
  const [action, setAction] = useState("retry")
  const [reason, setReason] = useState("operator reviewed event state")

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    onSubmit(workflowId, {
      event_id: eventId.trim(),
      action,
      reason: optionalText(reason),
    })
  }

  return (
    <WorkflowFormShell
      title="operator.workflow.outboxRemediation.title"
      description="operator.workflow.outboxRemediation.description"
      endpoint="POST /admin/outbox/events/remediate"
      submitLabel="operator.workflow.outboxRemediation.submit"
      isSubmitting={isSubmitting}
      onSubmit={handleSubmit}
    >
      <FieldGroup className="grid gap-4 md:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="management-outbox-event-id">
            {t("operator.workflow.field.outboxEventId")}
          </FieldLabel>
          <Input
            id="management-outbox-event-id"
            value={eventId}
            onChange={(event) => setEventId(event.target.value)}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="management-outbox-action">
            {t("operator.workflow.field.action")}
          </FieldLabel>
          <select
            id="management-outbox-action"
            className={selectClassName}
            value={action}
            onChange={(event) => setAction(event.target.value)}
          >
            <option value="retry">retry</option>
            <option value="quarantine">quarantine</option>
          </select>
        </Field>
      </FieldGroup>
      <Field>
        <FieldLabel htmlFor="management-outbox-reason">
          {t("operator.workflow.field.reason")}
        </FieldLabel>
        <Textarea
          id="management-outbox-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
    </WorkflowFormShell>
  )
}

function ReadOnlyWorkflowPanel({
  title,
  description,
  onRefreshEvidence,
}: {
  title: MessageKey
  description: MessageKey
  onRefreshEvidence: () => void
}) {
  const t = useT()

  return (
    <div className="grid gap-3 rounded-2xl border border-white/8 bg-white/3 p-4">
      <div className="grid gap-1">
        <h4 className="text-base font-semibold text-foreground">{t(title)}</h4>
        <p className="text-sm leading-6 text-muted-foreground">
          {t(description)}
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        className="w-full justify-center"
        onClick={onRefreshEvidence}
      >
        <RotateCcw className="size-4" />
        {t("operator.workflow.refreshEvidence")}
      </Button>
    </div>
  )
}

function ManagementWorkflowForm(props: ManagementWorkflowFormProps) {
  if (props.workflowId === "authority-setup") {
    return <AuthoritySetupForm {...props} />
  }
  if (props.workflowId === "issuer-enrollment") {
    return <IssuerEnrollmentForm {...props} />
  }
  if (props.workflowId === "trust-keys") {
    return <TrustKeyForm {...props} />
  }
  if (props.workflowId === "issuer-status") {
    return <IssuerStatusForm {...props} />
  }
  if (props.workflowId === "domain-proof") {
    return <DomainProofForm {...props} />
  }
  if (props.workflowId === "destination-policy") {
    return <DestinationPolicyForm {...props} />
  }
  if (props.workflowId === "policy-status") {
    return <DestinationPolicyStatusForm {...props} />
  }
  if (props.workflowId === "runtime-providers") {
    return <RuntimeProviderForm {...props} />
  }
  if (props.workflowId === "nats-subscribers") {
    return <NatsSubscriberForm {...props} />
  }
  if (props.workflowId === "outbox-health") {
    return <OutboxRemediationForm {...props} />
  }
  return (
    <ReadOnlyWorkflowPanel
      title="operator.workflow.auditReview.title"
      description="operator.workflow.auditReview.description"
      onRefreshEvidence={props.onRefreshEvidence}
    />
  )
}

export default ManagementWorkflowForm
