# ADR 0010 — Large-file parsing: one JSON crossing, fed in chunks

- Status: Accepted
- Date: 2026-07

## Context

`CnabFile.parse(content): ParsedLine[]` returns one `ParsedLine` per line, each
carrying a field map of ~40 entries. jsii marshals every one of those across the
kernel individually, over stdio. A mid-size issuer's daily retorno is routinely
six figures of lines, so this is not a theoretical concern — issue #77 measured
it.

Baseline on the issue's own reproduction recipe (`cnab400/341/retorno/detalhe`
repeated behind a header, 400-char lines, 47 fields each):

| lines | Node `parse` | Python `parse` |
| --- | --- | --- |
| 1,000 | 18 ms | 1,528 ms |
| 5,000 | 65 ms | 6,797 ms |
| 200,000 | 2,837 ms / **+615 MB heap** | **352,539 ms** (5 min 53 s) |

The 200,000-line Python figure is measured, not extrapolated
(`tools/bench_parse.py --slow 200000`).

Two distinct failures:

1. **The boundary.** Python is ~100x slower per line than Node, and the ratio is
   flat, so it is the marshalling, not the parsing. Java and .NET use the same
   kernel and behave the same. Four of the five shipped languages could not
   process a normal retorno.
2. **Node's heap.** ~6x the input size, all retained, because every line becomes
   an object with a full field map.

Issue #77 proposed four directions and required them to be measured, not
guessed. They were.

## Measurements

All numbers from `tools/bench-parse.mjs` and `tools/bench_parse.py` on one
machine, Node 22 / Python 3.11, all-default lines. They are ratios, not
promises; re-run the benchmarks rather than trusting the absolute values.

**Direction 1 — one JSON string.** Decisive, but only when the string is small:

| 200,000 lines, Python | wall |
| --- | --- |
| `parse` (baseline) | 352.5 s |
| `parse_to_json`, whole file in one call | 36.9 s |
| `parse_to_json`, fed 2,000 lines at a time | **7.5 s** |

The whole-file call is ~10x better than the baseline; chunking it is **~47x**
better. The gap between those two is the boundary's behaviour on large strings,
in *both* directions — of those 36.9 s, 35.4 s is the crossing and only 1.5 s is
Python's `json.loads`. Passing the 76 MB input across once costs ~18 s on its
own. Throughput peaks around a few thousand lines per call (2,000 →
0.038 ms/line; 50,000 → 0.058 ms/line) and collapses beyond that.

Absolute times vary by ±30% run to run on a loaded machine (the whole-file call
was also seen at 62 s); the *ratios* between rows are stable, and they are what
the decision rests on.

Issue #77's recipe builds every line with `toLine({})`, so parsed values collapse
to `"0"`/`""` and the payload is almost entirely repeated field names — which
flatters the JSON path. Both benchmarks therefore also take `--filled`, which
writes plausible values into the wide fields. With real data the 200,000-line
payload grows 184 MB → 199 MB and the chunked run goes 7.5 s → **9.1 s**. Still
inside the target, but the margin is thinner than the synthetic file suggests,
and that is the number to quote.

**Direction 2 — `parseRange(content, offset, limit)`.** Measured and rejected
outright. Paging while re-passing `content` re-transports the whole input on
every page: 200,000 lines in pages of 25,000 took **192 s**, four times *worse*
than not paging at all.

**Direction 3 — a stateful reader** (`CnabFile.reader(content)` holding the
split lines inside the engine, `readJson(offset, limit)` per page). Prototyped
and rejected. The pages themselves are fast (7.1 s total), but opening the
reader costs **18.5 s**, because that is where the 76 MB input crosses in one
piece. Total 27 s — worse than host-side chunking's 7.5 s, for three extra
public members and a new class.

**Direction 4 — accept `string[]`.** Prototyped and rejected. Consistently
7-10% *slower* than passing the same lines joined into one string (200k lines:
8.7 s vs 8.0 s at chunk 2,000), and passing the whole file as one array hits
exactly the same wall as one big string (39 s). It buys nothing and adds a
second entry point.

**Node's heap**, same benchmark, 200,000 lines:

| | wall | heap retained |
| --- | --- | --- |
| `parse` | 2,837 ms | 615 MB |
| `parseToJson`, whole file | 7,032 ms | 184 MB |
| `parseToJson`, 2,000-line chunks | 4,462 ms | **4 MB peak** |

## Decision

Add exactly one method:

```ts
CnabFile.parseToJson(content: string): string
```

It returns the whole result as a single JSON document — an array of objects
shaped exactly like `ParsedLine`
(`[{"recordKey":…,"tipo":…,"segment":…,"fields":{…}}]`) — which the host decodes
with its own native, in-process JSON parser.

Three things follow from the measurements and are part of the decision:

- **The JSON keys are camelCase** (`recordKey`), not each language's projected
  spelling. This is a data format, not a projected type; it matches the
  camelCase JSON that `CnabRecord.fromJson` and `CnabSpec.fromJson` already
  consume. Every binding suite asserts it so it cannot drift.
- **Callers feed it a few thousand lines at a time.** This is documented on the
  method, in `packages/core/README.md`, and pinned by a test in every language
  asserting that chunked output equals whole-file output. It is only valid
  because classification is per line and stateless.
- **No paging API.** Directions 2 and 3 both measured worse than the thing they
  were meant to improve, for more surface. The host already has the file; the
  cheapest place to split it is the host.

`parse` is unchanged and stays the recommended Node path.

## Consequences

- Python/Java/.NET go from "cannot process a real retorno" (353 s) to ~7.5 s for
  200,000 lines. The documented target is **200,000 lines under 10 s in
  Python**, met at chunk sizes between 2,000 and 10,000.
- Node's heap problem is solved by the same recipe: 615 MB retained → 4 MB peak.
  A lazy/iterator form for Node specifically was not added; it cannot cross jsii
  and chunking already bounds the heap in every language, including Node.
- **The engine hand-rolls JSON.** `parseToJson` writes the document directly
  rather than building objects and calling `JSON.stringify`, which is what keeps
  the Node side from materialising 200,000 objects it would immediately throw
  away. Hand-rolled JSON has one classic failure — a missed escape produces a
  payload that silently fails to decode — so escaping is centralised in one
  helper and every binding suite decodes a value containing `"` and `\`.
- `parse` and `parseToJson` **must not drift**. Value normalisation lives in a
  single module-level `normalizeRaw`, and every test asserts equivalence with
  `parse` rather than against hand-written expectations.
- Callers lose static typing on the result: JSON decodes to dictionaries, not
  `ParsedLine` structs. That is the trade, and it is why `parse` remains for
  small files where the ergonomics matter more than the throughput.
- The benchmarks are committed but **deliberately not in CI** — a full run takes
  minutes and allocates gigabytes. They are the reproduction recipe for the next
  person who changes parsing.
- The remaining ceiling is the boundary itself, not this SDK's code. Anything
  that needs to be faster than ~0.04 ms/line outside Node should run in Node, or
  wait for a jsii kernel that does not serialise over stdio.
