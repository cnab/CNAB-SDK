# Bank layout manuals

The record layouts in `packages/spec` have to come from somewhere, and until now
that provenance lived nowhere. This directory records it.

`MANIFEST.json` pins 20 documents by upstream repository, commit and sha256.
The files themselves are **not committed** — they are bank-published manuals and
we do not redistribute them. To get them:

```
node tools/fetch-layouts.mjs      # → .layouts/ (gitignored)
```

A sha256 mismatch is a hard failure. Do not "fix" it by updating the digest.

## What we have

| Bank | CNAB240 | CNAB400 | Document vintage |
| --- | --- | --- | --- |
| **341** Itaú | ✅ | ✅ | Fevereiro 2016 (both) |
| **237** Bradesco | ✅ | ✅ | MP v02 08/07/2013 · MP v08 11/09/2013 |
| **033** Santander | ✅ | ✅ | **Setembro/2009** · v2.17 Outubro/2017 |
| **104** Caixa | ✅ SIGCB | ✅ SIGCB | 14/10/2015 · undated |
| **001** Banco do Brasil | ✅ | ✅ remessa + retorno | CbrVer04BB julho/2011 · CBR641 2012 / CBR643 2014 |
| **748** Sicredi | ❌ | ✅ | Maio/2014 |
| **756** Sicoob | ⚠️ spreadsheet | ⚠️ spreadsheet | see caveat below |
| **041** Banrisul | ❌ | ✅ | undated |
| **422** Safra | ❌ | ✅ | Dezembro/2017 |
| **655** Votorantim (BV) | ❌ | ✅ | undated |
| **487** Deutsche Bank | ✅ | ❌ | v1.1 April 2015 (English) |
| — FEBRABAN | ✅ V09.1 + V08.6 | — | 19/10/2015 · 05/01/2012 |

