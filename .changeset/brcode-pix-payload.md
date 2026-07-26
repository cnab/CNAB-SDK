---
"@cnab/core": minor
"@cnab/spec": minor
"@cnab/cli": minor
---

Add `BrCode` — generate, parse and verify the PIX "copia e cola" payload.

PIX was absent from the SDK entirely, which in 2026 is a disqualifier: the
hybrid boleto is the default cobrança product at every major Brazilian bank.
This is the self-contained half of that work (#69, part of #59) — no spec
changes, pure engine.

```ts
const payload = BrCode.encode({
  pixKey: 'fulano@example.com',
  merchantName: 'FULANO DE TAL',
  merchantCity: 'BRASILIA',
  amount: '10.00',          // decimal string, never a float (ADR 0006)
});
BrCode.isValid(payload);              // true
BrCode.decode(payload).pixKey;        // 'fulano@example.com'
```

`BrCode.crc16` implements CRC-16/CCITT-FALSE and is pinned to the canonical
`"123456789" -> 29B1` check value, plus a cross-check against an independent
table-driven implementation over 2000 inputs. A wrong CRC yields a QR that scans
and is then rejected by the bank — the same undetectable-until-production
failure class as the old `toLine` truncation.

Accented names are folded to ASCII (`JOSÉ` -> `JOSE`) rather than emitted raw.
Covered by the Python, Java and .NET binding suites as well as the Node tests.
