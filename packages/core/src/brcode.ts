/**
 * BR Code — the PIX "copia e cola" payload.
 *
 * A BR Code is an EMVCo **Merchant-Presented Mode** payload: a flat sequence of
 * TLV triples (2-char id, 2-char zero-padded length, value), some of which nest
 * another TLV sequence, terminated by tag `63` whose value is a CRC-16 computed
 * over the entire string *including* the `6304` header of that final tag.
 *
 * Everything here is pure and stateless, and the API is jsii-safe: classes with
 * static methods, struct interfaces of readonly primitives, no unions, no
 * overloads (ADR 0002). Monetary amounts cross the boundary as decimal strings,
 * never floats (ADR 0006).
 *
 * Normative sources: Banco Central's BR Code manual and *Manual de Padrões para
 * Iniciação do Pix*; EMVCo's Merchant-Presented QR specification underneath.
 */

/** EMV tag ids used by a PIX payload. */
const TAG_FORMAT = '00';
const TAG_INITIATION = '01';
const TAG_MERCHANT_ACCOUNT = '26';
const TAG_MCC = '52';
const TAG_CURRENCY = '53';
const TAG_AMOUNT = '54';
const TAG_COUNTRY = '58';
const TAG_MERCHANT_NAME = '59';
const TAG_MERCHANT_CITY = '60';
const TAG_ADDITIONAL = '62';
const TAG_CRC = '63';

/** Nested ids inside tag 26 (merchant account information). */
const MAI_GUI = '00';
const MAI_KEY = '01';
const MAI_DESCRIPTION = '02';

/** Nested id inside tag 62 (additional data field). */
const ADD_TXID = '05';

const PIX_GUI = 'BR.GOV.BCB.PIX';
const CURRENCY_BRL = '986';
const COUNTRY_BR = 'BR';
const MCC_UNSPECIFIED = '0000';
/** BR Code's "no specific transaction id". */
const TXID_UNSPECIFIED = '***';

const MAX_MERCHANT_NAME = 25;
const MAX_MERCHANT_CITY = 15;
const MAX_TXID = 25;

/** Inputs for {@link BrCode.encode}. */
export interface BrCodeParams {
  /** PIX key: CPF/CNPJ, phone, e-mail, or a random (EVP) key. */
  readonly pixKey: string;
  /** Beneficiary name. Truncated to 25 characters after sanitising. */
  readonly merchantName: string;
  /** Beneficiary city. Truncated to 15 characters after sanitising. */
  readonly merchantCity: string;
  /**
   * Amount as a **decimal string** with at most two fraction digits
   * (`"10"`, `"10.5"`, `"1500.00"`). Omit or pass `""` to let the payer choose.
   */
  readonly amount?: string;
  /**
   * Transaction id. Defaults to `"***"`, which means "not specified".
   * Alphanumeric, at most 25 characters.
   */
  readonly txid?: string;
  /** Optional free-text description carried inside tag 26. */
  readonly description?: string;
  /**
   * `true` marks the code single-use (initiation method `12`). Reusable codes
   * omit the tag entirely, which is what the BACEN static examples do.
   */
  readonly singleUse?: boolean;
}

/** Decoded result of {@link BrCode.decode}. */
export interface BrCodeFields {
  readonly pixKey: string;
  readonly merchantName: string;
  readonly merchantCity: string;
  /** Empty string when the payload carries no amount. */
  readonly amount: string;
  readonly txid: string;
  /** Empty string when tag 26 carries no description. */
  readonly description: string;
  /** The 4 hex characters found in tag 63. */
  readonly crc: string;
  /** Whether the payload's own CRC matches a recomputation. */
  readonly crcValid: boolean;
}

/** id + value of one TLV triple. */
interface Tlv {
  readonly id: string;
  readonly value: string;
}

