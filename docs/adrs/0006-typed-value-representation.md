# ADR 0006 — Typed value representation: decimal strings & ISO dates

- Status: Accepted
- Date: 2026-07

## Context

`CnabRecord.parse` returns a plain `{ [name]: string }` map of raw digit
strings, and `toLine` accepts the same shape. `FieldSpec` already carries
`decimals` (implied decimal places of `num_decimal` fields) and `dateFormat`
(`ddMMyyyy`, `ddMMyy`, `HHmmss`), but nothing converted raw tokens like
`"150000"` or `"15072026"` into typed values (issue #9).

The API is published to Node/.NET/Python/Java via jsii (ADR 0002), which
constrains the boundary to enums, struct interfaces, string-keyed maps,
primitives and arrays — no unions, overloads or tuples. The obvious "typed"
choice, IEEE-754 `number`, cannot represent monetary values exactly
(`0.1 + 0.2 !== 0.3`), and each target language has a different exact-decimal
type (`decimal.Decimal`, `System.Decimal`, `BigDecimal`) that jsii cannot map
to from a single TypeScript source.

## Decision

Typed values cross the API boundary as **strings with a fixed, documented
shape** — never floats:

- **Monetary/decimal values** are **decimal strings**: digits with a `.`
  separator and exactly the field's implied decimal places, e.g. raw
  `"150000"` with `decimals: 2` <-> `"1500.00"`, and `"0"` <-> `"0.00"`.
  Fields with `decimals: 0` pass through as plain integer strings.
- **Dates** are **ISO 8601** strings: `YYYY-MM-DD` for `ddMMyyyy`/`ddMMyy`
  fields, `HH:mm:ss` for `HHmmss` fields. An all-zeros raw token (CNAB's
  "unset" convention) reads as `''`, and `''` writes back as all zeros.
- Two-digit years (`ddMMyy`) use a **fixed century pivot at 70**: `yy >= 70`
  is `19yy`, otherwise `20yy`. The representable range is therefore
  1970-2069; writing a year outside that window throws.

The conversions live as helper methods on `CnabRecord` — `getDecimal`,
`setDecimal`, `getDateIso`, `setDateIso` — which read/write the *same*
`{ [name]: string }` map that `parse` returns and `toLine` consumes. The map
shape of `parse` is unchanged; converted access is opt-in per field. Callers
who need arithmetic parse the decimal string into their language's exact
decimal type at the edge.

`setDecimal` is lenient on input (missing fractional part is allowed, short
fractions are zero-padded) but rejects non-digit input and more fraction
digits than the field allows. `setDateIso` validates the ISO shape and basic
component ranges and rejects malformed input.

## Consequences

- Values stay **exact** (no float rounding of money), **jsii-safe** (plain
  strings) and **language-neutral** (every target has first-class string ->
  exact-decimal parsing).
- No arithmetic on the SDK side: callers convert at the boundary. This is
  accepted — the SDK's job is faithful representation, not accounting.
- The 70 pivot is an approximation forced by the `ddMMyy` legacy layouts;
  files with genuine pre-1970 dates would be misread, which is acceptable for
  boleto/cobrança data.
- Raw digit maps remain the interchange shape, so existing `parse`/`toLine`
  round-trips, goldens and the CLI are untouched.
