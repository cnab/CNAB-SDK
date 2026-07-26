#!/usr/bin/env node
// build-api-docs.mjs — multi-language API reference for the docs site.
//
// WHY THIS EXISTS, and why typedoc alone is not enough:
//
// typedoc documents TypeScript. It reads the TS source and emits TS signatures,
// and it has no idea the jsii projections exist. So the published reference told
// a Python reader to call `setDecimal(values, name, decimalValue)` when their
// actual method is `set_decimal(...)`, and a C# reader to call `setDecimal` when
// theirs is `SetDecimal`. Four of the five languages we ship were documented
// with another language's API.
//
// jsii-docgen reads the `.jsii` assembly — the same artifact jsii-pacmak builds
// the bindings from — so its signatures are the ones each language actually has.
// This script runs it per language and renders the Markdown into standalone
// pages with a language switcher.
//
//   node tools/build-api-docs.mjs [outDir]     (default: site)
//
// Requires the assembly: run `npm run build:jsii --workspace @cnab/core` first.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORE = path.join(ROOT, 'packages', 'core');
const OUT = path.resolve(ROOT, process.argv[2] || 'site');

/** jsii's own language ids, with the label a reader recognises. */
const LANGUAGES = [
  { id: 'typescript', label: 'TypeScript / Node.js' },
  { id: 'python', label: 'Python' },
  { id: 'java', label: 'Java' },
  { id: 'csharp', label: '.NET / C#' },
];

if (!fs.existsSync(path.join(CORE, '.jsii'))) {
  console.error(
    'error: packages/core/.jsii not found — run `npm run build:jsii --workspace @cnab/core` first'
  );
  process.exit(1);
}

const version = JSON.parse(
  fs.readFileSync(path.join(CORE, 'package.json'), 'utf8')
).version;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const tmp = fs.mkdtempSync(path.join(OUT, '.gen-'));

function page(langId, bodyHtml) {
  const nav = LANGUAGES.map((l) =>
    l.id === langId
      ? `<span class="lang current">${l.label}</span>`
      : `<a class="lang" href="../${l.id}/">${l.label}</a>`
  ).join('');

  // Self-contained: a strict CSP and an offline reader both have to work, so no
  // external stylesheets, fonts or scripts.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CNAB SDK — API reference (${LANGUAGES.find((l) => l.id === langId).label})</title>
<style>
  :root{--bg:#fff;--fg:#1f2328;--muted:#59636e;--border:#d1d9e0;--accent:#0969da;--code:#f6f8fa}
  @media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--muted:#9198a1;--border:#3d444d;--accent:#4493f8;--code:#151b23}}
  :root[data-theme=dark]{--bg:#0d1117;--fg:#e6edf3;--muted:#9198a1;--border:#3d444d;--accent:#4493f8;--code:#151b23}
  :root[data-theme=light]{--bg:#fff;--fg:#1f2328;--muted:#59636e;--border:#d1d9e0;--accent:#0969da;--code:#f6f8fa}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--fg);
       font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Noto Sans,Helvetica,Arial,sans-serif}
  .wrap{max-width:960px;margin:0 auto;padding:0 20px 80px}
  a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
  code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
  code{background:var(--code);padding:.15em .4em;border-radius:6px;font-size:.875em}
  pre{background:var(--code);border:1px solid var(--border);border-radius:8px;
      padding:14px 16px;overflow-x:auto;font-size:.85rem}
  pre code{background:none;padding:0}
  h1,h2,h3,h4,h5{line-height:1.25}
  h2{margin-top:2.5rem;padding-bottom:.3em;border-bottom:1px solid var(--border)}
  table{border-collapse:collapse;width:100%;font-size:.92rem;display:block;overflow-x:auto}
  th,td{text-align:left;padding:8px 12px;border:1px solid var(--border)}
  th{background:var(--code)}
  header{border-bottom:1px solid var(--border);background:var(--code)}
  header .wrap{padding-top:28px;padding-bottom:20px}
  .title{margin:0 0 .2em;font-size:1.6rem}
  .sub{color:var(--muted);margin:0 0 1em;font-size:.95rem}
  .langs{display:flex;flex-wrap:wrap;gap:8px}
  .lang{display:inline-block;padding:6px 14px;border:1px solid var(--border);
        border-radius:999px;font-size:.88rem;font-weight:600;background:var(--bg)}
  .lang.current{background:var(--accent);border-color:var(--accent);color:#fff}
  .note{border-left:4px solid var(--accent);background:var(--code);
        padding:12px 16px;border-radius:0 8px 8px 0;margin:1.2em 0;font-size:.92rem}
</style>
</head>
<body>
<header><div class="wrap">
  <h1 class="title"><a href="../../">CNAB SDK</a> — API reference</h1>
  <p class="sub">Generated from the jsii assembly for <code>@cnab/core@${version}</code>,
     so every signature below is the one this language actually has.</p>
  <div class="langs">${nav}</div>
</div></header>
<div class="wrap">
<div class="note">
  The Python, Java and .NET bindings require <strong>Node.js at runtime</strong> —
  jsii runs the engine in an embedded <code>node</code> process. See the
  <a href="../../">support matrix</a>.
</div>
${bodyHtml}
</div>
</body>
</html>
`;
}

let generated = 0;
for (const lang of LANGUAGES) {
  const target = path.join(tmp, `API.${lang.id}.md`);
  execFileSync(
    process.execPath,
    [
      path.join(ROOT, 'node_modules', 'jsii-docgen', 'bin', 'jsii-docgen'),
      '-f',
      'md',
      '-l',
      lang.id,
      '-o',
      target,
    ],
    { cwd: CORE, stdio: ['ignore', 'ignore', 'inherit'] }
  );

  // jsii-docgen appends the language to the filename when >1 language is asked
  // for and uses the given name otherwise; accept either.
  const produced = fs.existsSync(target) ? target : `${target}.${lang.id}.md`;
  const md = fs.readFileSync(produced, 'utf8');

  const dir = path.join(OUT, lang.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), page(lang.id, marked.parse(md)));
  // Keep the Markdown too: it renders on GitHub and is easy to diff.
  fs.writeFileSync(path.join(dir, `API.${lang.id}.md`), md);
  generated++;
  console.log(`build-api-docs: ${lang.id} — ${(md.length / 1024).toFixed(0)} KB`);
}

fs.rmSync(tmp, { recursive: true, force: true });

// TypeScript is the default landing language.
fs.writeFileSync(
  path.join(OUT, 'index.html'),
  `<!doctype html><meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=./typescript/">
<link rel="canonical" href="./typescript/">
<p>Redirecting to the <a href="./typescript/">TypeScript API reference</a>.</p>
`
);

if (generated !== LANGUAGES.length) {
  console.error(`build-api-docs: expected ${LANGUAGES.length} languages, wrote ${generated}`);
  process.exit(1);
}
console.log(
  `build-api-docs: OK — ${generated} languages -> ${path.relative(ROOT, OUT)} (v${version})`
);
