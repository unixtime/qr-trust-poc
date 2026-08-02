import { lazy, Suspense, useSyncExternalStore } from "react"

import AppShell from "@/app/AppShell"

const FlowPage = lazy(() => import("@/routes/lab/FlowPage"))
const OperatorPage = lazy(() => import("@/routes/operator/OperatorPage"))
const AboutPage = lazy(() => import("@/routes/about/AboutPage"))

type AppRoute = "lab" | "operator" | "about" | "not-found"

function routeFromPath(pathname: string): AppRoute {
  if (pathname === "/") return "lab"
  if (pathname === "/operator") return "operator"
  if (pathname === "/about") {
    return "about"
  }
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
    <div className="mx-auto w-full max-w-2xl px-4 py-16 md:px-6">
      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
        Route not found
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        There is no page at this address.
      </h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        The guided workflow lives at{" "}
        <span className="font-medium text-foreground">/</span>, the operator
        console at{" "}
        <span className="font-medium text-foreground">/operator</span>, and
        the project overview at{" "}
        <span className="font-medium text-foreground">/about</span>.
      </p>
      <div className="mt-6">
        <button
          type="button"
          data-testid="not-found-open-workflow"
          onClick={() => onNavigate("/")}
          className="rounded-md border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
        >
          Go to the workflow
        </button>
      </div>
    </div>
  )
}

function RouteLoadingFallback() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-16 md:px-6">
      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
        Loading
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        Preparing this page.
      </h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        Each route loads as its own chunk, so the first visit to a page can
        take a moment.
      </p>
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
    page = <FlowPage key={`lab${routeSearch}`} onNavigate={navigate} />
  } else if (route === "operator") {
    page = <OperatorPage key={`operator${routeSearch}`} onNavigate={navigate} />
  } else if (route === "about") {
    page = <AboutPage key={`about${routeSearch}`} onNavigate={navigate} />
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
