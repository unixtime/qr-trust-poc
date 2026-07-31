export const problemPipeline = [
  {
    title: "What scanners do today",
    subtitle: "Convenience pipeline",
    items: [
      "Detect the QR",
      "Decode the payload",
      "Surface a URL or app intent",
      "Leave trust judgment to the user",
    ],
    note: "The scanner answers what this is, but not whether it should be trusted.",
  },
  {
    title: "What integrity-focused systems check",
    subtitle: "Integrity layer",
    items: [
      "Signed payloads",
      "Certificate checks",
      "HTTPS transport",
      "Cleaner warning UI",
    ],
    note: "A QR can validate syntactically and cryptographically and still be unsafe to open.",
  },
  {
    title: "What users actually need",
    subtitle: "Trust questions",
    items: [
      "Who issued this code?",
      "Is the issuer trusted?",
      "Is the destination still approved?",
      "Is opening it safe right now?",
    ],
    note: "Trust is a managed platform signal, not a side effect of successful decoding.",
  },
] as const

export const problemDiagramFooters = [
  {
    label: "Failure",
    title: "Decoding is mistaken for trust",
    copy: "The scanner answers “what is this?” but not “should I trust it?”",
    tone:
      "border-red-900/10 bg-red-500/8 text-red-950 dark:border-red-200/10 dark:bg-red-300/8 dark:text-red-50",
  },
  {
    label: "Limit",
    title: "A QR can validate and still be unsafe",
    copy: "Integrity checks do not prove destination approval or present-time safety.",
    tone:
      "border-amber-900/10 bg-amber-400/10 text-amber-950 dark:border-amber-200/10 dark:bg-amber-300/8 dark:text-amber-50",
  },
  {
    label: "Consequence",
    title: "Trust must be managed as shared state",
    copy: "User-visible outcomes depend on issuer, binding, runtime safety, and policy.",
    tone:
      "border-emerald-900/10 bg-emerald-500/8 text-emerald-950 dark:border-emerald-200/10 dark:bg-emerald-300/8 dark:text-emerald-50",
  },
] as const

export const trustStackLayers = [
  {
    title: "Issuer legitimacy",
    question: "Who is authorized to issue this QR under a trusted program?",
    examples: "Verified individual, business, institution, payment operator",
    tone:
      "border-emerald-900/10 bg-emerald-500/8 text-emerald-950 dark:border-emerald-200/10 dark:bg-emerald-300/8 dark:text-emerald-50",
  },
  {
    title: "Destination binding",
    question: "Is the QR still bound to the issuer-approved destination?",
    examples: "Exact URL, normalization, subdomain policy, post-issuance changes",
    tone:
      "border-sky-900/10 bg-sky-500/8 text-sky-950 dark:border-sky-200/10 dark:bg-sky-300/8 dark:text-sky-50",
  },
  {
    title: "Runtime safety",
    question: "Is the destination safe right now?",
    examples: "Redirects, reputation, malware, phishing, injected content",
    tone:
      "border-amber-900/10 bg-amber-400/10 text-amber-950 dark:border-amber-200/10 dark:bg-amber-300/8 dark:text-amber-50",
  },
  {
    title: "Scanner decision state",
    question: "How should the scanner summarize those signals for a human?",
    examples:
      "Unverified, signed unknown issuer, verified issuer, verified issuer destination risky, blocked",
    tone:
      "border-zinc-900/10 bg-zinc-500/6 text-zinc-950 dark:border-zinc-200/10 dark:bg-zinc-300/6 dark:text-zinc-50",
  },
] as const

export const governanceFlow = [
  {
    title: "Root trust program",
    items: ["Root keys", "Accreditation rules", "Delegation policy", "Distribution endpoints"],
  },
  {
    title: "Delegated operators",
    items: ["Payment operator tree", "Government tree", "Merchant and enterprise tree"],
  },
  {
    title: "Enrolled issuer node",
    items: ["Issuer identifier", "Assurance tier", "Key references", "Approved domains, resolvers, or apps"],
  },
  {
    title: "Signed artifacts and shared state",
    items: [
      "Delegation manifests",
      "Issuer manifests",
      "Destination policy updates",
      "Revocation and freshness metadata",
    ],
  },
  {
    title: "Scanner or verifier cache",
    items: [
      "Root and operator state",
      "Issuer state",
      "Destination policy state",
      "Revocation and freshness state",
    ],
  },
  {
    title: "Verifier decision path",
    items: [
      "Validate root → authority → issuer chain",
      "Validate issuer status and tier",
      "Validate current destination policy",
      "Check runtime safety and apply local policy",
    ],
  },
] as const

