import * as core from "@actions/core";
import * as github from "@actions/github";
import { scanCode } from "./scan";
import { buildPrComment, worstGrade, COMMENT_MARKER } from "./comment";
import type { FileScan, SkippedFile } from "./types";

const SUPPORTED_EXT = /\.(js|jsx|mjs|cjs|ts|tsx|py)$/i;

const FAIL_LEVELS: Record<string, number> = {
  none: -1,
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

async function run(): Promise<void> {
  try {
    const apiUrl = core.getInput("api-url") || "https://codereap.vercel.app/api/scan";
    const token = core.getInput("github-token", { required: true });
    const failOn = (core.getInput("fail-on") || "critical").toLowerCase();
    const shouldComment = (core.getInput("comment") || "true").toLowerCase() !== "false";
    const maxFiles = clampInt(core.getInput("max-files"), 1, 500, 50);
    const skipPaths = (core.getInput("skip-paths") || "")
      .split("\n")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    const reportBaseUrl =
      core.getInput("report-base-url") || "https://codereap.vercel.app";

    if (!Object.prototype.hasOwnProperty.call(FAIL_LEVELS, failOn)) {
      throw new Error(
        `Invalid 'fail-on' input: '${failOn}'. Use one of: none, low, medium, high, critical.`,
      );
    }

    const octokit = github.getOctokit(token);
    const ctx = github.context;

    if (ctx.eventName !== "pull_request" && ctx.eventName !== "pull_request_target") {
      core.warning(
        `CodeReap currently only runs on pull_request / pull_request_target events. Got: ${ctx.eventName}. Skipping.`,
      );
      return;
    }

    const pr = ctx.payload.pull_request;
    if (!pr) {
      core.warning("No pull_request payload found. Skipping.");
      return;
    }

    const prNumber = pr.number;
    const headSha = pr.head?.sha as string;

    core.info(`Scanning PR #${prNumber} (${ctx.repo.owner}/${ctx.repo.repo}) at ${headSha}`);

    // List changed files (paginate up to 500 max)
    const changed = await octokit.paginate(octokit.rest.pulls.listFiles, {
      owner: ctx.repo.owner,
      repo: ctx.repo.repo,
      pull_number: prNumber,
      per_page: 100,
    });

    const candidates = changed.filter(
      (f) => f.status !== "removed" && SUPPORTED_EXT.test(f.filename),
    );

    const skipped: SkippedFile[] = [];
    const toScan: typeof candidates = [];

    for (const file of candidates) {
      const matchedSkip = skipPaths.find((p) => file.filename.startsWith(p));
      if (matchedSkip) {
        skipped.push({ path: file.filename, reason: `matches skip-path '${matchedSkip}'` });
        continue;
      }
      toScan.push(file);
    }

    if (toScan.length > maxFiles) {
      const overflow = toScan.splice(maxFiles);
      for (const f of overflow) {
        skipped.push({ path: f.filename, reason: `exceeded max-files limit (${maxFiles})` });
      }
    }

    if (toScan.length === 0) {
      core.info("No supported source files in this PR after filtering. Nothing to scan.");
      core.setOutput("grade", "A");
      core.setOutput("total-issues", "0");
      core.setOutput("critical", "0");
      core.setOutput("high", "0");
      core.setOutput("medium", "0");
      core.setOutput("low", "0");
      core.setOutput("report-url", reportBaseUrl);

      if (shouldComment) {
        await upsertComment(
          octokit,
          ctx.repo.owner,
          ctx.repo.repo,
          prNumber,
          buildPrComment({
            owner: ctx.repo.owner,
            repo: ctx.repo.repo,
            prNumber,
            headSha,
            scans: [],
            skipped,
            reportBaseUrl,
          }),
        );
      }
      return;
    }

    core.info(`Scanning ${toScan.length} file(s)â€¦`);

    const scans: FileScan[] = [];
    for (const file of toScan) {
      try {
        const content = await fetchFileContent(octokit, ctx.repo.owner, ctx.repo.repo, file, headSha);
        if (content === null) {
          skipped.push({ path: file.filename, reason: "could not fetch file content" });
          continue;
        }
        if (content.trim().length === 0) {
          skipped.push({ path: file.filename, reason: "file is empty" });
          continue;
        }

        const result = await scanCode(apiUrl, content);
        if (!result) {
          skipped.push({ path: file.filename, reason: "skipped by scanner (size or other)" });
          continue;
        }
        scans.push({ path: file.filename, result });
        core.info(
          `  â€¢ ${file.filename} â†’ ${result.grade} (${result.summary.total} issue${result.summary.total === 1 ? "" : "s"})`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        core.warning(`Failed to scan ${file.filename}: ${msg}`);
        skipped.push({ path: file.filename, reason: `scan error: ${msg}` });
      }
    }

    // Aggregate
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

    core.setOutput("grade", overallGrade);
    core.setOutput("total-issues", String(totals.total));
    core.setOutput("critical", String(totals.critical));
    core.setOutput("high", String(totals.high));
    core.setOutput("medium", String(totals.medium));
    core.setOutput("low", String(totals.low));
    core.setOutput("report-url", reportUrl);

    core.info(
      `Scan complete â€” Grade ${overallGrade} (${overallScore}/100). ${totals.total} issue${totals.total === 1 ? "" : "s"}: ${totals.critical} critical, ${totals.high} high, ${totals.medium} medium, ${totals.low} low.`,
    );

    if (shouldComment) {
      const body = buildPrComment({
        owner: ctx.repo.owner,
        repo: ctx.repo.repo,
        prNumber,
        headSha,
        scans,
        skipped,
        reportBaseUrl,
      });
      await upsertComment(octokit, ctx.repo.owner, ctx.repo.repo, prNumber, body);
    }

    // Summary in the GitHub Actions UI
    await core.summary
      .addHeading(`CodeReap â€” Grade ${overallGrade} (${overallScore}/100)`, 2)
      .addRaw(
        totals.total === 0
          ? `Clean scan across ${scans.length} file${scans.length === 1 ? "" : "s"}.`
          : `${totals.total} issue${totals.total === 1 ? "" : "s"} found across ${scans.length} file${scans.length === 1 ? "" : "s"}.`,
      )
      .addLink("View full report", reportUrl)
      .write();

    // Should we fail?
    const threshold = FAIL_LEVELS[failOn];
    const worstSeverity = pickWorstSeverity(totals);
    if (threshold !== -1 && worstSeverity >= 0 && worstSeverity >= threshold) {
      core.setFailed(
        `CodeReap: workflow failed because findings meet or exceed '${failOn}' threshold (${totals.critical} critical, ${totals.high} high, ${totals.medium} medium, ${totals.low} low).`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    core.setFailed(msg);
  }
}

function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function pickWorstSeverity(totals: {
  critical: number;
  high: number;
  medium: number;
  low: number;
}): number {
  if (totals.critical > 0) return FAIL_LEVELS.critical;
  if (totals.high > 0) return FAIL_LEVELS.high;
  if (totals.medium > 0) return FAIL_LEVELS.medium;
  if (totals.low > 0) return FAIL_LEVELS.low;
  return -1;
}

async function fetchFileContent(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  file: { filename: string; sha: string },
  ref: string,
): Promise<string | null> {
  try {
    const res = await octokit.rest.repos.getContent({
      owner,
      repo,
      path: file.filename,
      ref,
    });
    const data = res.data;
    if (Array.isArray(data) || data.type !== "file") return null;
    if (typeof data.content !== "string") return null;
    return Buffer.from(data.content, (data.encoding as BufferEncoding) || "base64").toString("utf8");
  } catch {
    // Fallback: try the blob endpoint by SHA
    try {
      const res = await octokit.rest.git.getBlob({
        owner,
        repo,
        file_sha: file.sha,
      });
      return Buffer.from(res.data.content, "base64").toString("utf8");
    } catch {
      return null;
    }
  }
}

async function upsertComment(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
): Promise<void> {
  // Find an existing CodeReap comment by marker
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100,
  });
  const existing = comments.find((c) => c.body && c.body.includes(COMMENT_MARKER));

  if (existing) {
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body,
    });
    core.info(`Updated existing CodeReap comment (#${existing.id}).`);
  } else {
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body,
    });
    core.info("Posted new CodeReap comment.");
  }
}

run();
