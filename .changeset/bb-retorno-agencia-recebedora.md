---
'@cnab/core': patch
'@cnab/spec': patch
'@cnab/cli': patch
---

Fix: Banco do Brasil CNAB400 retorno silently discarded the receiving agency.

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
rec.parse(line).agencia_recebedora;    // "1430"  (was: absent)
rec.parse(line).agencia_recebedora_dv; // "A"     (was: absent)
rec.parse(line).reservado_bb_d1;       // now undefined
```

Adds `agencia_recebedora` and `agencia_recebedora_dv` to the catalog and
retires the `reservado_bb_d1` placeholder, which had no other user. The
existing `agencia_cobradora` names could not be reused: the same record already
uses them at 18-22, and *cobradora* and *recebedora* are different roles.

Every neighbouring field (153-165, 166-168, 174-175, 176-181, 182-188,
189-201) already matched the manual exactly, which is why this was an isolated
defect rather than a drifted region. Verifying it was an explicit acceptance
item on #26 and became possible once the CBR643 manual was pinned in
`docs/layouts/MANIFEST.json`.

The golden fixture changes only within 169-173.