export const learnModeHighlights = [
  {
    label: "Audience",
    value: "Professors, reviewers, researchers, and engineers who need the paper translated into an interactive proof path.",
  },
  {
    label: "Current scope",
    value: "Problem framing, trust-stack architecture, governance, implementation-aligned case studies, and prepared teaching tracks now live together in this route.",
  },
  {
    label: "Engineering rule",
    value: "Guided mode does not replace the working verifier. It explains the model, then hands off to the technical lab.",
  },
] as const

export type LearnScenarioKey =
  | "valid"
  | "expired"
  | "revoked"
  | "subdomain-allowed"
  | "subdomain-blocked"
  | "payload-mismatch"
  | "redirect-approved"
  | "redirect-final-mismatch"
  | "redirect-too-many-hops"
  | "redirect-nested-shortener"
  | "runtime-risky"
  | "runtime-blocked"
  | "stale-cache"
  | "unknown-issuer"
  | "artifact-quiet-zone"
  | "artifact-mismatch"

export type LearnStageKey =
  | "problem"
  | "architecture"
  | "governance"
  | "cases"
  | "lab"

export type LessonTrackKey = "professor-seminar" | "reviewer-defense"
export type OperatorFocus = "runtime" | "access"

export type LessonTrackStep = {
  stage: LearnStageKey
  title: string
  prompt: string
  scenario?: LearnScenarioKey
  compareScenario?: LearnScenarioKey
  nonceMode?: "fixed" | "timestamped"
}

export type LessonTrack = {
  key: LessonTrackKey
  label: string
  audience: string
  summary: string
  steps: readonly LessonTrackStep[]
}

export type LessonTrackComparisonPair = {
  scenario: LearnScenarioKey
  compareScenario: LearnScenarioKey
  nonceMode: "fixed" | "timestamped"
}

export type PublicUseCase = (typeof publicUseCases)[number]

export const learnStages: Array<{
  key: LearnStageKey
  label: string
  title: string
  anchor: string
}> = [
  {
    key: "problem",
    label: "Problem",
    title: "Why QR trust is more than decoding",
    anchor: "problem-framing",
  },
  {
    key: "architecture",
    label: "Trust stack",
    title: "The four layers the scanner must combine",
    anchor: "trust-architecture",
  },
  {
    key: "governance",
    label: "Governance",
    title: "How shared trust state reaches the verifier",
    anchor: "governance-flow",
  },
  {
    key: "cases",
    label: "Case studies",
    title: "Move from the paper model into lab-ready use cases",
    anchor: "case-studies",
  },
  {
    key: "lab",
    label: "Lab handoff",
    title: "Open the working verifier with the intended scenario",
    anchor: "teaching-tracks",
  },
] as const

