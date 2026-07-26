/**
 * Boleto / cobrança helpers: check-digit algorithms (módulo 10 / módulo 11)
 * and the FEBRABAN 44-digit barcode + 47-digit linha digitável.
 *
 * Everything here is pure and stateless, and the API is jsii-safe: only
 * classes with static methods, struct interfaces with readonly primitive
 * props, and string/number/boolean parameters and returns.
 */

const BASE_FATOR_UTC = Date.UTC(1997, 9, 7); // 1997-10-07 (month is 0-based)
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function assertDigits(name: string, value: string, length?: number): void {
  if (!/^[0-9]+$/.test(value)) {
    throw new Error(`${name} must contain only digits (0-9), got "${value}"`);
  }
  if (length !== undefined && value.length !== length) {
    throw new Error(
      `${name} must be exactly ${length} digits long, got ${value.length} ("${value}")`
    );
  }
}

/** Weighted sum for módulo 11: weights 2..9 cycling right-to-left. */
function mod11Sum(digits: string): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    const digit = digits.charCodeAt(digits.length - 1 - i) - 48;
    const weight = 2 + (i % 8);
    sum += digit * weight;
  }
  return sum;
}

/**
 * Check-digit (dígito verificador, DV) algorithms used across CNAB and
 * boleto layouts.
 *
 * These are the generic building blocks: per-bank *nosso número* DV rules
 * vary by institution (each bank manual defines its own weights, ranges and
 * exception mapping) and are intentionally not implemented here — compose
 * them from `Modulo.mod10` / `Modulo.mod11` following the bank's manual.
 */
export class Modulo {
  /**
   * Módulo 10 (boleto / linha digitável field DV).
   *
   * Rule: weights 2 and 1 alternate right-to-left starting with 2. Each
   * digit is multiplied by its weight; when a product exceeds 9 its decimal
   * digits are summed (e.g. 12 → 1 + 2 = 3). The DV is the amount needed to
   * reach the next multiple of 10: `(10 - (sum % 10)) % 10`.
   *
   * @param digits numeric string (one or more digits)
   * @returns the check digit, 0-9
   */
  public static mod10(digits: string): number {
    assertDigits('digits', digits);
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
      const digit = digits.charCodeAt(digits.length - 1 - i) - 48;
      const weight = i % 2 === 0 ? 2 : 1;
      const product = digit * weight;
      // products are at most 18, so summing decimal digits == product - 9
      sum += product > 9 ? product - 9 : product;
    }
    return (10 - (sum % 10)) % 10;
  }

  /**
   * Generic CNAB módulo 11 (remessa/retorno field DVs).
   *
   * Rule: weights 2, 3, ..., 9 cycle right-to-left. The DV is
   * `11 - (sum % 11)`; when that result is 0, 10 or 11 the DV is 0.
   *
   * @param digits numeric string (one or more digits)
   * @returns the check digit, 0-9
   */
  public static mod11(digits: string): number {
    assertDigits('digits', digits);
    const dv = 11 - (mod11Sum(digits) % 11);
    return dv === 0 || dv === 10 || dv === 11 ? 0 : dv;
  }

  /**
   * FEBRABAN barcode módulo 11 variant (the general check digit — DAC — of
   * the 44-digit cobrança barcode, position 5).
   *
   * Rule: same weighting as `mod11` (weights 2..9 cycling right-to-left),
   * but the DV is `11 - (sum % 11)` mapped so that a result of 0, 1, 10 or
   * 11 becomes 1 (the barcode DV can never be 0).
   *
   * @param digits numeric string (one or more digits)
   * @returns the check digit, 1-9
   */
  public static mod11Boleto(digits: string): number {
    assertDigits('digits', digits);
    const dv = 11 - (mod11Sum(digits) % 11);
    return dv === 0 || dv === 1 || dv === 10 || dv === 11 ? 1 : dv;
  }

  private constructor() {}
}

/**
 * Parameters to compose a FEBRABAN cobrança barcode (44 digits).
 */
export interface BarcodeParams {
  /** Bank code, exactly 3 digits (e.g. `104`, `341`). */
  readonly bankCode: string;
  /** Currency code, exactly 1 digit (`9` = Real). */
  readonly currencyCode: string;
  /** Due date as ISO `YYYY-MM-DD`; encoded as the 4-digit fator de vencimento. */
  readonly dueDateIso: string;
  /** Amount in cents, digits only, up to 10 digits (zero-padded to 10). */
  readonly amountCents: string;
  /** Bank-specific free field (campo livre), exactly 25 digits. */
  readonly freeField: string;
}

