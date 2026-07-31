import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
} from "react"
import {
  buildLabLink,
  learnModeHighlights,
  learnStages,
  lessonTracks,
  type LessonTrackKey,
} from "@/routes/learn/content"

import LearnIntroSection from "./components/LearnIntroSection"
import LearnRouteBoundarySection from "./components/LearnRouteBoundarySection"
import ProblemFramingSection from "./components/ProblemFramingSection"
import TrustArchitectureSection from "./components/TrustArchitectureSection"

const GovernanceFlowSection = lazy(() => import("./components/GovernanceFlowSection"))
const CaseStudySection = lazy(() => import("./components/CaseStudySection"))
const TeachingTracksSection = lazy(() => import("./components/TeachingTracksSection"))
const CommitteeReviewSection = lazy(() => import("./components/CommitteeReviewSection"))

type LearnPageProps = {
  onNavigate: (path: string) => void
}

const trackStorageKey = "qrcode-poc-learn-track"

type StoredTrackState = {
  key: LessonTrackKey
  stepIndex: number
}

function DeferredSectionFallback({
  label,
  detail,
}: {
  label: string
  detail: string
}) {
  return (
    <section className="rounded-[28px] border border-border/70 bg-card/88 p-6 shadow-[0_16px_40px_rgba(22,29,24,0.05)]">
      <div className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        Loading {label}
      </div>
      <p className="mt-3 max-w-3xl text-sm leading-7 text-muted-foreground">
        {detail}
      </p>
    </section>
  )
}

function isLessonTrackKey(value: string): value is LessonTrackKey {
  return value === "professor-seminar" || value === "reviewer-defense"
}

function parseTrackFromSearch(): StoredTrackState | null {
  if (typeof window === "undefined") return null

  const params = new URLSearchParams(window.location.search)
  const track = params.get("track")
  const step = params.get("step")

  if (!track || !isLessonTrackKey(track)) return null

  const parsedStep = Number.parseInt(step ?? "0", 10)
  return {
    key: track,
    stepIndex: Number.isFinite(parsedStep) ? Math.max(0, parsedStep) : 0,
  }
}

