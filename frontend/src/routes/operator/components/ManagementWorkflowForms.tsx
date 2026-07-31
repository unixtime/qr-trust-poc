import { RotateCcw, Send } from "lucide-react"
import { type FormEvent, type ReactNode, useReducer, useState } from "react"

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

const defaultRootProgramId = "qr-trust-local"
const defaultDelegatedAuthorityId = "acme-local-authority"
const defaultIssuerId = "acme-demo"
const defaultDomain = "acme.example"

const defaultTrustKeyFormState: TrustKeyFormState = {
  rootProgramId: defaultRootProgramId,
  delegatedAuthorityId: defaultDelegatedAuthorityId,
  keyId: "key:authority:acme-local-authority:ed25519:v1",
  signerId: defaultDelegatedAuthorityId,
  algorithmId: "ed25519",
  publicKeyMaterialRef: "managed://qrtrust/acme-local-authority/public/v1",
  publicKeyMaterialPem: "",
  scope: "delegated_authority",
  keyStatus: "active",
  statusUpdate: "no_change",
  notBefore: "",
  notAfter: "",
}

const selectClassName =
  "h-10 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"

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
  title: string
  description: string
  endpoint: string
  submitLabel: string
  isSubmitting: boolean
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  children: ReactNode
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="grid gap-4 rounded-2xl border border-border/70 bg-card/75 p-4"
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h4 className="text-base font-semibold text-foreground">{title}</h4>
          <p className="text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
        <Badge variant="outline" className="max-w-full truncate" title={endpoint}>
          {endpoint}
        </Badge>
      </div>
      {children}
      <Button type="submit" className="w-full justify-center" disabled={isSubmitting}>
        <Send className="size-4" />
        {isSubmitting ? "Recording..." : submitLabel}
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
  return (
    <FieldGroup className="grid gap-4 md:grid-cols-3">
      <Field>
        <FieldLabel htmlFor="management-root-program-id">
          Root program
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
          Delegated authority
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
          <FieldLabel htmlFor="management-issuer-id">Issuer ID</FieldLabel>
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
  const [rootProgramId, setRootProgramId] = useState(defaultRootProgramId)
  const [rootName, setRootName] = useState("QR Trust Local Root")
  const [programScope, setProgramScope] = useState("local-development")
  const [algorithms, setAlgorithms] = useState("ed25519, es256")
  const [delegatedAuthorityId, setDelegatedAuthorityId] = useState(
    defaultDelegatedAuthorityId,
  )
  const [delegatedName, setDelegatedName] = useState("ACME Local Authority")
  const [authorityType, setAuthorityType] = useState("merchant_operator")

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
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
      title="Authority setup"
      description="Create or update the root program and delegated authority that issuer enrollment depends on."
      endpoint="POST /admin/root-programs -> /admin/delegated-authorities"
      submitLabel="Record authority setup"
      isSubmitting={isSubmitting}
      onSubmit={handleSubmit}
    >
      <FieldGroup className="grid gap-4 md:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="management-authority-root-id">
            Root program
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
            Root name
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
            Program scope
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
            Accepted algorithms
          </FieldLabel>
          <Input
            id="management-authority-algorithms"
            value={algorithms}
            onChange={(event) => setAlgorithms(event.target.value)}
            required
          />
          <FieldDescription>Comma-separated algorithm identifiers.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="management-authority-id">
            Delegated authority
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
            Authority name
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
            Authority type
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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
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
      title="Trust keys"
      description="Publish signer-key metadata into Postgres so NATS projections and verifiers receive the same authority state."
      endpoint="POST /admin/trust-keys -> /admin/trust-keys/status"
      submitLabel="Record trust key"
      isSubmitting={isSubmitting}
      onSubmit={handleSubmit}
    >
      <FieldGroup className="grid gap-4 md:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="management-trust-key-root-program">
            Root program
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
          <FieldLabel htmlFor="management-trust-key-id">Key ID</FieldLabel>
          <Input
            id="management-trust-key-id"
            value={keyId}
            onChange={(event) => updateFormState({ keyId: event.target.value })}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="management-trust-key-scope">Scope</FieldLabel>
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
            Delegated authority
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
            Signer ID
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
            Algorithm
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
            Public key material ref
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
            Use a managed reference by default; paste PEM only for local test keys.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="management-trust-key-status">
            Key status
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
            Optional status event
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
            Not before
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
            Not after
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
          Public key PEM
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
  const [rootProgramId, setRootProgramId] = useState(defaultRootProgramId)
  const [delegatedAuthorityId, setDelegatedAuthorityId] = useState(
    defaultDelegatedAuthorityId,
  )
  const [issuerId, setIssuerId] = useState(defaultIssuerId)
  const [displayName, setDisplayName] = useState("ACME Demo Issuer")
  const [issuerClass, setIssuerClass] = useState("business")
  const [assuranceTier, setAssuranceTier] = useState("domain_controlled")

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
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
      title="Issuer enrollment"
      description="Create a pending issuer under the selected root and authority."
      endpoint="POST /admin/issuers"
      submitLabel="Record issuer enrollment"
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
            Display name
          </FieldLabel>
          <Input
            id="management-issuer-display-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="management-issuer-class">Issuer class</FieldLabel>
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
            Assurance tier
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
  const [rootProgramId, setRootProgramId] = useState(defaultRootProgramId)
  const [delegatedAuthorityId, setDelegatedAuthorityId] = useState(
    defaultDelegatedAuthorityId,
  )
  const [issuerId, setIssuerId] = useState(defaultIssuerId)
  const [enrollmentStatus, setEnrollmentStatus] = useState("active")

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
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
      title="Issuer status"
      description="Move an issuer between active, suspended, revoked, or expired state."
      endpoint="POST /admin/issuers/status"
      submitLabel="Record issuer status"
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
        <FieldLabel htmlFor="management-issuer-status">Status</FieldLabel>
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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
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
      title="Domain proof"
      description="Attach verified domain-control evidence to an issuer before policy approval."
      endpoint="POST /admin/domain-proofs"
      submitLabel="Record domain proof"
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
          <FieldLabel htmlFor="management-domain">Domain</FieldLabel>
          <Input
            id="management-domain"
            value={domain}
            onChange={(event) => setDomain(event.target.value)}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="management-proof-method">Proof method</FieldLabel>
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
            Verification status
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
        <FieldLabel htmlFor="management-evidence-ref">Evidence ref</FieldLabel>
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
  const [rootProgramId, setRootProgramId] = useState(defaultRootProgramId)
  const [delegatedAuthorityId, setDelegatedAuthorityId] = useState(
    defaultDelegatedAuthorityId,
  )
  const [issuerId, setIssuerId] = useState(defaultIssuerId)
  const [destinationPolicyId, setDestinationPolicyId] = useState(
    "acme-demo-policy",
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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
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
      title="Destination policy"
      description="Approve exact final destinations after issuer and domain preconditions are satisfied."
      endpoint="POST /admin/destination-policies"
      submitLabel="Record destination policy"
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
            Destination policy ID
          </FieldLabel>
          <Input
            id="management-policy-id"
            value={destinationPolicyId}
            onChange={(event) => setDestinationPolicyId(event.target.value)}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="management-usage-policy">Usage policy</FieldLabel>
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
            Destination ID
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
            Expected final URL
          </FieldLabel>
          <Input
            id="management-expected-final-url"
            value={expectedFinalUrl}
            onChange={(event) => setExpectedFinalUrl(event.target.value)}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="management-allowed-hosts">Allowed hosts</FieldLabel>
          <Textarea
            id="management-allowed-hosts"
            value={allowedHosts}
            onChange={(event) => setAllowedHosts(event.target.value)}
            required
          />
          <FieldDescription>Comma- or newline-separated hostnames.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="management-path-prefixes">Path prefixes</FieldLabel>
          <Input
            id="management-path-prefixes"
            value={pathPrefixes}
            onChange={(event) => setPathPrefixes(event.target.value)}
          />
          <FieldDescription>Comma-separated; leave empty for no path gate.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="management-query-policy">Query policy</FieldLabel>
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
            Max redirect hops
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
            Runtime safety provider
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
            aria-label="Allow subdomains"
            checked={allowSubdomains}
            onChange={(event) => setAllowSubdomains(event.target.checked)}
            className="size-4 rounded border border-input"
          />
          <FieldLabel htmlFor="management-allow-subdomains">
            Allow subdomains
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
  const [rootProgramId, setRootProgramId] = useState(defaultRootProgramId)
  const [delegatedAuthorityId, setDelegatedAuthorityId] = useState(
    defaultDelegatedAuthorityId,
  )
  const [issuerId, setIssuerId] = useState(defaultIssuerId)
  const [destinationPolicyId, setDestinationPolicyId] = useState(
    "acme-demo-policy",
  )
  const [policyStatus, setPolicyStatus] = useState("active")

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
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
      title="Policy status"
      description="Change an existing destination-policy lifecycle state."
      endpoint="POST /admin/destination-policies/status"
      submitLabel="Record policy status"
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
            Destination policy ID
          </FieldLabel>
          <Input
            id="management-policy-status-id"
            value={destinationPolicyId}
            onChange={(event) => setDestinationPolicyId(event.target.value)}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="management-policy-status">Status</FieldLabel>
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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
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
      title="NATS subscriber authorization"
      description="Approve a subscriber identity and the NATS subject families it can consume."
      endpoint="POST /admin/nats/subscribers"
      submitLabel="Authorize subscriber"
      isSubmitting={isSubmitting}
      onSubmit={handleSubmit}
    >
      <FieldGroup className="grid gap-4 md:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="management-subscriber-id">
            Subscriber ID
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
            Display name
          </FieldLabel>
          <Input
            id="management-subscriber-display-name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="management-durable-name">Durable name</FieldLabel>
          <Input
            id="management-durable-name"
            value={durableName}
            onChange={(event) => setDurableName(event.target.value)}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="management-subscriber-description">
            Description
          </FieldLabel>
          <Input
            id="management-subscriber-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
      </FieldGroup>
      <Field>
        <FieldLabel htmlFor="management-subscriber-subjects">Subjects</FieldLabel>
        <Textarea
          id="management-subscriber-subjects"
          value={subjects}
          onChange={(event) => setSubjects(event.target.value)}
          required
        />
        <FieldDescription>Comma- or newline-separated subject patterns.</FieldDescription>
      </Field>
    </WorkflowFormShell>
  )
}

