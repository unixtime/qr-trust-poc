import {
  buildLabLink,
  buildLearnTrackLink,
  learnStages,
  lessonTracks,
  type LessonTrack,
} from "@/routes/learn/content"

import {
  buildAbsoluteLink,
  downloadHtml,
  escapeHtml,
} from "./htmlDownload"

function stageLabel(stage: string): string {
  return learnStages.find((item) => item.key === stage)?.label ?? stage
}

function buildLinkRows(track: LessonTrack): string {
  const labStep = [...track.steps].reverse().find((step) => step.stage === "lab")
  const links = [
    {
      title: `${track.label} sequence`,
      summary: "Start the prepared sequence from the first guided step.",
      href: buildAbsoluteLink(buildLearnTrackLink(track.key, 0)),
    },
    labStep
      ? {
          title: "Live lab handoff",
          summary:
            "Open the working verifier with the exact scenario the sequence ends on.",
          href: buildAbsoluteLink(
            buildLabLink(labStep.scenario ?? "valid", labStep.nonceMode ?? "fixed"),
          ),
        }
      : null,
    {
      title: "Operator route",
      summary:
        "Use this when the discussion turns to runtime posture, access control, or future operator separation.",
      href: buildAbsoluteLink("/operator"),
    },
    {
      title: "Committee handoff",
      summary:
        "Open the committee-facing handoff section when you want the shortest path from guided framing to a technical proof artifact.",
      href: buildAbsoluteLink(`${buildLearnTrackLink(track.key, track.steps.length - 1).replace("#teaching-tracks", "")}#committee-review`),
    },
  ].filter(Boolean) as Array<{ title: string; summary: string; href: string }>

  return links
    .map(
      (link) => `
        <section style="border:1px solid #ddd4c6; background:white; border-radius:18px; padding:16px;">
          <div style="font-size:11px; letter-spacing:0.16em; text-transform:uppercase; color:#5a655f; font-weight:700;">${escapeHtml(link.title)}</div>
          <div style="margin-top:10px; font-size:14px; line-height:1.7; color:#37433f;">${escapeHtml(link.summary)}</div>
          <div style="margin-top:12px; border:1px solid #ebe2d3; background:#fffdfa; border-radius:14px; padding:12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px; line-height:1.6; color:#36423d; word-break:break-word;">
            ${escapeHtml(link.href)}
          </div>
        </section>
      `,
    )
    .join("")
}

function buildStepRows(track: LessonTrack): string {
  return track.steps
    .map(
      (step, index) => `
        <section style="border:1px solid #ddd4c6; background:white; border-radius:18px; padding:16px;">
          <div style="display:flex; align-items:flex-start; gap:12px;">
            <div style="display:inline-flex; align-items:center; justify-content:center; width:34px; height:34px; border-radius:999px; background:#ede8de; color:#4b5853; font-size:12px; font-weight:700;">${index + 1}</div>
            <div>
              <div style="font-size:11px; letter-spacing:0.16em; text-transform:uppercase; color:#5a655f; font-weight:700;">${escapeHtml(stageLabel(step.stage))}</div>
              <div style="margin-top:6px; font-size:20px; line-height:1.15; font-family:Iowan Old Style, Palatino Linotype, Book Antiqua, Georgia, serif; color:#17231d;">${escapeHtml(step.title)}</div>
              <p style="margin:10px 0 0; font-size:14px; line-height:1.7; color:#37433f;">${escapeHtml(step.prompt)}</p>
              ${
                step.scenario
                  ? `<div style="margin-top:10px; font-size:13px; line-height:1.6; color:#37433f;"><strong>Primary case:</strong> ${escapeHtml(step.scenario)}</div>`
                  : ""
              }
              ${
                step.compareScenario
                  ? `<div style="margin-top:4px; font-size:13px; line-height:1.6; color:#37433f;"><strong>Compare against:</strong> ${escapeHtml(step.compareScenario)}</div>`
                  : ""
              }
            </div>
          </div>
        </section>
      `,
    )
    .join("")
}

export function buildReviewPacketHtml(track = lessonTracks["reviewer-defense"]): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>QR Trust Sequence Packet</title>
  </head>
  <body style="margin:0; background:#f6f0e6; color:#17231d; font-family:'Avenir Next','Segoe UI','SF Pro Text',system-ui,sans-serif;">
    <main style="max-width:1180px; margin:0 auto; padding:36px 28px 54px;">
      <section style="border:1px solid #d9d0c2; background:#fffaf2; border-radius:28px; padding:28px 30px; box-shadow:0 20px 56px rgba(23,35,29,0.08);">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
          <div style="font-size:11px; letter-spacing:0.18em; text-transform:uppercase; color:#496c62; font-weight:700;">QR trust sequence packet</div>
          <div style="border:1px solid #d8c195; background:#f7ebd7; color:#8f5e16; padding:7px 12px; border-radius:999px; font-size:11px; letter-spacing:0.14em; text-transform:uppercase; font-weight:700;">${escapeHtml(track.audience)}</div>
        </div>

        <h1 style="margin:14px 0 0; font-size:38px; line-height:1.08; font-family:Iowan Old Style, Palatino Linotype, Book Antiqua, Georgia, serif; font-weight:600;">${escapeHtml(track.label)}</h1>
        <p style="margin:14px 0 0; max-width:840px; font-size:16px; line-height:1.7; color:#36423d;">${escapeHtml(track.summary)}</p>

        <section style="margin-top:22px;">
          <div style="font-size:11px; letter-spacing:0.18em; text-transform:uppercase; color:#496c62; font-weight:700;">Prepared sequence</div>
          <div style="display:grid; gap:12px; margin-top:14px;">
            ${buildStepRows(track)}
          </div>
        </section>

        <section style="margin-top:24px;">
          <div style="font-size:11px; letter-spacing:0.18em; text-transform:uppercase; color:#496c62; font-weight:700;">Direct deep links</div>
          <div style="display:grid; gap:12px; margin-top:14px;">
            ${buildLinkRows(track)}
          </div>
        </section>
      </section>
    </main>
  </body>
</html>`
}

export function downloadReviewPacket(filename: string, html: string): void {
  downloadHtml(filename, html)
}
