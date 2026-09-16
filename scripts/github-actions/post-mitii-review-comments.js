/**
 * Post Mitii review findings as GitHub PR review comments.
 *
 * Inspired by Open Code Review's poster strategy (batching, sticky summary,
 * IoU dedupe) but rewritten for Mitii ReviewResult JSON.
 *
 * Usage (actions/github-script):
 *   const { postMitiiReviewComments } = require('./scripts/github-actions/post-mitii-review-comments.js');
 *   await postMitiiReviewComments({ github, context, core, fs, reviewPath: 'review.json' });
 */

'use strict';

const crypto = require('crypto');

const SUMMARY_MARKER = '<!-- mitii-review-summary -->';
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_OVERLAP_THRESHOLD = 0.6;

const SEVERITIES = ['critical', 'high', 'medium', 'low'];
const SEVERITY_RANK = new Map(SEVERITIES.map((s, i) => [s, SEVERITIES.length - i]));

/**
 * @param {object} params
 * @param {any} params.github
 * @param {any} params.context
 * @param {any} params.core
 * @param {typeof import('fs')} params.fs
 * @param {string} params.reviewPath path to Mitii review JSON ({ result: ReviewResult } or ReviewResult)
 * @param {number} [params.batchSize]
 * @param {number} [params.overlapThreshold]
 */
async function postMitiiReviewComments(params) {
  const {
    github,
    context,
    core,
    fs,
    reviewPath,
    batchSize = DEFAULT_BATCH_SIZE,
    overlapThreshold = DEFAULT_OVERLAP_THRESHOLD,
  } = params;

  const raw = JSON.parse(fs.readFileSync(reviewPath, 'utf8'));
  const result = raw.result ?? raw;
  const findings = Array.isArray(result.findings) ? result.findings : [];

  const owner = context.repo.owner;
  const repo = context.repo.repo;
  const pull_number = context.payload.pull_request?.number;
  if (!pull_number) {
    core.setFailed('Not a pull_request event');
    return { posted: 0 };
  }

  const headSha =
    context.payload.pull_request?.head?.sha ?? context.sha;

  const inline = [];
  const summaryOnly = [];
  for (const finding of findings) {
    if (!finding?.path || !finding?.content) continue;
    if (finding.severity === 'low') continue; // hide nits by default
    if (!finding.startLine) {
      summaryOnly.push(finding);
      continue;
    }
    inline.push(finding);
  }

  const deduped = dedupeByIou(inline, overlapThreshold);
  let posted = 0;

  for (let i = 0; i < deduped.length; i += batchSize) {
    const batch = deduped.slice(i, i + batchSize);
    const comments = batch.map((f) => ({
      path: f.path,
      body: formatFindingBody(f),
      line: f.endLine ?? f.startLine,
      side: 'RIGHT',
      ...(f.startLine && f.endLine && f.endLine !== f.startLine
        ? { start_line: f.startLine, start_side: 'RIGHT' }
        : {}),
    }));
    try {
      await github.rest.pulls.createReview({
        owner,
        repo,
        pull_number,
        commit_id: headSha,
        event: 'COMMENT',
        comments,
      });
      posted += comments.length;
    } catch (error) {
      core.warning(`Batch review failed (${error.message}); falling back per-comment`);
      for (const comment of comments) {
        try {
          await github.rest.pulls.createReviewComment({
            owner,
            repo,
            pull_number,
            commit_id: headSha,
            ...comment,
          });
          posted += 1;
        } catch (inner) {
          summaryOnly.push({
            path: comment.path,
            content: comment.body,
            severity: 'medium',
            category: 'other',
            existingCode: '',
            _postError: inner.message,
          });
        }
      }
    }
  }

  await upsertStickySummary({
    github,
    owner,
    repo,
    pull_number,
    result,
    findings: deduped,
    summaryOnly,
    posted,
  });

  return { posted, summaryOnly: summaryOnly.length };
}

function formatFindingBody(f) {
  const sev = String(f.severity ?? 'medium').toUpperCase();
  const cat = String(f.category ?? 'other');
  let body = `**[${sev} / ${cat}]** ${f.content}`;
  if (f.suggestionCode) {
    body += `\n\nSuggested fix:\n\`\`\`\n${f.suggestionCode}\n\`\`\``;
  }
  return body;
}

function dedupeByIou(findings, threshold) {
  const kept = [];
  for (const f of findings) {
    const start = f.startLine ?? 0;
    const end = f.endLine ?? start;
    const dup = kept.find((k) => {
      if (k.path !== f.path) return false;
      const ks = k.startLine ?? 0;
      const ke = k.endLine ?? ks;
      return lineIou(start, end, ks, ke) >= threshold;
    });
    if (!dup) {
      kept.push(f);
      continue;
    }
    const rank = SEVERITY_RANK.get(f.severity) ?? 0;
    const existing = SEVERITY_RANK.get(dup.severity) ?? 0;
    if (rank > existing) {
      const idx = kept.indexOf(dup);
      kept[idx] = f;
    }
  }
  return kept;
}

function lineIou(a0, a1, b0, b1) {
  const inter = Math.max(0, Math.min(a1, b1) - Math.max(a0, b0) + 1);
  const union = Math.max(a1, b1) - Math.min(a0, b0) + 1;
  return union <= 0 ? 0 : inter / union;
}

async function upsertStickySummary(params) {
  const { github, owner, repo, pull_number, result, findings, summaryOnly, posted } =
    params;
  const body = [
    SUMMARY_MARKER,
    '## Mitii code review',
    '',
    `- Findings posted inline: **${posted}**`,
    `- Selected files: **${result.selectedCount ?? '?'}**`,
    `- Summary-only / unanchored: **${summaryOnly.length}**`,
    '',
    ...summaryOnly.slice(0, 20).map(
      (f) =>
        `- \`${f.path}\`: ${String(f.content).slice(0, 200)}${f._postError ? ` _(post failed: ${f._postError})_` : ''}`,
    ),
    '',
    `_fingerprint ${crypto.createHash('sha256').update(JSON.stringify(findings.map((f) => f.path + f.content))).digest('hex').slice(0, 12)}_`,
  ].join('\n');

  const { data: comments } = await github.rest.issues.listComments({
    owner,
    repo,
    issue_number: pull_number,
    per_page: 100,
  });
  const existing = comments.find((c) => c.body && c.body.includes(SUMMARY_MARKER));
  if (existing) {
    await github.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body,
    });
  } else {
    await github.rest.issues.createComment({
      owner,
      repo,
      issue_number: pull_number,
      body,
    });
  }
}

module.exports = {
  postMitiiReviewComments,
  dedupeByIou,
  lineIou,
  SUMMARY_MARKER,
  DEFAULT_BATCH_SIZE,
};
