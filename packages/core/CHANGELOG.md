# @cnab/core

## 0.6.0

### Minor Changes

- c76936b: Add 25 bank records: Santander 033 CNAB400, Itaú 341 CNAB240, Bradesco 237
  CNAB240.

  These were the three empty cells in the coverage matrix. Itaú and Bradesco had
  no CNAB240 records at all, and Santander had no CNAB400 — so for each of those
  banks half the product was simply unavailable, on the format that bank's
  customers most often use.

  ```ts
  spec.getRecord('cnab240/341/remessa/detalhe_segmento_p'); // was: record not found
  spec.getRecord('cnab400/033/retorno/detalhe'); // was: record not found
  ```

  Each record was transcribed from that bank's own cobrança manual, and every
  `pos` pair was cross-checked against the position column printed in the PDF —
  620 fields, one discrepancy, which turned out to be a typesetting artifact
  (`073  0 73`) confirmed by hand against its neighbours. The manuals are pinned
  in `docs/layouts/MANIFEST.json`.

  Two Itaú deviations from the FEBRABAN baseline are worth knowing about: the
  38-57 nosso-número block is split into carteira(3) + nosso número(8) + DAC(1),
  and `numero_documento` is 10 wide rather than 15.

  **Bradesco 237 CNAB240 is a draft.** Its manual is version 02 from 2013 and the
  bank publishes version 09; bradesco.com.br is not reachable from CI, so the
  current document could not be diffed against it. The positions are faithful to
  what we have, but `versao_layout_arquivo` / `versao_layout_lote` are exactly the
  defaults a bank accepts or rejects wholesale, and anything carved out of
  2013-era filler since will be blank. Review against a current manual before
  generating a real remessa. The README says so at the point of use.

  Coverage validation proves a record is well-formed, not correct — a wrong
  position produces a plausible, wrong number rather than an error. That is why
  the transcription was verified against the source document rather than only
  against the build.

- 001d0f5: Add CNAB400 remessa for Banco do Brasil 001, Caixa 104 and Bradesco 237.

  All three banks could already parse a retorno and none could generate a
  remessa — you could read what the bank sent you and could not bill anyone
  through it. That asymmetry is now gone: **every supported bank can both read
  and write CNAB 400.**

  ```ts
  spec.getRecord('cnab400/001/remessa/detalhe'); // was: record not found
  spec.getRecord('cnab400/104/remessa/detalhe'); // was: record not found
  spec.getRecord('cnab400/237/remessa/detalhe'); // was: record not found
  ```

  12 records, 80 -> 92. Each was transcribed from that bank's own cobrança manual
  (pinned in `docs/layouts/MANIFEST.json`) and every `pos` pair was cross-checked
  against the position column printed in the PDF: **249 fields, two deviations,
  both deliberate and disclosed** — BB's header splits the manual's single
  18-byte `001BANCODOBRASIL` literal into `codigo_banco` + `nome_banco` so scope
  detection can read the bank code, and the output is byte-identical.

  Two layouts carry scope the spec cannot express, so they are documented in the
  README instead:

  - **Banco do Brasil** comes from the manual for convênios above 1.000.000.
    Convênios at or below that place the convênio field differently.
  - **Caixa** splits nosso número as modalidade(2) + número(15) at 57-73, and
    carteira is 2 positions rather than the generic template's 1.

  Naming: all three banks' `vencimento` and `abatimento` fields use the CNAB400
  _remessa_ spelling, matching the generic template and the existing 033/341
  remessa records, rather than the `data_vencimento`/`valor_abatimento` spelling
  their own retorno records use. Writing a remessa across banks should not need
  two names for one concept.

  Where a bank's multa turned out to live inside the detalhe rather than in its
  own record — Caixa and Bradesco both — no `detalhe_multa` was invented. Both
  ship the message record their manual actually defines, as `detalhe_mensagem`.
  Banco do Brasil does define a real standalone multa record and it is included.

### Patch Changes

- 8240f13: Fix: Banco do Brasil CNAB400 retorno silently discarded the receiving agency.

  Positions 169-173 of `cnab400/001/retorno/detalhe` were a single filler field
  named `reservado_bb_d1` — a placeholder added during the legacy migration and
  flagged then as needing verification against the manual. BB's CBR643 manual
  splits that span into two real fields:

  ```
  29  169 a 172  9(004)  Prefixo da agência recebedora
  30  173 a 173  X(001)  DV prefixo recebedora
  ```

  So every parsed BB retorno reported `reservado_bb_d1` instead of telling you
  which agency received the payment. The data was in the file the whole time and
  the SDK threw it away — the quiet kind of wrong, since nothing errored.

  ```ts
  rec.parse(line).agencia_recebedora; // "1430"  (was: absent)
  rec.parse(line).agencia_recebedora_dv; // "A"     (was: absent)
  rec.parse(line).reservado_bb_d1; // now undefined
  ```

  Adds `agencia_recebedora` and `agencia_recebedora_dv` to the catalog and
  retires the `reservado_bb_d1` placeholder, which had no other user. The
  existing `agencia_cobradora` names could not be reused: the same record already
  uses them at 18-22, and _cobradora_ and _recebedora_ are different roles.

  Every neighbouring field (153-165, 166-168, 174-175, 176-181, 182-188,
  189-201) already matched the manual exactly, which is why this was an isolated
  defect rather than a drifted region. Verifying it was an explicit acceptance
  item on #26 and became possible once the CBR643 manual was pinned in
  `docs/layouts/MANIFEST.json`.

  The golden fixture changes only within 169-173.

## 0.5.0

### Minor Changes

