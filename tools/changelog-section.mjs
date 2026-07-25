#!/usr/bin/env node
// changelog-section.mjs — print one version's section from the root CHANGELOG.
//
// Used by .github/workflows/release.yml to build the GitHub Release body, so
// the release notes and the committed changelog cannot drift apart. Kept as a
// script rather than a shell one-liner in the workflow so it can be run and
// tested locally:
//
//   node tools/changelog-section.mjs 0.1.0
//
// Exits non-zero if the version has no section — a release whose notes would be
// empty is a mistake, not something to paper over with a blank body.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {string} markdown full CHANGELOG.md contents
 * @param {string} version  e.g. "0.1.0"
 * @returns {string} the section body, without its own heading
 */
export function sectionFor(markdown, version) {
  const lines = markdown.split('\n');
  // Match "## [0.1.0] — 2026-07-25", "## [0.1.0]", "## 0.1.0 - date", etc.
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const heading = new RegExp(`^##\\s+\\[?${escaped}\\]?(\\s|$)`);
  const anyHeading = /^##\s+/;

  const start = lines.findIndex((l) => heading.test(l));
  if (start === -1) return '';

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (anyHeading.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines
    .slice(start + 1, end)
    .join('\n')
    .trim();
}

// Only run as a CLI when invoked directly, so the export stays importable.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = process.argv[2];
  if (!version) {
    console.error('usage: node tools/changelog-section.mjs <version>');
    process.exit(2);
  }
  const md = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  const body = sectionFor(md, version);
  if (!body) {
    console.error(
      `changelog-section: no "## [${version}]" section in CHANGELOG.md — ` +
        `add one before releasing ${version}`
    );
    process.exit(1);
  }
  process.stdout.write(body + '\n');
}