export const lessonTracks: Record<LessonTrackKey, LessonTrack> = {
  "professor-seminar": {
    key: "professor-seminar",
    label: "Professor mode",
    audience: "Seminar / classroom",
    summary:
      "A prepared teaching sequence that opens with the trust gap, lands on the four-layer architecture, then hands the class into a policy-driven lab contrast they can run live.",
    steps: [
      {
        stage: "problem",
        title: "Open with the trust gap",
        prompt:
          "Use the framing diagram to separate decoding success from the trust question users actually need answered.",
        scenario: "valid",
        compareScenario: "payload-mismatch",
      },
      {
        stage: "architecture",
        title: "Map the four-layer model",
        prompt:
          "Show freshness as a distinct layer by contrasting the clean baseline with an expired credential before you move into governance.",
        scenario: "valid",
        compareScenario: "expired",
      },
      {
        stage: "governance",
        title: "Show that issuer trust is shared state",
        prompt:
          "Use the governance map to explain why revocation is not discovered ad hoc at scan time. It is published and consumed as managed trust state.",
        scenario: "revoked",
        compareScenario: "valid",
      },
      {
        stage: "cases",
        title: "Ground the architecture in policy-driven binding",
        prompt:
          "Move into the paired subdomain cases to prove that destination binding is a governed rule, not a lexical guess.",
        scenario: "subdomain-allowed",
        compareScenario: "subdomain-blocked",
      },
      {
        stage: "lab",
        title: "Open the live policy contrast",
        prompt:
          "Launch the lab with the blocking subdomain case preloaded, then compare it against the allowed case while the class can still see the policy distinction.",
        scenario: "subdomain-blocked",
        compareScenario: "subdomain-allowed",
        nonceMode: "fixed",
      },
    ],
  },
  "reviewer-defense": {
    key: "reviewer-defense",
    label: "Reviewer mode",
    audience: "Paper defense / technical review",
    summary:
      "A prepared defense sequence that foregrounds signatures-versus-governance, then proves that revocation, expiry, and destination mismatch terminate trust for different reasons.",
    steps: [
      {
        stage: "architecture",
        title: "State the model precisely",
        prompt:
          "Use the trust-stack diagram to explain why legitimacy, binding, and freshness are independent checks rather than one broad notion of validity.",
        scenario: "valid",
        compareScenario: "expired",
      },
      {
        stage: "governance",
        title: "Defend revocation as managed trust state",
        prompt:
          "Use the governance flow to show that a legitimate issuer can become untrusted after issuance, and that the verifier must consume that updated state.",
        scenario: "revoked",
        compareScenario: "valid",
      },
      {
        stage: "cases",
        title: "Prove terminal policy precedence",
        prompt:
          "Move into the payload-mismatch case to show that a well-formed envelope still blocks once the observed destination leaves the approved set.",
        scenario: "payload-mismatch",
        compareScenario: "valid",
      },
      {
        stage: "lab",
        title: "Open the live blocking case",
        prompt:
          "Launch the working lab with the payload mismatch preloaded so the reviewer can inspect the real verifier result instead of a conceptual summary.",
        scenario: "payload-mismatch",
        compareScenario: "valid",
        nonceMode: "fixed",
      },
    ],
  },
}

export const lessonTrackList = Object.values(lessonTracks)

export type IllustrationTone = "neutral" | "success" | "warning" | "blocked"

export type ScenarioIllustration = {
  title: string
  layers: Array<{
    title: string
    value: string
    tone: IllustrationTone
    note: string
  }>
}