- 1ad04dc: Add `CnabFile.parseToJson(content)` so large files are usable outside Node.

  `parse` returns one `ParsedLine` per line and jsii marshals each one — with its
  ~40-key field map — across the kernel individually. A 200,000-line retorno is
  200,000 crossings: ~280 s in Python, and the same in Java and .NET, which share
  the kernel. In Node the cost is memory instead — the result retains ~6x the
  input size (615 MB for a 76 MB file).

  `parseToJson` returns the whole result as one JSON string, which the host
  decodes with its own in-process parser. Fed a few thousand lines at a time — the
  documented recipe, because the jsii boundary degrades sharply on large strings
  in both directions — the same 200,000-line file takes **7.5 s in Python** and
  peaks at **4 MB of Node heap**.

  The output is an array of `ParsedLine`-shaped objects with camelCase keys and
  values identical to `parse`. `parse` is unchanged and remains the Node path.
  See ADR 0010 for the measurements, including the three rejected alternatives,
  and `packages/core/README.md` for the documented limits.

### Patch Changes

- 41d1b6d: Add `go` to the jsii targets (`github.com/cnab/cnab-core-go`, package
  `cnabcore`), so the published assembly declares a Go projection alongside
  Python, Java and .NET.

  **No public API changed.** The API snapshot in
  `packages/core/test/api-surface.json` is byte-identical and no member was
  renamed: jsii's JSII5018 reserved-word check already unions the Go keyword list
  regardless of configured targets, which is why `type` became `fieldType` long
  before Go was a target. Adding the target produced zero new jsii warnings.

  The Go module is **not distributed yet** — creating `cnab/cnab-core-go` and
  wiring the release push are issue #41 steps 2-3. Until then the SDK is still
  Node/Python/Java/.NET. The distribution decision is recorded as
  [ADR 0009](https://github.com/cnab/CNAB-SDK/blob/main/docs/adrs/0009-go-module-distribution.md)
  with status Proposed.

## 0.4.0

### Minor Changes

- bf3cc13: Add `BrCode` — generate, parse and verify the PIX "copia e cola" payload.

  PIX was absent from the SDK entirely, which in 2026 is a disqualifier: the
  hybrid boleto is the default cobrança product at every major Brazilian bank.
  This is the self-contained half of that work (#69, part of #59) — no spec
  changes, pure engine.

  ```ts
  const payload = BrCode.encode({
    pixKey: 'fulano@example.com',
    merchantName: 'FULANO DE TAL',
    merchantCity: 'BRASILIA',
    amount: '10.00', // decimal string, never a float (ADR 0006)
  });
  BrCode.isValid(payload); // true
  BrCode.decode(payload).pixKey; // 'fulano@example.com'
  ```

  `BrCode.crc16` implements CRC-16/CCITT-FALSE and is pinned to the canonical
  `"123456789" -> 29B1` check value, plus a cross-check against an independent
  table-driven implementation over 2000 inputs. A wrong CRC yields a QR that scans
  and is then rejected by the bank — the same undetectable-until-production
  failure class as the old `toLine` truncation.

  Accented names are folded to ASCII (`JOSÉ` -> `JOSE`) rather than emitted raw.
  Covered by the Python, Java and .NET binding suites as well as the Node tests.

## 0.3.0

### Minor Changes

- b31e424: 0.3.0 — supersedes the withdrawn 0.2.0.

  **Do not use `v0.2.0`.** Its GitHub Release was tagged on a commit whose
  manifests still said `0.1.0`, so every artifact attached to it is a `0.1.0`
  build: it does not contain the breaking `setDecimal`/`setDateIso` change or the
  per-language test suites that its notes describe. The release-gate bug that
  produced it is fixed here, so 0.3.0 is the first release that actually carries
  those changes.

  Everything listed under 0.2.0 is included in 0.3.0, including the breaking
  change to the typed-value setters:

  ```diff
  - record.setDecimal(values, 'valor_titulo', '1500.00');
  + values = record.setDecimal(values, 'valor_titulo', '1500.00');
  ```

  Also in 0.3.0: the documentation site moved to cnab.github.io, and the release
  pipeline gained guards for the gate ordering and lockfile drift.

## 0.2.0

### Minor Changes

- 2dded41: **BREAKING: `CnabRecord.setDecimal` and `setDateIso` now return the updated map
  instead of mutating in place.**

  They previously returned `void` and mutated the value map. That works in Node,
  where objects are passed by reference, but jsii marshals maps **by value** — so
  in Python, Java and .NET the mutation landed on a copy that was thrown away and
  the caller got nothing back. Both documented helpers were inert in three of the
  four languages the SDK ships, and all 185 Node tests passed the whole time.

  ```diff
  - record.setDecimal(values, 'valor_titulo', '1500.00');   // Node-only
  + values = record.setDecimal(values, 'valor_titulo', '1500.00');
  ```

  The input map is no longer modified. Adds per-language unit suites under
  `bindings/` (pytest, JUnit 5, xUnit) that run against the generated artifacts,
  which is the only way this class of projection bug is visible.

## 0.1.0

### Minor Changes

- First versioned release: 0.1.0.

  Establishes the versioning baseline for the whole SDK. All three packages move in
  lockstep — `@cnab/core`'s version is what jsii projects to PyPI/Maven/NuGet, and
  `@cnab/cli` pins its siblings by exact version, so version skew across four
  registries is not worth the flexibility.

  Deliberately 0.x: the jsii assembly is `stability: experimental`, `toLine`
  recently became strict, and catalog field names may still move as the ADR 0008
  picture-size cleanup lands.