function LearnPage({ onNavigate }: LearnPageProps) {
  const [activeTrackKey, setActiveTrackKey] = useState<LessonTrackKey | null>(() => {
    const fromSearch = parseTrackFromSearch()
    if (fromSearch) return fromSearch.key

    if (typeof window === "undefined") return null

    try {
      const raw = window.sessionStorage.getItem(trackStorageKey)
      if (!raw) return null
      const parsed = JSON.parse(raw) as Partial<StoredTrackState>
      if (parsed.key && isLessonTrackKey(parsed.key)) {
        return parsed.key
      }
    } catch {
      return null
    }

    return null
  })
  const [activeTrackStepIndex, setActiveTrackStepIndex] = useState(() => {
    const fromSearch = parseTrackFromSearch()
    if (fromSearch) return fromSearch.stepIndex

    if (typeof window === "undefined") return 0

    try {
      const raw = window.sessionStorage.getItem(trackStorageKey)
      if (!raw) return 0
      const parsed = JSON.parse(raw) as Partial<StoredTrackState>
      if (typeof parsed.stepIndex === "number" && Number.isFinite(parsed.stepIndex)) {
        return Math.max(0, parsed.stepIndex)
      }
    } catch {
      return 0
    }

    return 0
  })

  const activeTrack = useMemo(
    () => (activeTrackKey ? lessonTracks[activeTrackKey] : null),
    [activeTrackKey],
  )

  useEffect(() => {
    if (typeof window === "undefined") return

    if (!activeTrackKey || !activeTrack) {
      window.sessionStorage.removeItem(trackStorageKey)
      const params = new URLSearchParams(window.location.search)
      params.delete("track")
      params.delete("step")
      const search = params.toString()
      window.history.replaceState(
        {},
        "",
        `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`,
      )
      return
    }

    const boundedIndex = Math.min(
      Math.max(0, activeTrackStepIndex),
      activeTrack.steps.length - 1,
    )
    window.sessionStorage.setItem(
      trackStorageKey,
      JSON.stringify({ key: activeTrackKey, stepIndex: boundedIndex }),
    )

    const params = new URLSearchParams(window.location.search)
    params.set("track", activeTrackKey)
    params.set("step", String(boundedIndex))
    const search = params.toString()
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}?${search}${window.location.hash}`,
    )
  }, [activeTrack, activeTrackKey, activeTrackStepIndex])

  function scrollToStage(stageKey: string) {
    const stage = learnStages.find((item) => item.key === stageKey)
    if (!stage) return

    const target = document.getElementById(stage.anchor)
    if (!target) return

    window.requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: "smooth", block: "start" })
    })
  }

  function goToTrackStep(trackKey: LessonTrackKey, stepIndex: number) {
    const track = lessonTracks[trackKey]
    const boundedIndex = Math.min(Math.max(0, stepIndex), track.steps.length - 1)
    const step = track.steps[boundedIndex]

    setActiveTrackKey(trackKey)
    setActiveTrackStepIndex(boundedIndex)

    if (step.stage === "lab") {
      onNavigate(buildLabLink(step.scenario ?? "valid", step.nonceMode ?? "fixed"))
      return
    }

    scrollToStage(step.stage)
  }

  function handleStartTrack(trackKey: LessonTrackKey) {
    goToTrackStep(trackKey, 0)
  }

  function handleContinueTrack() {
    if (!activeTrackKey || !activeTrack) return

    const nextIndex = Math.min(
      activeTrackStepIndex + 1,
      activeTrack.steps.length - 1,
    )
    goToTrackStep(activeTrackKey, nextIndex)
  }

  function handleGoToCurrentStep() {
    if (!activeTrackKey) return
    goToTrackStep(activeTrackKey, activeTrackStepIndex)
  }

  function handleClearTrack() {
    setActiveTrackKey(null)
    setActiveTrackStepIndex(0)
  }

  return (
    <div className="min-h-[calc(100vh-5rem)] px-4 py-6 md:px-6 xl:px-8">
      <div className="mx-auto grid max-w-6xl gap-6">
        <LearnIntroSection highlights={learnModeHighlights} />

        <ProblemFramingSection />

        <TrustArchitectureSection />

        <Suspense
          fallback={
            <DeferredSectionFallback
              label="governance flow"
              detail="Preparing the publication, delegation, and scan-time validation walkthrough."
            />
          }
        >
          <GovernanceFlowSection />
        </Suspense>

        <Suspense
          fallback={
            <DeferredSectionFallback
              label="case studies"
              detail="Preparing the implementation-backed scenarios that hand off into the working verifier lab."
            />
          }
        >
          <CaseStudySection onNavigate={onNavigate} />
        </Suspense>

        <Suspense
          fallback={
            <DeferredSectionFallback
              label="teaching tracks"
              detail="Preparing the reviewer and professor sequences that structure the guided walkthrough."
            />
          }
        >
          <TeachingTracksSection
            activeTrack={activeTrack}
            activeTrackStepIndex={activeTrackStepIndex}
            onStartTrack={handleStartTrack}
            onContinueTrack={handleContinueTrack}
            onGoToCurrentStep={handleGoToCurrentStep}
            onGoToTrackStep={goToTrackStep}
            onClearTrack={handleClearTrack}
          />
        </Suspense>

        <Suspense
          fallback={
            <DeferredSectionFallback
              label="committee handoff"
              detail="Preparing the printable comparison and review packet surfaces for committee-style evaluation."
            />
          }
        >
          <CommitteeReviewSection
            activeTrack={activeTrack}
            onNavigate={onNavigate}
          />
        </Suspense>

        <LearnRouteBoundarySection
          activeTrack={activeTrack}
          activeTrackStepIndex={activeTrackStepIndex}
          onNavigate={onNavigate}
        />
      </div>
    </div>
  )
}

export default LearnPage
