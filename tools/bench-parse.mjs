#!/usr/bin/env node
// bench-parse.mjs — whole-file parsing throughput and memory, in Node.
//
// The Node half of the benchmark behind issue #77 and ADR 0009. Its Python
// counterpart is tools/bench_parse.py; the two build the *same* file and report
// the *same* columns so the numbers can be put side by side.
//
// DELIBERATELY NOT IN CI. A full run takes minutes and allocates gigabytes;
// wiring it into `npm test` would make every push slower and every CI runner a
// coin flip. Run it by hand when you touch parsing.
//
//   npm run build:jsii --workspace @cnab/core
//   node --expose-gc tools/bench-parse.mjs                # default sizes
//   node --expose-gc tools/bench-parse.mjs 1000 200000    # explicit sizes
//   node --expose-gc --max-old-space-size=8192 tools/bench-parse.mjs 200000
//
// `--expose-gc` is not required but the heap columns are meaningless without
// it: without a forced collection you are measuring when V8 felt like running,
// not what the parse retained.
//
// The file is built exactly as issue #77 specifies — `rec.toLine({})` repeated
// for cnab400/341/retorno/detalhe with a header_arquivo prepended — plus a
// `--filled` variant. The all-defaults file is almost entirely zeros and
// blanks, which makes it *unrepresentative in a specific way*: parsed values
// collapse to "0"/"", so the JSON output is dominated by repeated field names.
// A real retorno carries real values and produces a larger payload. Report
// both or you will overstate the JSON path.

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { CnabSpec, CnabFile } = require(path.join(ROOT, 'packages/core/lib/index.js'));

const LAYOUT = 'cnab400';
const BANK = '341';
const DIRECTION = 'retorno';
const DETALHE = `${LAYOUT}/${BANK}/${DIRECTION}/detalhe`;
const HEADER = `${LAYOUT}/${BANK}/${DIRECTION}/header_arquivo`;

const args = process.argv.slice(2);
const filled = args.includes('--filled');
const sizes = args.filter((a) => /^[0-9]+$/.test(a)).map(Number);
const SIZES = sizes.length > 0 ? sizes : [1000, 5000, 50000, 200000];
// Chunk sizes for the "feed parseToJson a few thousand lines at a time" recipe.
const CHUNKS = [2000, 10000, 50000];

const spec = CnabSpec.bundled();

/**
 * One detalhe line. `--filled` writes plausible values into the widest fields
 * so the parsed result is not almost entirely "0" — see the header comment.
 */
function detalheLine(i) {
  const rec = spec.getRecord(DETALHE);
  if (!filled) {
    return rec.toLine({});
  }
  const n = String(i % 1000000).padStart(6, '0');
  return rec.toLine({
    nosso_numero: `12${n}`,
    numero_documento: `DOC${n}`,
    nome_sacado: `CLIENTE ${n} DA SILVA SAURO`,
    valor_titulo: `${n}0000`,
    valor_principal: `${n}0000`,
    valor_tarifa: '250',
    data_de_ocorrencia: '150726',
    data_credito: '160726',
    uso_empresa: `REF-${n}`,
    numero_sequencial: n,
  });
}

function buildContent(lines) {
  const header = spec.getRecord(HEADER).toLine({});
  const parts = [header];
  // Reuse a small pool of distinct lines: identical strings would let V8 share
  // one backing store and understate memory, while a million distinct lines
  // would make generation dominate the run.
  const pool = [];
  for (let i = 0; i < 16; i++) {
    pool.push(detalheLine(i));
  }
  for (let i = 0; i < lines; i++) {
    parts.push(pool[i % pool.length]);
  }
  return `${parts.join('\n')}\n`;
}

const MB = 1048576;

function mb(bytes) {
  return `${(bytes / MB).toFixed(0)} MB`;
}

function ms(nanos) {
  return `${(Number(nanos) / 1e6).toFixed(0)} ms`;
}

function collect() {
  if (global.gc) {
    global.gc();
    global.gc();
  }
  return process.memoryUsage().heapUsed;
}

/** Time `fn` and report wall time plus heap retained by whatever it returned. */
function measure(fn) {
  const before = collect();
  const t0 = process.hrtime.bigint();
  const result = fn();
  const elapsed = process.hrtime.bigint() - t0;
  const retained = collect() - before;
  return { elapsed, retained, result };
}

function row(cells) {
  console.log(
    cells
      .map((c, i) => String(c).padEnd(i === 0 ? 20 : 18))
      .join('')
      .trimEnd()
  );
}

console.log(
  `# bench-parse (node ${process.version}) — ${LAYOUT}/${BANK} ${DIRECTION}, ` +
    `${filled ? 'filled' : 'all-default'} lines, gc ${global.gc ? 'exposed' : 'NOT exposed (heap columns unreliable)'}`
);
console.log();

for (const n of SIZES) {
  const content = buildContent(n);
  const file = CnabFile.forBankBundled(LAYOUT, BANK, '', DIRECTION);
  console.log(`## ${n.toLocaleString('en-US')} lines — input ${mb(content.length)}`);
  row(['', 'wall', 'heap retained', 'payload']);

  const parsed = measure(() => file.parse(content));
  if (parsed.result.length !== n + 1) {
    throw new Error(`parse returned ${parsed.result.length}, expected ${n + 1}`);
  }
  row(['parse', ms(parsed.elapsed), mb(parsed.retained), '—']);

  const json = measure(() => file.parseToJson(content));
  row(['parseToJson', ms(json.elapsed), mb(json.retained), mb(json.result.length)]);
  const jsonLength = json.result.length;
  json.result = null;

  // The recipe documented for non-Node callers, measured here too so the Node
  // and Python tables line up. In Node it is also the answer to heap growth:
  // peak stays proportional to the chunk, not the file.
  for (const chunk of CHUNKS) {
    if (chunk >= n) {
      continue;
    }
    const lines = content.split('\n');

    /** Consume the file chunk by chunk, dropping each decoded page. */
    function runChunked(sample) {
      let rows = 0;
      for (let i = 0; i < lines.length; i += chunk) {
        const part = lines.slice(i, i + chunk).join('\n');
        rows += JSON.parse(file.parseToJson(part)).length;
        if (sample) {
          sample();
        }
      }
      return rows;
    }

    // Two passes on purpose. Timing must not pay for forced collections, and
    // an un-collected `heapUsed` high-water mark measures allocation rate, not
    // what the loop is holding on to — which is the whole question here.
    const timed = measure(() => runChunked(null));
    if (timed.result !== n + 1) {
      throw new Error(`chunked returned ${timed.result}, expected ${n + 1}`);
    }
    const base = collect();
    let peak = 0;
    runChunked(() => {
      peak = Math.max(peak, collect() - base);
    });
    row([
      `chunk ${chunk}`,
      ms(timed.elapsed),
      `${mb(peak)} peak`,
      `${mb(jsonLength)} total`,
    ]);
  }
  console.log();
}

console.log(
  '# Node parses in-process, so `parse` is the fast path here. The point of the\n' +
    '# JSON columns is that they are the ONLY viable path across the jsii kernel —\n' +
    '# run tools/bench_parse.py to see the same rows from Python.'
);
