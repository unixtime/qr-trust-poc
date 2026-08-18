import { lazy, Suspense, useSyncExternalStore } from "react"

import AppShell from "@/app/AppShell"
import { Eyebrow } from "@/components/ui/eyebrow"
import { useLocale, useT } from "@/i18n"
import { useTNodes } from "@/i18n/nodes"

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

/** The route paths in the 404 copy: literal, and so never translated. */
function RoutePath({ path }: { path: string }) {
  return <span className="font-medium text-foreground">{path}</span>
}

function NotFoundPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const t = useT()
  const tNodes = useTNodes()

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-16 md:px-6">
      <Eyebrow as="p">{t("app.notFound.eyebrow")}</Eyebrow>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        {t("app.notFound.title")}
      </h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        {/* One message with three slots rather than four hard-coded fragments
            around three spans. Spanish orders these clauses differently, and
            a sentence assembled from English-ordered pieces cannot be
            reordered by a translator. */}
        {tNodes("app.notFound.body", {
          workflow: <RoutePath path="/" />,
          operator: <RoutePath path="/operator" />,
          about: <RoutePath path="/about" />,
        })}
      </p>
      <div className="mt-6">
        <button
          type="button"
          data-testid="not-found-open-workflow"
          onClick={() => onNavigate("/")}
          className="rounded-md border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-muted"
        >
          {t("app.notFound.cta")}
        </button>
      </div>
    </div>
  )
}

function RouteLoadingFallback() {
  const t = useT()

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-16 md:px-6">
      <Eyebrow as="p">{t("app.loading.eyebrow")}</Eyebrow>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        {t("app.loading.title")}
      </h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        {t("app.loading.body")}
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

  // Subscribed at the root, and deliberately not folded into the route keys
  // below. Much of the copy in the lazy routes comes from module-level tables
  // read through the plain `t()`, which no component subscribes to; a root
  // subscription re-renders the whole tree so those tables are re-evaluated.
  // Keying on it instead would remount the routes and throw away the
  // scenario, the generated QR, and every other in-flight choice — switching
  // language should change the words, not restart the demo.
  useLocale()

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