function tlv(id: string, value: string): string {
  const len = value.length;
  if (len > 99) {
    throw new Error(
      `BR Code field "${id}" is ${len} characters; EMV lengths are two digits (max 99)`
    );
  }
  return `${id}${len < 10 ? '0' : ''}${len}${value}`;
}

function parseTlvs(payload: string, where: string): Tlv[] {
  const out: Tlv[] = [];
  let i = 0;
  while (i < payload.length) {
    if (i + 4 > payload.length) {
      throw new Error(
        `malformed BR Code (${where}): truncated tag header at offset ${i}`
      );
    }
    const id = payload.substring(i, i + 2);
    const lenRaw = payload.substring(i + 2, i + 4);
    if (!/^[0-9]{2}$/.test(lenRaw)) {
      throw new Error(
        `malformed BR Code (${where}): length "${lenRaw}" of tag "${id}" is not two digits`
      );
    }
    const len = Number(lenRaw);
    const start = i + 4;
    if (start + len > payload.length) {
      throw new Error(
        `malformed BR Code (${where}): tag "${id}" declares ${len} characters but only ` +
          `${payload.length - start} remain`
      );
    }
    out.push({ id, value: payload.substring(start, start + len) });
    i = start + len;
  }
  return out;
}

function findValue(tlvs: Tlv[], id: string): string {
  for (const t of tlvs) {
    if (t.id === id) {
      return t.value;
    }
  }
  return '';
}

/**
 * Strip diacritics and reject anything still outside printable ASCII.
 *
 * BR Code is ASCII in practice: a payload carrying `JOSÉ` renders differently
 * across readers and some PSPs reject it. Accents are folded (`JOSÉ` -> `JOSE`)
 * rather than dropped, so the name stays readable.
 */
function sanitizeText(name: string, value: string, max: number): string {
  const folded = value.normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (!/^[\x20-\x7e]*$/.test(folded)) {
    throw new Error(
      `${name} contains characters that cannot be represented in a BR Code: "${value}"`
    );
  }
  return folded.substring(0, max).trim();
}

function normalizeAmount(amount: string): string {
  if (amount === '') {
    return '';
  }
  if (!/^[0-9]+(\.[0-9]{1,2})?$/.test(amount)) {
    throw new Error(
      `amount must be a decimal string with at most two fraction digits, got "${amount}" ` +
        `(CNAB and BR Code exchange exact decimal strings, never floats)`
    );
  }
  return amount;
}

/**
 * Build, parse and verify the PIX BR Code payload.
 *
 * ```ts
 * const payload = BrCode.encode({
 *   pixKey: 'fulano@example.com',
 *   merchantName: 'FULANO DE TAL',
 *   merchantCity: 'BRASILIA',
 *   amount: '10.00',
 * });
 * BrCode.isValid(payload);      // true
 * BrCode.decode(payload).pixKey // 'fulano@example.com'
 * ```
 */
export class BrCode {
  /**
   * CRC-16/CCITT-FALSE: polynomial `0x1021`, initial value `0xFFFF`, no input
   * or output reflection, no final XOR. Returned as four uppercase hex
   * characters, zero-padded.
   *
   * Canonical check: `crc16("123456789") === "29B1"`.
   */
  public static crc16(payload: string): string {
    let crc = 0xffff;
    for (let i = 0; i < payload.length; i++) {
      crc ^= (payload.charCodeAt(i) & 0xff) << 8;
      for (let bit = 0; bit < 8; bit++) {
        crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
      }
    }
    let hex = crc.toString(16).toUpperCase();
    while (hex.length < 4) {
      hex = `0${hex}`;
    }
    return hex;
  }

