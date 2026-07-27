#!/usr/bin/env python3
"""bench_parse.py — whole-file parsing throughput through the Python binding.

The Python half of the benchmark behind issue #77 and ADR 0009. Its Node
counterpart is tools/bench-parse.mjs; the two build the *same* file and report
the *same* columns so the numbers can be put side by side.

DELIBERATELY NOT IN CI. `parse` on 200,000 lines takes minutes by design — that
is the finding, not a bug — and a CI job that slow would simply be turned off.
Run it by hand when you touch parsing or the jsii boundary.

    npm run build:spec
    npm run build:jsii --workspace @cnab/core
    (cd packages/core && npx jsii-pacmak --targets python)
    python -m venv /tmp/venv
    /tmp/venv/bin/pip install packages/core/dist/python/*.whl
    /tmp/venv/bin/python tools/bench_parse.py               # default sizes
    /tmp/venv/bin/python tools/bench_parse.py 5000 200000   # explicit sizes
    /tmp/venv/bin/python tools/bench_parse.py --filled 200000

`parse` is skipped above 20,000 lines unless you pass --slow: at ~1.5 ms/line it
would take five minutes on a 200k-line file and tell you nothing the 5,000-line
row did not.

The file is built exactly as issue #77 specifies — `to_line({})` repeated for
cnab400/341/retorno/detalhe with a header_arquivo prepended — plus a --filled
variant. The all-defaults file is unrepresentative in a specific way: parsed
values collapse to "0"/"", so the JSON payload is dominated by repeated field
names rather than data. Report both or you will overstate the JSON path.
"""

import gc
import json
import sys
import time

import cnab_core as c

LAYOUT = "cnab400"
BANK = "341"
DIRECTION = "retorno"
DETALHE = f"{LAYOUT}/{BANK}/{DIRECTION}/detalhe"
HEADER = f"{LAYOUT}/{BANK}/{DIRECTION}/header_arquivo"

# Feeding parse_to_json the whole file is a trap on large inputs — the jsii
# boundary degrades sharply on big strings in both directions — so the recipe is
# to chunk. These are the sizes worth comparing.
CHUNKS = (2000, 10000, 50000)

# Above this, `parse` is measured only with --slow.
PARSE_CEILING = 20000

MB = 1048576

spec = c.CnabSpec.bundled()


def detalhe_line(record, i, filled):
    """One detalhe line; --filled writes plausible values into the wide fields."""
    if not filled:
        return record.to_line({})
    n = f"{i % 1000000:06d}"
    return record.to_line(
        {
            "nosso_numero": f"12{n}",
            "numero_documento": f"DOC{n}",
            "nome_sacado": f"CLIENTE {n} DA SILVA SAURO",
            "valor_titulo": f"{n}0000",
            "valor_principal": f"{n}0000",
            "valor_tarifa": "250",
            "data_de_ocorrencia": "150726",
            "data_credito": "160726",
            "uso_empresa": f"REF-{n}",
            "numero_sequencial": f"{i % 1000000:06d}",
        }
    )


def build_lines(count, filled):
    record = spec.get_record(DETALHE)
    header = spec.get_record(HEADER).to_line({})
    pool = [detalhe_line(record, i, filled) for i in range(16)]
    return [header] + [pool[i % len(pool)] for i in range(count)]


def report(label, seconds, lines, extra=""):
    per_line = seconds * 1000 / lines
    print(f"  {label:<28} {seconds*1000:9.0f} ms  {per_line:7.4f} ms/line  {extra}")


def main():
    args = sys.argv[1:]
    filled = "--filled" in args
    slow = "--slow" in args
    sizes = [int(a) for a in args if a.isdigit()] or [1000, 5000, 50000, 200000]

    print(
        f"# bench_parse (python {sys.version.split()[0]}, cnab_core) — "
        f"{LAYOUT}/{BANK} {DIRECTION}, {'filled' if filled else 'all-default'} lines"
    )
    print()

    for n in sizes:
        lines = build_lines(n, filled)
        content = "\n".join(lines) + "\n"
        cnab_file = c.CnabFile.for_bank_bundled(LAYOUT, BANK, "", DIRECTION)
        print(f"## {n:,} lines — input {len(content)/MB:.0f} MB")

        # --- the status quo: one ParsedLine per line across the boundary -----
        if n <= PARSE_CEILING or slow:
            gc.collect()
            t0 = time.perf_counter()
            rows = cnab_file.parse(content)
            elapsed = time.perf_counter() - t0
            assert len(rows) == n + 1, len(rows)
            del rows
            report("parse", elapsed, n + 1)
        else:
            print(f"  {'parse':<28} skipped (> {PARSE_CEILING:,} lines; pass --slow)")

        # --- one crossing for the whole file ---------------------------------
        gc.collect()
        t0 = time.perf_counter()
        payload = cnab_file.parse_to_json(content)
        t1 = time.perf_counter()
        rows = json.loads(payload)
        t2 = time.perf_counter()
        assert len(rows) == n + 1, len(rows)
        payload_mb = len(payload) / MB
        del rows, payload
        report(
            "parse_to_json (whole file)",
            t2 - t0,
            n + 1,
            f"payload {payload_mb:.0f} MB "
            f"(cross {(t1-t0)*1000:.0f} ms + decode {(t2-t1)*1000:.0f} ms)",
        )

        # --- the recommended recipe ------------------------------------------
        for chunk in CHUNKS:
            if chunk >= n:
                continue
            gc.collect()
            t0 = time.perf_counter()
            total = 0
            for i in range(0, len(lines), chunk):
                part = "\n".join(lines[i : i + chunk])
                decoded = json.loads(cnab_file.parse_to_json(part))
                total += len(decoded)
                del decoded
            elapsed = time.perf_counter() - t0
            assert total == n + 1, total
            report(f"parse_to_json chunk={chunk:,}", elapsed, n + 1)

        print()


if __name__ == "__main__":
    main()
