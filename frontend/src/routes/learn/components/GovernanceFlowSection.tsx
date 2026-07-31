import { useMemo, useState } from "react"
import {
  ArrowRight,
  BadgeCheck,
  ChevronDown,
  GitBranch,
  Radar,
  ShieldCheck,
} from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { governanceFlow } from "@/routes/learn/content"

import GovernanceMapDiagram from "./GovernanceMapDiagram"

const governancePhases: Array<{
  label: string
  nodeIndexes: number[]
  summary: string
}> = [
  {
    label: "Governance",
    nodeIndexes: [0, 1, 2],
    summary:
      "Institutional actors decide who is allowed to issue, under what rules, and with what delegated authority.",
  },
  {
    label: "State publication",
    nodeIndexes: [3],
    summary:
      "The governed system becomes machine-readable only when manifests, revocations, and freshness state are published and signed.",
  },
  {
    label: "Synchronization and validation",
    nodeIndexes: [4, 5],
    summary:
      "The scanner or verifier consumes cached trust state and combines it with the QR artifact at scan time.",
  },
] as const

const decisionPathLabels = ["Chain", "Issuer", "Destination", "Runtime"] as const
const decisionPathIcons = [GitBranch, BadgeCheck, ShieldCheck, Radar] as const

const selectedNodeExplanations: Record<
  string,
  {
    dependsOn: string
    meaning: string
    scannerImpact: string
  }
