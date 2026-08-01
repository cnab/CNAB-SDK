# Bank layout manuals

The record layouts in `packages/spec` have to come from somewhere, and until now
that provenance lived nowhere. This directory records it.

`MANIFEST.json` pins 18 documents by upstream repository, commit and sha256.
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
| — FEBRABAN | ✅ V09.1 + V08.6 | — | 19/10/2015 · 05/01/2012 |

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

## Which issues these unblock

| Issue | Bank / gap | Document |
| --- | --- | --- |
| [#70](https://github.com/cnab/CNAB-SDK/issues/70) | Itaú 341 CNAB240 (we have **zero** records) | ✅ Fev/2016 |
| [#71](https://github.com/cnab/CNAB-SDK/issues/71) | Bradesco 237 CNAB240 (we have **zero**) | ⚠️ 2013, v02 of v09 |
| [#72](https://github.com/cnab/CNAB-SDK/issues/72) / [#27](https://github.com/cnab/CNAB-SDK/issues/27) | Santander 033 CNAB400 (we have **zero**) | ✅ v2.17 Out/2017 |
| [#74](https://github.com/cnab/CNAB-SDK/issues/74) | Sicredi 748 | ⚠️ CNAB400 only |
| [#73](https://github.com/cnab/CNAB-SDK/issues/73) | Sicoob 756 | ❌ regional spreadsheet |
| — | 001 CNAB240 trailers, 104/237 CNAB400 remessa | ✅ |

Banrisul 041 and Safra 422 have no issue yet; they arrived with the batch.

## Sources

- [glauberportella/cnab-layouts](https://github.com/glauberportella/cnab-layouts) `2c78c7d` — 12 documents, organised by bank/format/service
- [lucianoww/Layouts-Bancarios](https://github.com/lucianoww/Layouts-Bancarios) `e9cc9a8` — 4 documents
- [eduardordm/cnab240](https://github.com/eduardordm/cnab240) `c86ad20` — FEBRABAN V08.6
- [fhferreira/Sicoob](https://github.com/fhferreira/Sicoob) `a53bc59` — the Sicoob spreadsheet
