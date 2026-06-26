# ADR 0004 — Record-level overrides for date format / decimals

- Status: Accepted
- Date: 2026-06

## Context

ADR 0003 keeps field SEMANTICS in the catalog keyed by canonical name. Some
canonical names are *polymorphic across layouts*: e.g. `data_geracao` is an
8-digit `ddMMyyyy` date in CNAB240 (Caixa) but a 6-digit `ddMMyy` date in
CNAB400 (Itaú). A single catalog `date_format` cannot be correct for both.

## Decision

The catalog holds the **default** semantics. A record field MAY override
`date_format` (strftime, converted at build) and `decimals` for layout-specific
variants:

```yaml
- ref: data_geracao
  pos: [95, 100]
  date_format: '%d%m%y'   # override: 6-digit date in this CNAB400 record
```

`build-spec.mjs` applies the override on top of the catalog default. This is the
only permitted per-field override and it is an explicit attribute on the
record's own field entry — it is **not** cross-record inheritance, so the
"records are full standalone" property of ADR 0003 is preserved.

## Consequences

- Polymorphic fields stay as one catalog entry instead of being split into
  awkwardly suffixed names.
- Overrides are rare and visible in the record file; the build still validates
  full-line coverage regardless of overrides.