export const publicUseCases: Array<{
  audience: string
  title: string
  scenario: LearnScenarioKey
  compareScenario?: LearnScenarioKey
  nonceMode?: "fixed" | "timestamped"
  usagePolicy?: "reusable_public" | "one_time" | "time_limited"
  summary: string
  actor: string
  environment: string
  threat: string
  lesson: string
}> = [
  {
    audience: "Engineering demo",
    title: "Baseline success path and replay proof",
    scenario: "valid",
    nonceMode: "fixed",
    usagePolicy: "one_time",
    summary:
      "Start with the clean positive control, then verify the same QR twice to make replay protection visible without changing any other input.",
    actor: "Engineer or reviewer running the live verifier",
    environment: "Controlled browser or second-screen demo",
    threat: "Trust in a first successful scan is overgeneralized if replay is not enforced on subsequent scans.",
    lesson:
      "A valid first scan is not enough. The system also needs temporal and replay semantics that survive repeated use.",
  },
  {
    audience: "Security lecture",
    title: "Expired credential as freshness failure",
    scenario: "expired",
    compareScenario: "valid",
    nonceMode: "fixed",
    summary:
      "Contrast a clean baseline with a time-invalid envelope to show that verifier acceptance depends on freshness, not only signature structure.",
    actor: "Professor or student stepping through verifier stages",
    environment: "Lecture or workshop on QR verification semantics",
    threat: "A stale but otherwise well-formed envelope is treated as if it were still current.",
    lesson:
      "Freshness is a first-class trust input. A syntactically correct QR still fails when its validity window has closed.",
  },
  {
    audience: "Trust governance discussion",
    title: "Revoked issuer state blocks before payload trust",
    scenario: "revoked",
    compareScenario: "valid",
    nonceMode: "fixed",
    summary:
      "Use the same payload shape but withdraw issuer trust to show that governance state can terminate the scan before destination checks matter.",
    actor: "Policy owner, maintainer, or technical reviewer",
    environment: "Issuer state changed after issuance",
    threat: "A previously valid issuer remains trusted after explicit revocation.",
    lesson:
      "Issuer legitimacy is not static. Governance state must be able to remove trust even when the payload itself has not changed.",
  },
  {
    audience: "Policy modeling",
    title: "Subdomain policy as an explicit binding rule",
    scenario: "subdomain-allowed",
    compareScenario: "subdomain-blocked",
    nonceMode: "fixed",
    summary:
      "Show the same subdomain payload under two different issuer policies so the reader can see that destination binding is a governed rule, not a string coincidence.",
    actor: "Developer, verifier maintainer, or reviewer",
    environment: "Merchant or platform deciding whether subdomains inherit trust",
    threat: "A subdomain is accepted or rejected implicitly instead of by policy.",
    lesson:
      "Destination binding depends on explicit policy. The verifier should treat subdomain trust as a controlled decision, not a default assumption.",
  },
  {
    audience: "Terminal policy discussion",
    title: "Payload mismatch as a decisive block condition",
    scenario: "payload-mismatch",
    compareScenario: "valid",
    nonceMode: "fixed",
    summary:
      "Use a signed envelope whose destination falls outside the issuer-approved set to make terminal binding failure visible to the reader.",
    actor: "Security reviewer or implementation engineer",
    environment: "Observed destination drifts away from the approved payload policy",
    threat: "A QR remains trusted even after the endpoint no longer matches issuer-approved destinations.",
    lesson:
      "Binding failure should outrank softer trust signals. Once the observed endpoint is outside policy, the scan should block.",
  },
  {
    audience: "Short URL and resolver policy",
    title: "Resolver flow must prove the final destination",
    scenario: "redirect-approved",
    compareScenario: "redirect-final-mismatch",
    nonceMode: "fixed",
    summary:
      "Use an enrolled resolver twice: once when it resolves to the approved final destination, and once when it resolves to a different host.",
    actor: "Verifier maintainer, professor, or review committee",
    environment: "Public QR uses a managed resolver or short-link layer before the final website.",
    threat: "A scanner treats a trusted resolver as enough proof even when the final hop changes.",
    lesson:
      "Resolver trust is conditional. The scanner needs resolver identity, final destination, and redirect policy before it can show a positive state.",
  },
  {
    audience: "Governance freshness review",
    title: "Stale verifier cache must not preserve a green badge",
    scenario: "stale-cache",
    compareScenario: "valid",
    nonceMode: "fixed",
    summary:
      "Use the same clean destination with stale synchronized trust state to show why cache freshness is part of the scanner decision.",
    actor: "Verifier operator, professor, or review committee",
    environment: "Scanner has an old local trust cache and cannot prove that required state is still fresh.",
    threat: "A verifier keeps showing a positive trust badge after required issuer or policy state has aged past its freshness rule.",
    lesson:
      "Cached trust can support offline validation only inside explicit freshness windows. Stale required state must downgrade or block.",
  },
] as const