function RuntimeProviderForm({
  workflowId,
  isSubmitting,
  onSubmit,
}: ManagementWorkflowFormProps) {
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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
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
      title="Runtime provider"
      description="Register the runtime safety provider used by destination policies and verifier posture checks."
      endpoint="POST /admin/runtime-providers"
      submitLabel="Record runtime provider"
      isSubmitting={isSubmitting}
      onSubmit={handleSubmit}
    >
      <FieldGroup className="grid gap-4 md:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="management-runtime-provider-id">
            Provider ID
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
            Display name
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
            Base URL
          </FieldLabel>
          <Input
            id="management-runtime-provider-base-url"
            value={form.baseUrl}
            onChange={(event) => updateField("baseUrl", event.target.value)}
            placeholder="https://runtime.example"
          />
          <FieldDescription>
            Leave empty for the local deterministic provider.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="management-runtime-provider-ttl">
            Verdict TTL seconds
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
            Stale behavior
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
            Unavailable behavior
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
            Status
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
  const [eventId, setEventId] = useState("")
  const [action, setAction] = useState("retry")
  const [reason, setReason] = useState("operator reviewed event state")

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSubmit(workflowId, {
      event_id: eventId.trim(),
      action,
      reason: optionalText(reason),
    })
  }

  return (
    <WorkflowFormShell
      title="Outbox remediation"
      description="Retry a remediated outbox row or quarantine an unsafe row without direct SQL."
      endpoint="POST /admin/outbox/events/remediate"
      submitLabel="Record outbox remediation"
      isSubmitting={isSubmitting}
      onSubmit={handleSubmit}
    >
      <FieldGroup className="grid gap-4 md:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="management-outbox-event-id">
            Outbox event ID
          </FieldLabel>
          <Input
            id="management-outbox-event-id"
            value={eventId}
            onChange={(event) => setEventId(event.target.value)}
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="management-outbox-action">Action</FieldLabel>
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
        <FieldLabel htmlFor="management-outbox-reason">Reason</FieldLabel>
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
  title: string
  description: string
  onRefreshEvidence: () => void
}) {
  return (
    <div className="grid gap-3 rounded-2xl border border-border/70 bg-card/75 p-4">
      <div className="grid gap-1">
        <h4 className="text-base font-semibold text-foreground">{title}</h4>
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      <Button
        type="button"
        variant="outline"
        className="w-full justify-center"
        onClick={onRefreshEvidence}
      >
        <RotateCcw className="size-4" />
        Refresh evidence
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
      title="Audit review"
      description="Review recent governance audit rows and verify the source-state mutation trail."
      onRefreshEvidence={props.onRefreshEvidence}
    />
  )
}

export default ManagementWorkflowForm
