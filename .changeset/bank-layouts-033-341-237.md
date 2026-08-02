---
'@cnab/core': minor
'@cnab/spec': minor
'@cnab/cli': minor
---

Add 25 bank records: Santander 033 CNAB400, Itaú 341 CNAB240, Bradesco 237
CNAB240.

These were the three empty cells in the coverage matrix. Itaú and Bradesco had
no CNAB240 records at all, and Santander had no CNAB400 — so for each of those
banks half the product was simply unavailable, on the format that bank's
customers most often use.

```ts
spec.getRecord('cnab240/341/remessa/detalhe_segmento_p'); // was: record not found
spec.getRecord('cnab400/033/retorno/detalhe');            // was: record not found
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
