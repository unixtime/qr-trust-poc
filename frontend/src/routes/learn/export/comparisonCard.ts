import type {
  LearnScenarioKey,
  PublicUseCase,
  ScenarioIllustration,
} from "@/routes/learn/content"

import { downloadHtml, escapeHtml } from "./htmlDownload"

type ComparisonCardInput = {
  leftScenario: LearnScenarioKey
  rightScenario: LearnScenarioKey
  leftUseCase: PublicUseCase | null
  rightUseCase: PublicUseCase | null
  leftIllustration: ScenarioIllustration
  rightIllustration: ScenarioIllustration
  mostVisibleChangedLayer: string
  teachingPrompt: string
}

function toneStyles(tone: ScenarioIllustration["layers"][number]["tone"]) {
  if (tone === "success") {
    return { border: "#5a907f", background: "#e1f0e9" }
  }
  if (tone === "warning") {
    return { border: "#b57e2d", background: "#fbefdb" }
  }
  if (tone === "blocked") {
    return { border: "#a75a57", background: "#f8e3e1" }
  }
  return { border: "#b7afa0", background: "#f3eee5" }
}

function buildIllustrationGrid(illustration: ScenarioIllustration): string {
  return illustration.layers
    .map((layer) => {
      const tone = toneStyles(layer.tone)
      return `
        <section style="border:1px solid ${tone.border}; background:${tone.background}; border-radius:16px; padding:12px;">
          <div style="font-size:10px; letter-spacing:0.16em; text-transform:uppercase; color:#4e5c57; font-weight:700;">${escapeHtml(layer.title)}</div>
          <div style="margin-top:8px; font-size:18px; line-height:1.1; color:#17231d; font-family:Iowan Old Style, Palatino Linotype, Book Antiqua, Georgia, serif;">${escapeHtml(layer.value)}</div>
          <div style="margin-top:8px; font-size:12px; line-height:1.55; color:#36423d;">${escapeHtml(layer.note)}</div>
        </section>
      `
    })
    .join("")
}

export function buildComparisonCardHtml({
  leftScenario,
  rightScenario,
  leftUseCase,
  rightUseCase,
  leftIllustration,
  rightIllustration,
  mostVisibleChangedLayer,
  teachingPrompt,
}: ComparisonCardInput): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>QR Trust Comparison Card</title>
  </head>
  <body style="margin:0; background:#f6f0e6; color:#17231d; font-family:'Avenir Next','Segoe UI','SF Pro Text',system-ui,sans-serif;">
    <main style="max-width:1240px; margin:0 auto; padding:36px 28px 54px;">
      <section style="border:1px solid #d9d0c2; background:#fffaf2; border-radius:28px; padding:28px 30px; box-shadow:0 20px 56px rgba(23,35,29,0.08);">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
          <div style="font-size:11px; letter-spacing:0.18em; text-transform:uppercase; color:#496c62; font-weight:700;">QR trust comparison card</div>
          <div style="border:1px solid #d8c195; background:#f7ebd7; color:#8f5e16; padding:7px 12px; border-radius:999px; font-size:11px; letter-spacing:0.14em; text-transform:uppercase; font-weight:700;">Teaching and review artifact</div>
        </div>

        <h1 style="margin:14px 0 0; font-size:38px; line-height:1.08; font-family:Iowan Old Style, Palatino Linotype, Book Antiqua, Georgia, serif; font-weight:600;">${escapeHtml(leftScenario)} versus ${escapeHtml(rightScenario)}</h1>
        <p style="margin:14px 0 0; max-width:860px; font-size:16px; line-height:1.7; color:#36423d;">Use this card when you need a concise contrast between two verifier outcomes without reopening the entire application live.</p>

        <section style="margin-top:22px; display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px;">
          <div style="border:1px solid #ddd4c6; background:white; border-radius:18px; padding:16px;">
            <div style="font-size:11px; letter-spacing:0.16em; text-transform:uppercase; color:#5a655f; font-weight:700;">Most visible changed layer</div>
            <div style="margin-top:10px; font-size:20px; line-height:1.15; color:#17231d; font-family:Iowan Old Style, Palatino Linotype, Book Antiqua, Georgia, serif;">${escapeHtml(mostVisibleChangedLayer)}</div>
          </div>
          <div style="border:1px solid #eadcc7; background:#fff8ef; border-radius:18px; padding:16px;">
            <div style="font-size:11px; letter-spacing:0.16em; text-transform:uppercase; color:#8f5e16; font-weight:700;">Teaching prompt</div>
            <div style="margin-top:10px; font-size:14px; line-height:1.7; color:#37433f;">${escapeHtml(teachingPrompt)}</div>
          </div>
        </section>

        <section style="display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; margin-top:22px;">
          <article style="border:1px solid #ddd4c6; background:white; border-radius:22px; padding:18px;">
            <div style="font-size:11px; letter-spacing:0.16em; text-transform:uppercase; color:#5a655f; font-weight:700;">Primary case</div>
            <h2 style="margin:10px 0 0; font-size:26px; line-height:1.1; font-family:Iowan Old Style, Palatino Linotype, Book Antiqua, Georgia, serif; font-weight:600; color:#17231d;">${escapeHtml(leftUseCase?.title ?? leftScenario)}</h2>
            <p style="margin:10px 0 0; font-size:14px; line-height:1.7; color:#37433f;">${escapeHtml(leftUseCase?.summary ?? "")}</p>
            <div style="margin-top:16px; display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px;">${buildIllustrationGrid(leftIllustration)}</div>
          </article>
          <article style="border:1px solid #ddd4c6; background:white; border-radius:22px; padding:18px;">
            <div style="font-size:11px; letter-spacing:0.16em; text-transform:uppercase; color:#5a655f; font-weight:700;">Comparison case</div>
            <h2 style="margin:10px 0 0; font-size:26px; line-height:1.1; font-family:Iowan Old Style, Palatino Linotype, Book Antiqua, Georgia, serif; font-weight:600; color:#17231d;">${escapeHtml(rightUseCase?.title ?? rightScenario)}</h2>
            <p style="margin:10px 0 0; font-size:14px; line-height:1.7; color:#37433f;">${escapeHtml(rightUseCase?.summary ?? "")}</p>
            <div style="margin-top:16px; display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px;">${buildIllustrationGrid(rightIllustration)}</div>
          </article>
        </section>
      </section>
    </main>
  </body>
</html>`
}

export function downloadComparisonCard(filename: string, html: string): void {
  downloadHtml(filename, html)
}