> = {
  "Root keys": {
    dependsOn: "Published root material and rotation policy",
    meaning:
      "The verifier needs an anchor before it can decide whether any downstream issuer belongs to the trust program.",
    scannerImpact:
      "Without this anchor, the scanner should not upgrade a QR into a trusted state.",
  },
  "Accreditation rules": {
    dependsOn: "Program criteria for who may operate or issue",
    meaning:
      "Rules define what counts as a valid participant instead of leaving legitimacy to branding or domain names.",
    scannerImpact:
      "The scanner can distinguish no trust signal from an accepted trust signal.",
  },
  "Delegation policy": {
    dependsOn: "Bounded authority from the root to operators",
    meaning:
      "Delegation decides who can enroll issuers and what authority they are allowed to pass on.",
    scannerImpact:
      "A valid signature is not enough if the signer is outside the delegated scope.",
  },
  "Distribution endpoints": {
    dependsOn: "Stable locations for trust-state publication",
    meaning:
      "Verifiers need predictable endpoints to fetch manifests, revocations, freshness data, and policy changes.",
    scannerImpact:
      "If state cannot be reached or refreshed, the user should see a weaker decision.",
  },
  "Payment operator tree": {
    dependsOn: "Operator-specific governance path",
    meaning:
      "Payment QR trust can be delegated through a specialized authority without making every issuer globally trusted.",
    scannerImpact:
      "The verifier can scope a merchant QR to the payment program that enrolled it.",
  },
  "Government tree": {
    dependsOn: "Public-sector delegation and policy rules",
    meaning:
      "Government services can publish their own controlled trust path without sharing issuer namespaces with commerce.",
    scannerImpact:
      "A scanner can avoid treating unrelated institutional identifiers as interchangeable.",
  },
  "Merchant and enterprise tree": {
    dependsOn: "Enterprise enrollment rules and delegated issuer namespaces",
    meaning:
      "Enterprise QR codes need an accountable issuer path that survives departments, campaigns, and vendor changes.",
    scannerImpact:
      "The decision can remain tied to the enrolled organization, not just the visible domain.",
  },
  "Issuer identifier": {
    dependsOn: "Root, authority, and issuer namespace",
    meaning:
      "The identifier must be scoped so one root cannot accidentally satisfy another root's issuer record.",
    scannerImpact:
      "The scanner avoids false confidence from bare or reused issuer names.",
  },
  "Assurance tier": {
    dependsOn: "Enrollment evidence and issuer verification level",
    meaning:
      "The tier communicates how strongly the issuer was checked without replacing the final scan decision.",
    scannerImpact:
      "The scanner can show issuer assurance as detail while keeping safety as a separate state.",
  },
  "Key references": {
    dependsOn: "Issuer keys and key rotation metadata",
    meaning:
      "The verifier needs current key references to validate signed claims and reject stale signing material.",
    scannerImpact:
      "A QR signed with an unknown or retired key should not be treated as verified.",
  },
  "Approved domains, resolvers, or apps": {
    dependsOn: "Issuer-published destination policy",
    meaning:
      "This is the binding rule that says where the QR is allowed to send the user.",
    scannerImpact:
      "A trusted issuer can still produce a warning if the destination leaves the approved set.",
  },
  "Delegation manifests": {
    dependsOn: "Signed operator state",
    meaning:
      "Manifests make delegation machine-readable so verifiers can reconstruct the trust path.",
    scannerImpact:
      "The scanner can explain which authority chain recognized the issuer.",
  },
  "Issuer manifests": {
    dependsOn: "Signed issuer enrollment and policy state",
    meaning:
      "Issuer manifests publish the current issuer status, assurance, keys, and approved destination rules.",
    scannerImpact:
      "The scanner can decide whether the issuer is still recognized at scan time.",
  },
  "Destination policy updates": {
    dependsOn: "Signed changes to approved domains, resolvers, or apps",
    meaning:
      "Policies must change without forcing old QR payloads to be reprinted for every operational adjustment.",
    scannerImpact:
      "The scanner checks current approval instead of trusting the original payload forever.",
  },
  "Revocation and freshness metadata": {
    dependsOn: "Current status and expiry signals",
    meaning:
      "Freshness prevents a previously valid issuer or policy from remaining trusted after revocation or expiry.",
    scannerImpact:
      "The scanner can downgrade or block stale trust state.",
  },
  "Root and operator state": {
    dependsOn: "Fetched and verified upstream trust records",
    meaning:
      "The cache keeps root and operator data available at scan time without making every scan a live governance fetch.",
    scannerImpact:
      "The scanner can work quickly while still respecting bounded freshness.",
  },
  "Issuer state": {
    dependsOn: "Current issuer manifest and revocation status",
    meaning:
      "Issuer state tells the verifier whether the organization is still enrolled and what keys and policies apply.",
    scannerImpact:
      "The scanner can separate a recognized issuer from an unknown or revoked issuer.",
  },
  "Destination policy state": {
    dependsOn: "Cached approved destination rules",
    meaning:
      "This state is checked against the actual QR destination, resolver output, or app intent.",
    scannerImpact:
      "The scanner can flag destination drift even when the issuer is legitimate.",
  },
  "Revocation and freshness state": {
    dependsOn: "Recent revocation lists, status records, and cache expiry",
    meaning:
      "The verifier needs bounded staleness so old trust data does not silently survive current policy changes.",
    scannerImpact:
      "The scanner can show caution or block when the trust state is too old.",
  },
  "Validate root → authority → issuer chain": {
    dependsOn: "Root trust program, delegated authority, and issuer enrollment",
    meaning:
      "The verifier reconstructs the chain before it treats the issuer as recognized.",
    scannerImpact:
      "The user sees unknown issuer instead of verified issuer when the chain does not resolve.",
  },
  "Validate issuer status and tier": {
    dependsOn: "Issuer manifest, revocation state, and assurance tier",
    meaning:
      "The verifier checks that the issuer is active and records the strength of issuer assurance.",
    scannerImpact:
      "Assurance can be shown as detail, but it does not override destination or safety failures.",
  },
  "Validate current destination policy": {
    dependsOn: "QR payload, resolver output, and issuer-approved destination rules",
    meaning:
      "The verifier compares the present destination to policy, not just to the signed bytes.",
    scannerImpact:
      "A destination mismatch becomes visible before the user opens the link.",
  },
  "Check runtime safety and apply local policy": {
    dependsOn: "Present-time reputation, malware, phishing, redirect, and local policy signals",
    meaning:
      "Runtime safety handles threats that are not solved by issuer legitimacy or destination binding alone.",
    scannerImpact:
      "The scanner can warn or block even when issuer and destination checks pass.",
  },
}

