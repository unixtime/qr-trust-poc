import { lazy, Suspense, useSyncExternalStore } from "react"

import AppShell from "@/app/AppShell"

const LabPage = lazy(() => import("@/routes/lab/LabPage"))
const LearnPage = lazy(() => import("@/routes/learn/LearnPage"))
const OperatorPage = lazy(() => import("@/routes/operator/OperatorPage"))

type AppRoute = "lab" | "learn" | "operator" | "not-found"

function routeFromPath(pathname: string): AppRoute {
  if (pathname === "/" || pathname === "/lab") return "lab"
  if (pathname === "/learn") return "learn"
  if (pathname === "/operator") return "operator"
  return "not-found"
}

function subscribeToLocation(onStoreChange: () => void) {
  window.addEventListener("popstate", onStoreChange)
  return () => {
    window.removeEventListener("popstate", onStoreChange)
  }
}

function getLocationSnapshot() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

function getServerSnapshot() {
  return "/"
}

function pathnameFromLocationSnapshot(snapshot: string) {
  const queryIndex = snapshot.indexOf("?")
  const hashIndex = snapshot.indexOf("#")
  const endIndex =
    queryIndex === -1
      ? hashIndex === -1
        ? snapshot.length
        : hashIndex
      : hashIndex === -1
        ? queryIndex
        : Math.min(queryIndex, hashIndex)

  return snapshot.slice(0, endIndex) || "/"
}

function searchFromLocationSnapshot(snapshot: string) {
  const queryIndex = snapshot.indexOf("?")
  if (queryIndex === -1) return ""

  const hashIndex = snapshot.indexOf("#", queryIndex)
  return snapshot.slice(queryIndex, hashIndex === -1 ? undefined : hashIndex)
}

function currentBrowserLocationSnapshot() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

function normalizedNavigationTarget(path: string) {
  const url = new URL(path, window.location.origin)
  return `${url.pathname}${url.search}${url.hash}`
}

function NotFoundPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <div className="min-h-[calc(100vh-5rem)] px-4 py-6 md:px-6 xl:px-8">
      <div className="mx-auto grid max-w-4xl gap-4 rounded-[2rem] border border-border/70 bg-card/90 p-6 shadow-[0_18px_60px_rgba(22,29,24,0.08)] backdrop-blur md:p-8">
        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Route not found
        </div>
        <h1 className="font-serif text-4xl leading-[0.96] tracking-[-0.05em] text-foreground md:text-5xl">
          This frontend now expects route-based product modes.
        </h1>
        <p className="max-w-2xl text-base leading-7 text-muted-foreground">
          The working verifier demo lives at <span className="font-medium text-foreground">/lab</span>.
          Guided paper mode will live at <span className="font-medium text-foreground">/learn</span>,
          and the operator-focused split will live at{" "}
          <span className="font-medium text-foreground">/operator</span>.
        </p>
        <div>
          <button
            type="button"
            onClick={() => onNavigate("/lab")}
            className="rounded-xl border border-border/70 bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-card"
          >
            Go to the verifier lab
          </button>
        </div>
      </div>
    </div>
  )
}

function RouteLoadingFallback() {
  return (
    <div className="min-h-[calc(100vh-5rem)] px-4 py-6 md:px-6 xl:px-8">
      <div className="mx-auto grid max-w-4xl gap-4 rounded-[2rem] border border-border/70 bg-card/90 p-6 shadow-[0_18px_60px_rgba(22,29,24,0.08)] backdrop-blur md:p-8">
        <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Loading route
        </div>
        <h1 className="font-serif text-4xl leading-[0.96] tracking-[-0.05em] text-foreground md:text-5xl">
          Preparing the selected product mode.
        </h1>
        <p className="max-w-2xl text-base leading-7 text-muted-foreground">
          The app now splits the lab, learn, and operator routes into separate chunks so the initial load only pulls the route you actually open.
        </p>
      </div>
    </div>
  )
}

function App() {
  const locationSnapshot = useSyncExternalStore(
    subscribeToLocation,
    getLocationSnapshot,
    getServerSnapshot,
  )
  const pathname = pathnameFromLocationSnapshot(locationSnapshot)
  const routeSearch = searchFromLocationSnapshot(locationSnapshot)

  function navigate(nextPath: string) {
    const target = normalizedNavigationTarget(nextPath)
    if (currentBrowserLocationSnapshot() === target) return
    window.history.pushState({}, "", target)
    window.scrollTo({ top: 0, behavior: "smooth" })
    window.dispatchEvent(new PopStateEvent("popstate"))
  }

  const route = routeFromPath(pathname)

  let page
  if (route === "lab") {
    page = <LabPage key={`lab${routeSearch}`} />
  } else if (route === "learn") {
    page = <LearnPage key={`learn${routeSearch}`} onNavigate={navigate} />
  } else if (route === "operator") {
    page = <OperatorPage key={`operator${routeSearch}`} onNavigate={navigate} />
  } else {
    page = <NotFoundPage onNavigate={navigate} />
  }

  return (
    <AppShell activePath={pathname} onNavigate={navigate}>
      <Suspense fallback={<RouteLoadingFallback />}>{page}</Suspense>
    </AppShell>
  )
}

export default App