The bottom five have manuals but **no records in the spec yet** — one ticket
each: Sicredi [#74](https://github.com/cnab/CNAB-SDK/issues/74), Sicoob
[#73](https://github.com/cnab/CNAB-SDK/issues/73), Banrisul
[#99](https://github.com/cnab/CNAB-SDK/issues/99), Safra
[#100](https://github.com/cnab/CNAB-SDK/issues/100), Votorantim
[#101](https://github.com/cnab/CNAB-SDK/issues/101), Deutsche Bank
[#102](https://github.com/cnab/CNAB-SDK/issues/102).

## Read this before using any of it

**These are third-party mirrors, not the banks' own copies.** Every bank domain
is unreachable from this environment, so the authoritative PDF could not be
fetched to diff against. Each document was opened and checked to be the manual
its filename claims — right bank, right format, right service (cobrança, not
pagamentos) — but "genuine" is not "current".

**They are old.** The newest is Santander CNAB400 from October 2017; Santander's
own CNAB240 manual here is from **September 2009**. Bradesco's CNAB240 MPO is
version 02 and the bank publishes version 09. Where a newer official URL is
known it is recorded as `upstreamOfficial` in the manifest — including FEBRABAN
**V10.05 (05/11/2018)**, five minor versions ahead of the V09.1 we hold.

**None of them cover PIX.** PIX cobrança postdates all of these, so segmento
Y-01, formas 45/47 and the BR Code hybrid boleto — [EPIC-B #59](https://github.com/cnab/CNAB-SDK/issues/59) —
get nothing from this collection. That work still needs current documents.

**Sicoob is not really covered.** What we have is a spreadsheet from Sicoob
Cred-Acif, a regional cooperative, last saved in 2016 — not the official 756
manual. [#73](https://github.com/cnab/CNAB-SDK/issues/73) should not be closed
against it.

So: good enough to implement a bank's base layout and be checked by someone with
the current manual; **not** good enough to implement from and ship unreviewed.
A layout transcribed from a stale document produces files a bank rejects — or,
worse, accepts with the wrong values in them.

## What has been transcribed from them

37 records so far, across two batches:

| Issue | Records | Status |
| --- | --- | --- |
| [#70](https://github.com/cnab/CNAB-SDK/issues/70) | Itaú 341 CNAB240 (9) | ✅ closed |
| [#72](https://github.com/cnab/CNAB-SDK/issues/72) | Santander 033 CNAB400 (7) | ✅ closed |
| [#25](https://github.com/cnab/CNAB-SDK/issues/25) | Bradesco 237 CNAB400 remessa (4) | ✅ closed |
| [#26](https://github.com/cnab/CNAB-SDK/issues/26) | BB 001 CNAB400 remessa (4) | ✅ closed |
| [#71](https://github.com/cnab/CNAB-SDK/issues/71) | Bradesco 237 CNAB240 (9) | ⚠️ **open** — shipped as a draft, 2013 manual |
| [#24](https://github.com/cnab/CNAB-SDK/issues/24) | Caixa 104 CNAB400 remessa (4) | ⚠️ **open** — SIGCB shipped, issue asks for SICOB |
| [#27](https://github.com/cnab/CNAB-SDK/issues/27) | Santander 033 CNAB400 | ⚠️ **open** — records done, occurrence table missing |
| [#74](https://github.com/cnab/CNAB-SDK/issues/74) | Sicredi 748 | ❌ not started — CNAB400 manual only |
| [#73](https://github.com/cnab/CNAB-SDK/issues/73) | Sicoob 756 | ❌ blocked — regional spreadsheet, not the 756 manual |

Banrisul 041 and Safra 422 have manuals here but no issue; they arrived with
the batch.

## Verification against the manuals

Every `pos` pair in a record can be checked against the position column printed
in its manual. That is a different question from whether the build passes:
gapless coverage proves a record is well-*formed*, and only the manual says
whether it is *right*.

| Records | Fields | Not corroborated |
| --- | --- | --- |
| The 37 transcribed above | 869 | **1** — an Itaú typesetting artifact (`073  0 73`), confirmed by hand |
| Itaú 341 CNAB400 remessa | 65 | **0** |
| Itaú 341 CNAB400 retorno | 88 | **0** |
| BB 001 CNAB400 retorno | 93 | 6 |
| Bradesco 237 CNAB400 retorno | 70 | 3 |
| Caixa 104 CNAB400 retorno | 58 | 8 |

Itaú's CNAB400 remessa is worth singling out: it was authored by *copying the
generic layout* before any manual was reachable, and every one of its 65
positions turns out to match the real document.

"Not corroborated" is not the same as "wrong". Most are places where a record
merges or splits rows the manual prints differently, which changes structure
and naming but not bytes — Bradesco's `169 a 173 Agência Cobradora 005`, for
instance, is one field in the manual and agência + DV in the spec.

Two are worth acting on:

- **Caixa 104 CNAB400 retorno does not match the SIGCB manual** we hold. SIGCB
  puts `Uso da Empresa` at 32-56, `Modalidade` at 57-58 and `Nosso Número` at
  59-73; the shipped record has `uso_empresa` 38-62 and `nosso_numero` 63-73.
  So nosso número does not round-trip between our SIGCB remessa and this
  retorno. Tracked on [#24](https://github.com/cnab/CNAB-SDK/issues/24).
- **The remaining BB and Bradesco items have not been triaged one by one.**
  They are listed above rather than dismissed, because the one case that *was*
  chased down turned out to be a real bug: BB's retorno 169-173 was a filler
  field named `reservado_bb_d1` where the manual defines "Prefixo da agência
  recebedora" + DV, so every parsed BB retorno silently discarded which agency
  received the payment ([#97](https://github.com/cnab/CNAB-SDK/pull/97)).

Reproduce with the manuals fetched:

```
node tools/fetch-layouts.mjs
```

## Sources

- [glauberportella/cnab-layouts](https://github.com/glauberportella/cnab-layouts) `2c78c7d` — 12 documents, organised by bank/format/service
- [lucianoww/Layouts-Bancarios](https://github.com/lucianoww/Layouts-Bancarios) `e9cc9a8` — 4 documents
- [eduardordm/cnab240](https://github.com/eduardordm/cnab240) `c86ad20` — FEBRABAN V08.6
- [fhferreira/Sicoob](https://github.com/fhferreira/Sicoob) `a53bc59` — the Sicoob spreadsheet