/**
 * FEBRABAN cobrança barcode (44 digits) and linha digitável (47 digits)
 * helpers.
 *
 * Barcode layout (1-based positions):
 * - 1-3: bank code
 * - 4: currency code (`9`)
 * - 5: general check digit (DAC, `Modulo.mod11Boleto` over the other 43)
 * - 6-9: fator de vencimento (due-date factor)
 * - 10-19: amount in cents, zero-padded to 10
 * - 20-44: campo livre (25 bank-specific digits)
 */
export class Boleto {
  /**
   * Compute the 4-digit *fator de vencimento* for a due date.
   *
   * The factor counts days since the FEBRABAN base date 1997-10-07
   * (1997-10-08 → `0001`). After the counter reached 9999 on 2025-02-21,
   * FEBRABAN restarted it at 1000 on 2025-02-22; factors keep cycling in
   * the 1000-9999 window: `factor > 9999 → ((factor - 1000) % 9000) + 1000`.
   *
   * All arithmetic is done in UTC to avoid timezone off-by-one errors.
   *
   * @param dateIso due date as ISO `YYYY-MM-DD`
   * @returns the zero-padded 4-digit factor
   */
  public static fatorVencimento(dateIso: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateIso);
    if (!m) {
      throw new Error(`dateIso must be in YYYY-MM-DD format, got "${dateIso}"`);
    }
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const utc = Date.UTC(year, month - 1, day);
    const check = new Date(utc);
    if (
      check.getUTCFullYear() !== year ||
      check.getUTCMonth() !== month - 1 ||
      check.getUTCDate() !== day
    ) {
      throw new Error(`dateIso is not a valid calendar date: "${dateIso}"`);
    }
    let factor = Math.round((utc - BASE_FATOR_UTC) / MS_PER_DAY);
    if (factor < 1) {
      throw new Error(
        `dateIso must be 1997-10-08 or later (fator de vencimento >= 0001), got "${dateIso}"`
      );
    }
    if (factor > 9999) {
      factor = ((factor - 1000) % 9000) + 1000;
    }
    return String(factor).padStart(4, '0');
  }

  /**
   * Compose the 44-digit FEBRABAN cobrança barcode.
   *
   * The general check digit (position 5) is computed with
   * `Modulo.mod11Boleto` over the other 43 digits.
   *
   * @param options bank, currency, due date, amount and campo livre
   * @returns the 44-digit barcode
   */
  public static barcode(options: BarcodeParams): string {
    assertDigits('bankCode', options.bankCode, 3);
    assertDigits('currencyCode', options.currencyCode, 1);
    assertDigits('amountCents', options.amountCents);
    if (options.amountCents.length > 10) {
      throw new Error(
        `amountCents must have at most 10 digits, got ${options.amountCents.length}`
      );
    }
    assertDigits('freeField', options.freeField, 25);
    const fator = Boleto.fatorVencimento(options.dueDateIso);
    const amount = options.amountCents.padStart(10, '0');
    const withoutDv =
      options.bankCode + options.currencyCode + fator + amount + options.freeField;
    const dv = Modulo.mod11Boleto(withoutDv);
    return withoutDv.substring(0, 4) + String(dv) + withoutDv.substring(4);
  }

  /**
   * Compute the expected general check digit of a 44-digit barcode from its
   * other 43 digits (positions 1-4 and 6-44). Does not require the stored
   * DV (position 5) to be correct.
   *
   * @param barcode the 44-digit barcode
   * @returns the expected check digit, 1-9
   */
  public static barcodeCheckDigit(barcode: string): number {
    assertDigits('barcode', barcode, 44);
    return Modulo.mod11Boleto(barcode.substring(0, 4) + barcode.substring(5));
  }

  /**
   * Whether a string is a well-formed 44-digit cobrança barcode with a
   * correct general check digit.
   */
  public static isValidBarcode(barcode: string): boolean {
    if (!/^[0-9]{44}$/.test(barcode)) {
      return false;
    }
    return Number(barcode.charAt(4)) === Boleto.barcodeCheckDigit(barcode);
  }

  /**
   * Derive the 47-digit linha digitável from a valid 44-digit barcode,
   * returned as plain digits (no dots/spaces).
   *
   * Field layout (barcode positions are 1-based):
   * - field 1 (10 digits): barcode 1-4 + 20-24 + módulo-10 DV
   * - field 2 (11 digits): barcode 25-34 + módulo-10 DV
   * - field 3 (11 digits): barcode 35-44 + módulo-10 DV
   * - field 4 (1 digit): the barcode general DV (position 5)
   * - field 5 (14 digits): barcode 6-19 (fator de vencimento + amount)
   *
   * @param barcode the 44-digit barcode
   * @returns the 47-digit linha digitável
   */
  public static linhaDigitavel(barcode: string): string {
    assertDigits('barcode', barcode, 44);
    if (!Boleto.isValidBarcode(barcode)) {
      throw new Error(
        `barcode has an invalid general check digit: expected ${Boleto.barcodeCheckDigit(
          barcode
        )} at position 5, got ${barcode.charAt(4)}`
      );
    }
    const field1 = barcode.substring(0, 4) + barcode.substring(19, 24);
    const field2 = barcode.substring(24, 34);
    const field3 = barcode.substring(34, 44);
    return (
      field1 +
      String(Modulo.mod10(field1)) +
      field2 +
      String(Modulo.mod10(field2)) +
      field3 +
      String(Modulo.mod10(field3)) +
      barcode.charAt(4) +
      barcode.substring(5, 19)
    );
  }

  /**
   * The linha digitável formatted for humans with the standard mask
   * `#####.##### #####.###### #####.###### # ##############`.
   *
   * @param barcode the 44-digit barcode
   * @returns the formatted 47-digit linha digitável
   */
  public static linhaDigitavelFormatted(barcode: string): string {
    const linha = Boleto.linhaDigitavel(barcode);
    return (
      linha.substring(0, 5) +
      '.' +
      linha.substring(5, 10) +
      ' ' +
      linha.substring(10, 15) +
      '.' +
      linha.substring(15, 21) +
      ' ' +
      linha.substring(21, 26) +
      '.' +
      linha.substring(26, 32) +
      ' ' +
      linha.substring(32, 33) +
      ' ' +
      linha.substring(33, 47)
    );
  }

  /**
   * Parse a linha digitável (47 digits, optionally with dots and spaces)
   * back into the 44-digit barcode.
   *
   * Validates the three módulo-10 field DVs and the reconstructed barcode's
   * general módulo-11 DV; throws with a clear message on any mismatch.
   *
   * @param linha the linha digitável, plain or formatted
   * @returns the 44-digit barcode
   */
  public static parseLinhaDigitavel(linha: string): string {
    const digits = linha.replace(/[.\s]/g, '');
    if (!/^[0-9]{47}$/.test(digits)) {
      throw new Error(
        `linha digitável must have exactly 47 digits (dots/spaces allowed), got ${digits.length} digits`
      );
    }
    const field1 = digits.substring(0, 9);
    const dv1 = Number(digits.charAt(9));
    const field2 = digits.substring(10, 20);
    const dv2 = Number(digits.charAt(20));
    const field3 = digits.substring(21, 31);
    const dv3 = Number(digits.charAt(31));
    const dvGeral = digits.charAt(32);
    const fatorAmount = digits.substring(33, 47);
    if (Modulo.mod10(field1) !== dv1) {
      throw new Error(
        `linha digitável field 1 check digit mismatch: expected ${Modulo.mod10(field1)}, got ${dv1}`
      );
    }
    if (Modulo.mod10(field2) !== dv2) {
      throw new Error(
        `linha digitável field 2 check digit mismatch: expected ${Modulo.mod10(field2)}, got ${dv2}`
      );
    }
    if (Modulo.mod10(field3) !== dv3) {
      throw new Error(
        `linha digitável field 3 check digit mismatch: expected ${Modulo.mod10(field3)}, got ${dv3}`
      );
    }
    const barcode =
      field1.substring(0, 4) +
      dvGeral +
      fatorAmount +
      field1.substring(4) +
      field2 +
      field3;
    if (!Boleto.isValidBarcode(barcode)) {
      throw new Error(
        `linha digitável general check digit mismatch: expected ${Boleto.barcodeCheckDigit(
          barcode
        )}, got ${dvGeral}`
      );
    }
    return barcode;
  }

  private constructor() {}
}
