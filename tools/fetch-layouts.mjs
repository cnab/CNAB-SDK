#!/usr/bin/env node
// fetch-layouts.mjs — reconstruct the bank layout manuals we work from.
//
// The specs are not in this repo. They are bank-published manuals, and we do
// not redistribute them; what IS committed is docs/layouts/MANIFEST.json, which
// pins every document to an upstream repository AND commit AND sha256. This
// script reads that manifest and rebuilds the collection under .layouts/.
//
// Why mirrors rather than the banks themselves: every bank domain
// (itau.com.br, bradesco.com.br, bb.com.br, caixa.gov.br, santander.com.br,
// febraban.org.br) is unreachable from CI and from the dev container, so the
// authoritative URL cannot be fetched here even when we know it. Where the
// official URL is known it is recorded as `upstreamOfficial` on the entry, so
// a human on an unrestricted network can re-download and diff.
//
// The sha256 check is the point. A mirror is someone else's copy of a bank
// document: pinning the commit stops it changing under us, and the digest
// proves the bytes we reasoned about are the bytes you got. A digest mismatch
// is a hard failure, never a warning — silently accepting different bytes
// would defeat the only guarantee this script offers.
//
// Run: node tools/fetch-layouts.mjs [--dest .layouts]

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, 'docs/layouts/MANIFEST.json');

const destArg = process.argv.indexOf('--dest');
const DEST = path.resolve(ROOT, destArg !== -1 ? process.argv[destArg + 1] : '.layouts');

const { documents } = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

const git = (args, cwd) =>
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// Group by pinned commit so each upstream is fetched exactly once.
const byRepo = new Map();
for (const doc of documents) {
  const key = `${doc.source.repo}@${doc.source.commit}`;
  if (!byRepo.has(key)) byRepo.set(key, []);
  byRepo.get(key).push(doc);
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cnab-layouts-'));
const problems = [];
let fetched = 0;

try {
  for (const [key, docs] of byRepo) {
    const [repo, commit] = key.split('@');
    process.stdout.write(`${repo} @ ${commit.slice(0, 10)} … `);

    // Fetch the single pinned commit rather than cloning history. Some hosts
    // refuse to serve an arbitrary SHA this way, so fall back to a shallow
    // clone of the default branch and check the SHA is actually present —
    // if the mirror has moved on, that check is what tells us.
    const dir = path.join(work, repo.replace('/', '__'));
    fs.mkdirSync(dir, { recursive: true });
    try {
      git(['init', '--quiet'], dir);
      git(['remote', 'add', 'origin', `https://github.com/${repo}.git`], dir);
      git(['fetch', '--quiet', '--depth', '1', 'origin', commit], dir);
      git(['checkout', '--quiet', 'FETCH_HEAD'], dir);
    } catch {
      fs.rmSync(dir, { recursive: true, force: true });
      git(['clone', '--quiet', `https://github.com/${repo}.git`, dir], work);
      git(['checkout', '--quiet', commit], dir);
    }

    for (const doc of docs) {
      const from = path.join(dir, doc.source.path);
      if (!fs.existsSync(from)) {
        problems.push(`${doc.path}: ${doc.source.path} missing at ${key}`);
        continue;
      }
      const buf = fs.readFileSync(from);
      const got = sha256(buf);
      if (got !== doc.sha256) {
        problems.push(
          `${doc.path}: sha256 mismatch — manifest ${doc.sha256.slice(0, 16)}…, ` +
            `upstream ${got.slice(0, 16)}…`
        );
        continue;
      }
      const to = path.join(DEST, doc.path);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.writeFileSync(to, buf);
      fetched += 1;
    }
    process.stdout.write('ok\n');
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

if (problems.length) {
  console.error('\nfetch-layouts FAILED:');
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    '\n  A mismatch means the mirror changed or the pin is wrong. Do not ' +
      'update the manifest digest to match — verify the new bytes against ' +
      'the bank document first.'
  );
  process.exit(1);
}

console.log(
  `\nfetch-layouts: OK — ${fetched}/${documents.length} documents in ${path.relative(ROOT, DEST)}/`
);