  /** Build a BR Code payload, CRC included. */
  public static encode(options: BrCodeParams): string {
    const pixKey = options.pixKey;
    if (pixKey === undefined || pixKey === '') {
      throw new Error('pixKey is required');
    }
    const key = sanitizeText('pixKey', pixKey, 77);
    const name = sanitizeText(
      'merchantName',
      options.merchantName || '',
      MAX_MERCHANT_NAME
    );
    const city = sanitizeText(
      'merchantCity',
      options.merchantCity || '',
      MAX_MERCHANT_CITY
    );
    if (name === '') {
      throw new Error('merchantName is required');
    }
    if (city === '') {
      throw new Error('merchantCity is required');
    }
    const amount = normalizeAmount(options.amount || '');
    const description = sanitizeText('description', options.description || '', 72);

    let txid = options.txid || TXID_UNSPECIFIED;
    txid = sanitizeText('txid', txid, MAX_TXID + 1);
    if (txid !== TXID_UNSPECIFIED && !/^[A-Za-z0-9]{1,25}$/.test(txid)) {
      throw new Error(
        `txid must be 1-25 alphanumeric characters or "***", got "${txid}"`
      );
    }

    let mai = tlv(MAI_GUI, PIX_GUI) + tlv(MAI_KEY, key);
    if (description !== '') {
      mai += tlv(MAI_DESCRIPTION, description);
    }

    let out = tlv(TAG_FORMAT, '01');
    if (options.singleUse === true) {
      out += tlv(TAG_INITIATION, '12');
    }
    out += tlv(TAG_MERCHANT_ACCOUNT, mai);
    out += tlv(TAG_MCC, MCC_UNSPECIFIED);
    out += tlv(TAG_CURRENCY, CURRENCY_BRL);
    if (amount !== '') {
      out += tlv(TAG_AMOUNT, amount);
    }
    out += tlv(TAG_COUNTRY, COUNTRY_BR);
    out += tlv(TAG_MERCHANT_NAME, name);
    out += tlv(TAG_MERCHANT_CITY, city);
    out += tlv(TAG_ADDITIONAL, tlv(ADD_TXID, txid));

    // The CRC covers the payload *including* the "6304" header of tag 63.
    const withCrcHeader = `${out}${TAG_CRC}04`;
    return withCrcHeader + BrCode.crc16(withCrcHeader);
  }

  /** Decode a BR Code payload into its fields, reporting CRC validity. */
  public static decode(payload: string): BrCodeFields {
    if (payload.length < 8) {
      throw new Error(`payload is too short to be a BR Code: "${payload}"`);
    }
    const tlvs = parseTlvs(payload, 'root');

    const crcTag = tlvs.length > 0 ? tlvs[tlvs.length - 1] : { id: '', value: '' };
    if (crcTag.id !== TAG_CRC) {
      throw new Error(
        `malformed BR Code: last tag is "${crcTag.id}", expected "${TAG_CRC}" (CRC)`
      );
    }

    const mai = parseTlvs(findValue(tlvs, TAG_MERCHANT_ACCOUNT), 'tag 26');
    const additional = parseTlvs(findValue(tlvs, TAG_ADDITIONAL), 'tag 62');

    return {
      pixKey: findValue(mai, MAI_KEY),
      description: findValue(mai, MAI_DESCRIPTION),
      merchantName: findValue(tlvs, TAG_MERCHANT_NAME),
      merchantCity: findValue(tlvs, TAG_MERCHANT_CITY),
      amount: findValue(tlvs, TAG_AMOUNT),
      txid: findValue(additional, ADD_TXID),
      crc: crcTag.value,
      crcValid: BrCode.isValid(payload),
    };
  }

  /**
   * `true` when the payload's trailing CRC matches a recomputation over
   * everything before it. Returns `false` rather than throwing for anything
   * that is not a well-formed payload — callers use this as a predicate.
   */
  public static isValid(payload: string): boolean {
    if (payload.length < 8) {
      return false;
    }
    const body = payload.substring(0, payload.length - 4);
    const found = payload.substring(payload.length - 4);
    if (!body.endsWith(`${TAG_CRC}04`)) {
      return false;
    }
    if (!/^[0-9A-Fa-f]{4}$/.test(found)) {
      return false;
    }
    return BrCode.crc16(body).toUpperCase() === found.toUpperCase();
  }
}