export const scenarioIllustrationMap: Record<LearnScenarioKey, ScenarioIllustration> = {
  valid: {
    title: "All technical controls align on the first pass",
    layers: [
      {
        title: "Issuer legitimacy",
        value: "Active",
        tone: "success",
        note: "The issuer state remains trusted and not revoked.",
      },
      {
        title: "Destination binding",
        value: "Bound",
        tone: "success",
        note: "The payload resolves to an issuer-approved destination.",
      },
      {
        title: "Freshness and replay",
        value: "Fresh",
        tone: "success",
        note: "The envelope is within its validity window and the first nonce pass is accepted.",
      },
      {
        title: "Verifier state",
        value: "Accepted",
        tone: "success",
        note: "This is the positive control for the working technical lab.",
      },
    ],
  },
  expired: {
    title: "Time window failure blocks a well-formed scan",
    layers: [
      {
        title: "Issuer legitimacy",
        value: "Active",
        tone: "success",
        note: "The issuer itself is still trusted.",
      },
      {
        title: "Destination binding",
        value: "Bound",
        tone: "success",
        note: "The destination still matches policy.",
      },
      {
        title: "Freshness and replay",
        value: "Expired",
        tone: "blocked",
        note: "The verifier rejects the envelope because its validity window has already closed.",
      },
      {
        title: "Verifier state",
        value: "Blocked",
        tone: "blocked",
        note: "Freshness failure terminates the decision path early.",
      },
    ],
  },
  revoked: {
    title: "Governance state withdraws trust",
    layers: [
      {
        title: "Issuer legitimacy",
        value: "Revoked",
        tone: "blocked",
        note: "Issuer trust has been explicitly withdrawn.",
      },
      {
        title: "Destination binding",
        value: "Secondary",
        tone: "neutral",
        note: "Destination agreement no longer controls the outcome.",
      },
      {
        title: "Freshness and replay",
        value: "Secondary",
        tone: "neutral",
        note: "Replay and validity checks are not what decides the case.",
      },
      {
        title: "Verifier state",
        value: "Blocked",
        tone: "blocked",
        note: "Issuer revocation terminates trust before payload acceptance.",
      },
    ],
  },
  "subdomain-allowed": {
    title: "Policy explicitly allows the subdomain",
    layers: [
      {
        title: "Issuer legitimacy",
        value: "Active",
        tone: "success",
        note: "Issuer state remains trusted.",
      },
      {
        title: "Destination binding",
        value: "Allowed",
        tone: "success",
        note: "Policy says this subdomain is still inside the approved destination set.",
      },
      {
        title: "Freshness and replay",
        value: "Fresh",
        tone: "success",
        note: "No freshness or replay failure is introduced.",
      },
      {
        title: "Verifier state",
        value: "Accepted",
        tone: "success",
        note: "This case proves the binding rule is policy-driven, not lexical accident.",
      },
    ],
  },
  "subdomain-blocked": {
    title: "The same subdomain fails under stricter policy",
    layers: [
      {
        title: "Issuer legitimacy",
        value: "Active",
        tone: "success",
        note: "Issuer state remains trusted.",
      },
      {
        title: "Destination binding",
        value: "Blocked",
        tone: "blocked",
        note: "Exact-host policy rejects the subdomain.",
      },
      {
        title: "Freshness and replay",
        value: "Secondary",
        tone: "neutral",
        note: "Freshness is not what determines the outcome.",
      },
      {
        title: "Verifier state",
        value: "Blocked",
        tone: "blocked",
        note: "The same payload becomes unacceptable when policy changes.",
      },
    ],
  },
  "payload-mismatch": {
    title: "Destination drift becomes a terminal block",
    layers: [
      {
        title: "Issuer legitimacy",
        value: "Active",
        tone: "success",
        note: "The issuer still looks legitimate.",
      },
      {
        title: "Destination binding",
        value: "Mismatch",
        tone: "blocked",
        note: "Observed destination falls outside the issuer-approved set.",
      },
      {
        title: "Freshness and replay",
        value: "Secondary",
        tone: "neutral",
        note: "Replay and freshness do not rescue a bad destination.",
      },
      {
        title: "Verifier state",
        value: "Blocked",
        tone: "blocked",
        note: "Binding failure outranks softer positive signals.",
      },
    ],
  },
  "redirect-approved": {
    title: "Resolver and final destination both satisfy policy",
    layers: [
      {
        title: "Issuer legitimacy",
        value: "Active",
        tone: "success",
        note: "The issuer state remains recognized and trusted.",
      },
      {
        title: "Resolver policy",
        value: "Bound",
        tone: "success",
        note: "The QR points to an enrolled resolver.",
      },
      {
        title: "Final destination",
        value: "Approved",
        tone: "success",
        note: "The resolver lands on the issuer-approved final URL within the hop limit.",
      },
      {
        title: "Verifier state",
        value: "Accepted",
        tone: "success",
        note: "The scanner can show the resolver and final target without reducing trust to the short URL.",
      },
    ],
  },
  "redirect-final-mismatch": {
    title: "Resolver trust fails when the final hop changes",
    layers: [
      {
        title: "Issuer legitimacy",
        value: "Active",
        tone: "success",
        note: "The issuer state remains recognized and trusted.",
      },
      {
        title: "Resolver policy",
        value: "Enrolled",
        tone: "success",
        note: "The resolver itself is recognized.",
      },
      {
        title: "Final destination",
        value: "Mismatch",
        tone: "blocked",
        note: "The final host leaves the issuer-approved redirect policy.",
      },
      {
        title: "Verifier state",
        value: "Blocked",
        tone: "blocked",
        note: "A trusted resolver does not authorize arbitrary final destinations.",
      },
    ],
  },
  "redirect-too-many-hops": {
    title: "Resolver chain exceeds the allowed hop policy",
    layers: [
      {
        title: "Issuer legitimacy",
        value: "Active",
        tone: "success",
        note: "The issuer state remains recognized and trusted.",
      },
      {
        title: "Resolver policy",
        value: "Enrolled",
        tone: "success",
        note: "The QR starts at an approved resolver.",
      },
      {
        title: "Redirect depth",
        value: "Too deep",
        tone: "blocked",
        note: "The observed redirect chain exceeds the issuer's maximum hop count.",
      },
      {
        title: "Verifier state",
        value: "Blocked",
        tone: "blocked",
        note: "The scanner refuses to treat an excessive chain as a clean destination binding.",
      },
    ],
  },
  "redirect-nested-shortener": {
    title: "Nested shorteners remain outside policy",
    layers: [
      {
        title: "Issuer legitimacy",
        value: "Active",
        tone: "success",
        note: "The issuer state remains recognized and trusted.",
      },
      {
        title: "Resolver policy",
        value: "Enrolled",
        tone: "success",
        note: "The first resolver is approved.",
      },
      {
        title: "Intermediate hop",
        value: "Nested",
        tone: "blocked",
        note: "The resolver path includes an unapproved shortener layer.",
      },
      {
        title: "Verifier state",
        value: "Blocked",
        tone: "blocked",
        note: "Nested shorteners are not allowed to produce a positive scanner state.",
      },
    ],
  },
  "runtime-risky": {
    title: "Runtime safety downgrades an otherwise valid QR",
    layers: [
      {
        title: "Issuer legitimacy",
        value: "Active",
        tone: "success",
        note: "The issuer state remains recognized and trusted.",
      },
      {
        title: "Destination binding",
        value: "Bound",
        tone: "success",
        note: "The destination remains inside the issuer-approved policy.",
      },
      {
        title: "Runtime safety",
        value: "Risky",
        tone: "warning",
        note: "A scan-time safety signal reports elevated risk after binding succeeds.",
      },
      {
        title: "Verifier state",
        value: "Caution",
        tone: "warning",
        note: "This is the paper's verified issuer, destination risky state.",
      },
    ],
  },
  "runtime-blocked": {
    title: "Runtime safety blocks a verified destination",
    layers: [
      {
        title: "Issuer legitimacy",
        value: "Active",
        tone: "success",
        note: "The issuer state remains recognized and trusted.",
      },
      {
        title: "Destination binding",
        value: "Bound",
        tone: "success",
        note: "The destination remains inside the issuer-approved policy.",
      },
      {
        title: "Runtime safety",
        value: "Blocked",
        tone: "blocked",
        note: "A high-confidence runtime signal prevents the destination from opening.",
      },
      {
        title: "Verifier state",
        value: "Blocked",
        tone: "blocked",
        note: "Runtime safety remains a separate terminal layer, not a signature failure.",
      },
    ],
  },
  "stale-cache": {
    title: "Stale cache downgrades an otherwise valid QR",
    layers: [
      {
        title: "Issuer legitimacy",
        value: "Known",
        tone: "warning",
        note: "The issuer namespace exists, but required synchronized trust state is stale.",
      },
      {
        title: "Destination binding",
        value: "Held",
        tone: "warning",
        note: "The destination would otherwise be issuer-approved, but stale state prevents a positive badge.",
      },
      {
        title: "Cache freshness",
        value: "Stale",
        tone: "warning",
        note: "The verifier cache exceeds its configured maximum staleness window.",
      },
      {
        title: "Verifier state",
        value: "Caution",
        tone: "warning",
        note: "The scanner downgrades instead of silently preserving verified issuer.",
      },
    ],
  },
  "unknown-issuer": {
    title: "A valid signature without an enrolled issuer stays cautious",
    layers: [
      {
        title: "Issuer legitimacy",
        value: "Unknown",
        tone: "warning",
        note: "No trust record exists for the certificate, so legitimacy cannot be established.",
      },
      {
        title: "Destination binding",
        value: "Unknown",
        tone: "neutral",
        note: "Without an enrolled issuer policy, the destination cannot be checked against an approved set.",
      },
      {
        title: "Freshness and replay",
        value: "Intact",
        tone: "neutral",
        note: "The envelope verifies cryptographically, but signature validity alone cannot produce a positive badge.",
      },
      {
        title: "Verifier state",
        value: "Caution",
        tone: "warning",
        note: "The scanner stops at signed-unknown-issuer instead of inventing a positive state.",
      },
    ],
  },
  "artifact-quiet-zone": {
    title: "A tampered print downgrades an otherwise verified scan",
    layers: [
      {
        title: "Issuer legitimacy",
        value: "Active",
        tone: "success",
        note: "The signed payload still traces to an enrolled, trusted issuer.",
      },
      {
        title: "Destination binding",
        value: "Bound",
        tone: "success",
        note: "The payload resolves to an issuer-approved destination.",
      },
      {
        title: "Artifact integrity",
        value: "Suspicious",
        tone: "warning",
        note: "The scanned image is missing its quiet zone, a visual sign the print was altered.",
      },
      {
        title: "Verifier state",
        value: "Caution",
        tone: "warning",
        note: "Cryptographic validity cannot outrank physical tampering evidence; the badge downgrades.",
      },
    ],
  },
  "artifact-mismatch": {
    title: "The printed code and the claimed payload disagree",
    layers: [
      {
        title: "Issuer legitimacy",
        value: "Not evaluated",
        tone: "neutral",
        note: "Issuer checks are skipped because the artifact itself failed first.",
      },
      {
        title: "Destination binding",
        value: "Not evaluated",
        tone: "neutral",
        note: "Destination policy cannot rescue a scan whose artifact is untrustworthy.",
      },
      {
        title: "Artifact integrity",
        value: "Mismatch",
        tone: "blocked",
        note: "The QR image decodes to a different payload than the one submitted, the signature of a sticker overlay.",
      },
      {
        title: "Verifier state",
        value: "Blocked",
        tone: "blocked",
        note: "Artifact mismatch is decisive: the scan blocks before any trust signal is considered.",
      },
    ],
  },
}

