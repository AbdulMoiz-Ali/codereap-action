import type { FileScan, Grade, SkippedFile } from "./types";

export const COMMENT_MARKER = "<!-- vibeaudit-comment-do-not-remove -->";

const GRADE_LABEL: Record<Grade, string> = {
  A: "Excellent",
  B: "Good",
  C: "Needs work",
  D: "Risky",
  F: "Critical",
};

interface BuildCommentInput {
  owner: string;
  repo: string;
  prNumber: number;
  headSha: string;
  scans: FileScan[];
  skipped: SkippedFile[];
  reportBaseUrl: string;
}

export function buildPrComment(input: BuildCommentInput): string {
  const { owner, repo, prNumber, headSha, scans, skipped, reportBaseUrl } = input;

  const totals = scans.reduce(
    (acc, s) => {
      acc.critical += s.result.summary.critical;
      acc.high += s.result.summary.high;
      acc.medium += s.result.summary.medium;
      acc.low += s.result.summary.low;
      acc.total += s.result.summary.total;
      return acc;
    },
    { critical: 0, high: 0, medium: 0, low: 0, total: 0 },
  );

  const overallGrade = worstGrade(scans.map((s) => s.result.grade));
  const overallScore =
    scans.length === 0
      ? 100
      : Math.round(scans.reduce((acc, s) => acc + s.result.score, 0) / scans.length);

  const reportUrl =
    `${reportBaseUrl}/r?` +
    new URLSearchParams({
      g: overallGrade,
      s: String(overallScore),
      c: String(totals.critical),
      h: String(totals.high),
      m: String(totals.medium),
      l: String(totals.low),
      lang: scans[0]?.result.language ?? "unknown",
      loc: String(scans.reduce((acc, s) => acc + s.result.loc, 0)),
    }).toString();

  const header =
    `## VibeAudit — Grade \`${overallGrade}\` · ${GRADE_LABEL[overallGrade]} (${overallScore}/100)\n\n` +
    (totals.total === 0
      ? `Clean scan across ${scans.length} file${scans.length === 1 ? "" : "s"}.\n`
      : `**${totals.total} issue${totals.total === 1 ? "" : "s"}** found across ${scans.length} file${scans.length === 1 ? "" : "s"}.\n`);

  const counts =
    totals.total === 0
      ? ""
      : `\n| Severity | Count |\n| --- | --- |\n` +
        (totals.critical ? `| **Critical** | ${totals.critical} |\n` : "") +
        (totals.high ? `| **High** | ${totals.high} |\n` : "") +
        (totals.medium ? `| **Medium** | ${totals.medium} |\n` : "") +
        (totals.low ? `| **Low** | ${totals.low} |\n` : "");

  const findingsList = scans
    .filter((s) => s.result.findings.length > 0)
    .slice(0, 10)
    .map((s) => formatFileFindings(s, owner, repo, headSha))
    .join("\n");

  const skippedNote =
    skipped.length === 0
      ? ""
      : `\n<details><summary>Skipped ${skipped.length} file${skipped.length === 1 ? "" : "s"}</summary>\n\n` +
        skipped.map((sk) => `- \`${sk.path}\` — ${sk.reason}`).join("\n") +
        `\n</details>\n`;

  const footer =
    `\n---\n` +
    `[View full report](${reportUrl}) · ` +
    `[Run a one-off scan](${reportBaseUrl}) · ` +
    `Posted by [VibeAudit](${reportBaseUrl}) on PR #${prNumber}\n` +
    `${COMMENT_MARKER}\n`;

  return [header, counts, findingsList, skippedNote, footer].filter(Boolean).join("\n");
}

function formatFileFindings(
  scan: FileScan,
  owner: string,
  repo: string,
  headSha: string,
): string {
  const filePath = scan.path;
  const fileLink = `[\`${filePath}\`](https://github.com/${owner}/${repo}/blob/${headSha}/${filePath})`;
  const grade = `**${scan.result.grade}** (${scan.result.score}/100)`;
  const findings = scan.result.findings
    .slice(0, 8)
    .map((f) => {
      const lineLink = `https://github.com/${owner}/${repo}/blob/${headSha}/${filePath}#L${f.line}`;
      const sev = `\`${f.severity.toUpperCase()}\``;
      return `  - ${sev} **${f.title}** — ${oneLine(f.message)} → [L${f.line}](${lineLink})`;
    })
    .join("\n");
  const more =
    scan.result.findings.length > 8
      ? `\n  - …and ${scan.result.findings.length - 8} more in this file`
      : "";
  return `### ${fileLink} — ${grade}\n${findings}${more}`;
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim().slice(0, 220);
}

export function worstGrade(grades: Grade[]): Grade {
  if (grades.length === 0) return "A";
  const order: Grade[] = ["A", "B", "C", "D", "F"];
  let worst: Grade = "A";
  for (const g of grades) {
    if (order.indexOf(g) > order.indexOf(worst)) worst = g;
  }
  return worst;
}