function DecisionPathFlowchart({ items }: { items: readonly string[] }) {
  const [expandedItem, setExpandedItem] = useState(items[0] ?? "")
  const visibleExpandedItem =
    expandedItem === "" || items.includes(expandedItem)
      ? expandedItem
      : (items[0] ?? "")

  return (
    <div className="mt-5 rounded-[24px] border border-emerald-900/10 bg-[radial-gradient(circle_at_18%_12%,rgba(16,185,129,0.16),transparent_30%),linear-gradient(135deg,rgba(236,193,110,0.12),rgba(16,185,129,0.08)_48%,rgba(255,255,255,0.72))] p-4">
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_32px_minmax(0,1fr)_32px_minmax(0,1fr)_32px_minmax(0,1fr)] xl:items-center">
        {items.map((item, index) => {
          const Icon = decisionPathIcons[index] ?? ShieldCheck
          const expanded = visibleExpandedItem === item
          const explanation =
            selectedNodeExplanations[item] ??
            selectedNodeExplanations["Validate root → authority → issuer chain"]

          return (
            <div key={item} className="contents">
              <article
                className={[
                  "overflow-hidden rounded-[20px] border bg-card/86 shadow-[0_18px_44px_rgba(22,29,24,0.08)] transition-[border-color,box-shadow]",
                  expanded
                    ? "border-emerald-900/20"
                    : "border-emerald-950/10",
                ].join(" ")}
              >
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setExpandedItem(expanded ? "" : item)}
                  className="flex h-full w-full flex-col p-4 text-left"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="inline-flex items-center gap-2 rounded-full border border-emerald-900/10 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-900">
                      <Icon className="size-3.5" />
                      {decisionPathLabels[index] ?? `Step ${index + 1}`}
                    </div>
                    <span className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                      0{index + 1}
                      <ChevronDown
                        aria-hidden="true"
                        className={[
                          "size-3.5 transition-transform",
                          expanded ? "rotate-180" : "",
                        ].join(" ")}
                      />
                    </span>
                  </div>
                  <p className="mt-4 text-sm font-medium leading-6 text-foreground">
                    {item}
                  </p>
                </button>

                {expanded ? (
                  <div className="border-t border-emerald-950/10 px-4 pb-4 pt-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-950/70">
                      Why this step matters
                    </p>
                    <p className="mt-2 text-sm leading-6 text-foreground/78">
                      {explanation.meaning}
                    </p>
                    <p className="mt-3 text-sm leading-6 text-muted-foreground">
                      {explanation.scannerImpact}
                    </p>
                  </div>
                ) : null}
              </article>

              {index < items.length - 1 ? (
                <div className="hidden justify-center text-emerald-900/55 xl:flex">
                  <ArrowRight className="size-5" />
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      <div className="mt-4 rounded-[20px] border border-stone-950/10 bg-[#101712] p-4 text-stone-50">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-100/70">
          Terminal output
        </div>
        <p className="mt-2 text-sm leading-6 text-stone-200">
          Only after all four checks complete can the scanner emit a user-visible
          trust state such as accepted, warning, or blocked.
        </p>
      </div>
    </div>
  )
}

function SelectedNodeItems({
  title,
  items,
}: {
  title: string
  items: readonly string[]
}) {
  const [expandedItem, setExpandedItem] = useState(items[0] ?? "")
  const visibleExpandedItem =
    expandedItem === "" || items.includes(expandedItem)
      ? expandedItem
      : (items[0] ?? "")

  if (title === "Verifier decision path") {
    return <DecisionPathFlowchart items={items} />
  }

  return (
    <>
      <div className="mt-5 rounded-[22px] border border-emerald-900/10 bg-emerald-500/8 p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-950/72">
              Tap-to-expand dependency map
            </p>
            <p className="mt-1 text-sm leading-6 text-foreground/78">
              Each row explains what must exist upstream and how that changes
              the scanner-visible trust state.
            </p>
          </div>
          <span className="w-fit rounded-full border border-emerald-900/10 bg-card px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-emerald-950/72">
            {visibleExpandedItem ? `${visibleExpandedItem} open` : "Choose a row"}
          </span>
        </div>
      </div>

      <div className="mt-3 grid gap-3">
        {items.map((item, index) => {
          const expanded = visibleExpandedItem === item
          const explanation =
            selectedNodeExplanations[item] ??
            selectedNodeExplanations["Root keys"]

          return (
            <article
              key={item}
              className={[
                "overflow-hidden rounded-[24px] border transition-[background-color,border-color,box-shadow]",
                expanded
                  ? "border-emerald-900/14 bg-card shadow-[0_18px_44px_rgba(22,29,24,0.08)]"
                  : "border-border/70 bg-background/78 hover:border-emerald-900/14 hover:bg-card/82",
              ].join(" ")}
            >
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setExpandedItem(expanded ? "" : item)}
                className="flex w-full items-center gap-4 p-4 text-left"
              >
                <span
                  className={[
                    "grid size-9 shrink-0 place-items-center rounded-full text-sm font-semibold ring-1",
                    expanded
                      ? "bg-emerald-700 text-white ring-emerald-700/20"
                      : "bg-background text-muted-foreground ring-border",
                  ].join(" ")}
                >
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-semibold tracking-[-0.02em] text-foreground">
                    {item}
                  </span>
                  <span className="mt-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Required input
                  </span>
                  <span className="mt-1 block text-sm leading-5 text-foreground/72">
                    {explanation.dependsOn}
                  </span>
                </span>
                <span
                  className={[
                    "hidden rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] sm:inline-flex",
                    expanded
                      ? "bg-emerald-700 text-white"
                      : "border border-border/70 bg-background/70 text-muted-foreground",
                  ].join(" ")}
                >
                  {expanded ? "Expanded" : "Expand"}
                </span>
                <ChevronDown
                  aria-hidden="true"
                  className={[
                    "size-4 shrink-0 text-muted-foreground transition-transform",
                    expanded ? "rotate-180" : "",
                  ].join(" ")}
                />
              </button>

              {expanded ? (
                <div className="border-t border-border/60 px-4 pb-4 pt-3">
                  <div className="grid gap-3 md:grid-cols-[0.9fr_1fr_1fr]">
                    <div className="rounded-[18px] border border-border/60 bg-background/70 p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        Required input
                      </p>
                      <p className="mt-2 text-sm leading-6 text-foreground/78">
                        {explanation.dependsOn}
                      </p>
                    </div>
                    <div className="rounded-[18px] border border-border/60 bg-background/70 p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        Model meaning
                      </p>
                      <p className="mt-2 text-sm leading-6 text-foreground/78">
                        {explanation.meaning}
                      </p>
                    </div>
                    <div className="rounded-[18px] border border-emerald-900/10 bg-emerald-500/8 p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-950/70">
                        Scanner impact
                      </p>
                      <p className="mt-2 text-sm leading-6 text-foreground/78">
                        {explanation.scannerImpact}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}
            </article>
          )
        })}
      </div>
    </>
  )
}

export default function GovernanceFlowSection() {
  const [activeIndex, setActiveIndex] = useState(0)

  const activeStage = governanceFlow[activeIndex] ?? governanceFlow[0]
  const activePhase = useMemo(
    () =>
      governancePhases.find((phase) => phase.nodeIndexes.includes(activeIndex)) ??
      governancePhases[0],
    [activeIndex],
  )

  return (
    <section id="governance-flow" className="grid gap-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Figure 2 · Governance and validation flow
          </p>
          <h2 className="mt-2 font-serif text-4xl leading-[0.96] tracking-[-0.05em] text-foreground md:text-5xl">
            How shared trust state reaches the verifier
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-muted-foreground">
            This surface translates the paper’s governance figure into an
            interactive flow. Select any node to see what it contributes to the
            system and how it affects scan-time trust decisions.
          </p>
        </div>
        <Card className="max-w-md rounded-[24px] border-border/70 bg-background/78 shadow-none">
          <CardContent className="p-4 text-sm leading-6 text-muted-foreground">
            The QR artifact is only one input. The more important teaching point
            is that trust depends on an upstream chain of governance,
            publication, caching, and validation.
          </CardContent>
        </Card>
      </div>

      <GovernanceMapDiagram
        activeIndex={activeIndex}
        activePhaseLabel={activePhase.label}
        onSelectStage={setActiveIndex}
        stages={governanceFlow}
      />

      <div className="grid gap-6 xl:grid-cols-[1.05fr,0.95fr]">
        <section className="rounded-[28px] border border-border/70 bg-card/92 p-5">
          <div className="mb-5 flex flex-wrap gap-2">
            {governancePhases.map((phase) => {
              const active = phase.nodeIndexes.includes(activeIndex)

              return (
                <button
                  key={phase.label}
                  type="button"
                  aria-label={`Show ${phase.label} phase`}
                  aria-pressed={active}
                  onClick={() => setActiveIndex(phase.nodeIndexes[0] ?? 0)}
                  className={[
                    "inline-flex rounded-full px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.14em] transition",
                    active
                      ? "bg-foreground text-background"
                      : "border border-border/70 bg-background text-muted-foreground hover:bg-card hover:text-foreground",
                  ].join(" ")}
                >
                  {phase.label}
                </button>
              )
            })}
          </div>

          <div className="space-y-4">
            {governanceFlow.map((stage, index) => {
              const active = index === activeIndex
              const complete = index < activeIndex

              return (
                <div key={stage.title} className="relative pl-12">
                  {index < governanceFlow.length - 1 ? (
                    <span
                      className={[
                        "absolute left-[17px] top-10 h-[calc(100%+0.75rem)] w-px transition-colors",
                        index < activeIndex ? "bg-foreground/35" : "bg-border",
                      ].join(" ")}
                    />
                  ) : null}

                  <button
                    type="button"
                    aria-label={`Show governance node ${index + 1}: ${stage.title}`}
                    aria-pressed={active}
                    onClick={() => setActiveIndex(index)}
                    className={[
                      "relative block w-full rounded-[24px] border px-5 py-5 text-left transition",
                      active
                        ? "border-foreground/15 bg-card shadow-[0_18px_40px_rgba(22,29,24,0.08)]"
                        : "border-border/70 bg-background/82 hover:bg-card",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "absolute left-[-48px] top-5 inline-flex size-9 items-center justify-center rounded-full text-sm font-semibold ring-1 transition",
                        active
                          ? "bg-foreground text-background ring-foreground/15 shadow-[0_0_0_8px_rgba(24,31,27,0.06)]"
                          : complete
                            ? "bg-foreground/10 text-foreground ring-foreground/10"
                            : "bg-background text-muted-foreground ring-border",
                      ].join(" ")}
                    >
                      {index + 1}
                    </span>
                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                      {governancePhases.find((phase) => phase.nodeIndexes.includes(index))?.label}
                    </p>
                    <h3 className="mt-2 font-serif text-3xl leading-tight tracking-[-0.04em] text-foreground">
                      {stage.title}
                    </h3>
                    <ul className="mt-4 space-y-3 text-sm leading-6 text-muted-foreground">
                      {stage.items.map((item) => (
                        <li key={item} className="flex gap-3">
                          <span
                            className={[
                              "mt-2 size-1.5 rounded-full transition",
                              active ? "bg-foreground" : "bg-muted-foreground/50",
                            ].join(" ")}
                          />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </button>
                </div>
              )
            })}
          </div>
        </section>

        <section className="space-y-4">
          <Card className="rounded-[24px] border-emerald-900/10 bg-emerald-500/8 shadow-none">
            <CardContent className="p-5">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Active phase
              </p>
              <h3 className="mt-2 font-serif text-3xl leading-tight tracking-[-0.04em] text-foreground">
                {activePhase.label}
              </h3>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {activePhase.summary}
              </p>
            </CardContent>
          </Card>

          <Card className="rounded-[24px] border-border/70 bg-card/90 shadow-none">
            <CardContent className="p-5">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Selected node
              </p>
              <h3 className="mt-2 font-serif text-3xl leading-tight tracking-[-0.04em] text-foreground">
                {activeStage.title}
              </h3>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                This node is currently emphasized in the flow diagram. Use it to
                explain what information must exist before the scanner can emit a
                meaningful trust state. Open the dependency rows to connect the
                paper model to the scanner-visible outcome.
              </p>
              <SelectedNodeItems title={activeStage.title} items={activeStage.items} />
            </CardContent>
          </Card>

          <Card className="rounded-[24px] border-border/70 bg-background/78 shadow-none">
            <CardContent className="p-5">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Critical semantic rule
              </p>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                The QR artifact is a scan-time input. It is not the same thing as
                cached trust state. The verifier’s decision depends on both the
                artifact and the upstream shared-state system.
              </p>
            </CardContent>
          </Card>
        </section>
      </div>
    </section>
  )
}