export function buildLabLink(
  scenario: LearnScenarioKey,
  nonceMode: "fixed" | "timestamped" = "fixed",
  usagePolicy: "reusable_public" | "one_time" | "time_limited" = "reusable_public",
) {
  const params = new URLSearchParams({
    scenario,
    nonce: nonceMode,
    usage: usagePolicy,
    autogenerate: "1",
  })

  return `/lab?${params.toString()}`
}

export function buildLearnTrackLink(
  track: LessonTrackKey,
  step = 0,
) {
  const params = new URLSearchParams({
    track,
    step: String(step),
  })

  return `/learn?${params.toString()}#teaching-tracks`
}

export function buildOperatorLink(options?: {
  focus?: OperatorFocus
  source?: string
  scenario?: LearnScenarioKey
  compareScenario?: LearnScenarioKey
  nonceMode?: "fixed" | "timestamped"
}) {
  const params = new URLSearchParams()

  if (options?.focus) params.set("focus", options.focus)
  if (options?.source) params.set("source", options.source)
  if (options?.scenario) params.set("scenario", options.scenario)
  if (options?.compareScenario) params.set("compare", options.compareScenario)
  if (options?.nonceMode) params.set("nonce", options.nonceMode)

  const search = params.toString()
  return `/operator${search ? `?${search}` : ""}`
}

export function resolveLessonTrackComparisonPair(
  track: LessonTrack,
): LessonTrackComparisonPair {
  const candidate =
    [...track.steps]
      .reverse()
      .find((step) => step.scenario && step.compareScenario) ??
    track.steps.find((step) => step.scenario && step.compareScenario)

  return {
    scenario: candidate?.scenario ?? "payload-mismatch",
    compareScenario: candidate?.compareScenario ?? "valid",
    nonceMode: candidate?.nonceMode ?? "fixed",
  }
}

export function lookupUseCaseForScenario(
  scenario: LearnScenarioKey,
): PublicUseCase | null {
  return publicUseCases.find((item) => item.scenario === scenario) ?? null
}
