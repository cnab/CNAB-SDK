/**
 * @cnab/core — CNAB 240/400 parsing, building and validation engine.
 *
 * The public API is authored once here in jsii-compatible TypeScript and
 * published to Node/.NET/Python/Java via jsii (see docs/adr/0002). To stay
 * jsii-safe the boundary uses only enums, struct interfaces, maps and
 * primitives — no union/intersection types, no method overloads, and no
 * tuples (positions are exposed as `start`/`end` numbers).
 */

/** How a fixed-width field is typed and padded. */
export enum FieldType {
  /** Numeric: right-aligned, zero-padded. */
  NUM = 'num',
  /** Alphanumeric text: left-aligned, space-padded. */
  ALPHA = 'alpha',
  /** Numeric with implied decimal places (the separator is not stored). */
  NUM_DECIMAL = 'num_decimal',
}

/** Specification of a single positioned field within a record. */
export interface FieldSpec {
  /** Canonical field name (the key used by `parse`/`build`). */
  readonly name: string;
  /** 1-based start position, inclusive. */
  readonly start: number;
  /** 1-based end position, inclusive. */
  readonly end: number;
  /** Field type / padding behaviour. */
  readonly fieldType: FieldType;
  /** Number of implied decimal places (0 when not a decimal field). */
  readonly decimals: number;
  /** Language-neutral date format token (empty when not a date field). */
  readonly dateFormat: string;
  /** Default value applied by `build` when no value is supplied. */
  readonly defaultValue: string;
  /** Short human description. */
  readonly description: string;
}

/** Specification of a whole record (one full 240/400 line). */
export interface RecordSpec {
  /** Layout family, e.g. `cnab240` or `cnab400`. */
  readonly layout: string;
  /** Bank code, e.g. `104`. */
  readonly bank: string;
  /** Optional variant, e.g. `sigcb` (empty when none). */
  readonly variant: string;
  /** Optional direction, e.g. `remessa`/`retorno` (empty when none). */
  readonly direction: string;
  /** Record name, e.g. `header_arquivo`. */
  readonly record: string;
  /** Total line length (240 or 400). */
  readonly lineLength: number;
  /** All fields, ordered by position. */
  readonly fields: FieldSpec[];
}

/** Outcome of validating a line against a record spec. */
export interface ValidationResult {
  /** True when no problems were found. */
  readonly valid: boolean;
  /** Human-readable problems (empty when valid). */
  readonly errors: string[];
}

interface RawFieldJson {
  readonly name: string;
  readonly start: number;
  readonly end: number;
  readonly type: string;
  readonly decimals?: number;
  readonly dateFormat?: string;
  readonly default?: string;
  readonly description?: string;
}

function toFieldType(value: string): FieldType {
  switch (value) {
    case 'num':
      return FieldType.NUM;
    case 'alpha':
      return FieldType.ALPHA;
    case 'num_decimal':
      return FieldType.NUM_DECIMAL;
    default:
      throw new Error(`unknown field type: ${value}`);
  }
}

function size(field: FieldSpec): number {
  return field.end - field.start + 1;
}

/**
 * A single CNAB record spec with operations to `parse`, `build` and `validate`
 * one fixed-width line.
 */
export class CnabRecord {
  /**
   * Build a record from its compiled JSON (a single record node of
   * `packages/spec/dist/spec.json`).
   */
  public static fromJson(json: string): CnabRecord {
    const doc = JSON.parse(json) as {
      meta?: Record<string, unknown>;
      fields?: RawFieldJson[];
    };
    const meta = doc.meta ?? {};
    const fields: FieldSpec[] = (doc.fields ?? []).map((f) => ({
      name: f.name,
      start: f.start,
      end: f.end,
      fieldType: toFieldType(f.type),
      decimals: f.decimals ?? 0,
      dateFormat: f.dateFormat ?? '',
      defaultValue: f.default ?? '',
      description: f.description ?? '',
    }));
    const spec: RecordSpec = {
      layout: String(meta.layout ?? ''),
      bank: String(meta.bank ?? ''),
      variant: String(meta.variant ?? ''),
      direction: String(meta.direction ?? ''),
      record: String(meta.record ?? ''),
      lineLength: Number(meta.lineLength ?? 0),
      fields,
    };
    return new CnabRecord(spec);
  }

  private readonly _spec: RecordSpec;

  private constructor(spec: RecordSpec) {
    this._spec = spec;
  }

  /** The underlying record specification. */
  public get spec(): RecordSpec {
    return this._spec;
  }

  /**
   * Parse a fixed-width line into a map of field name -> value. Values are
   * normalized (alpha right-trimmed, numerics stripped of left padding) so that
   * `toLine(parse(line))` reproduces a well-formed line.
   */
  public parse(line: string): { [name: string]: string } {
    const out: { [name: string]: string } = {};
    for (const f of this._spec.fields) {
      const raw = line.substring(f.start - 1, f.end);
      out[f.name] = this.normalize(f, raw);
    }
    return out;
  }

  /**
   * Build a fixed-width line from a map of field name -> value. Missing fields
   * fall back to their default value. (Named `toLine` rather than `build`
   * because `build` is a prohibited member name in jsii.)
   */
  public toLine(values: { [name: string]: string }): string {
    let line = '';
    for (const f of this._spec.fields) {
      const provided = Object.prototype.hasOwnProperty.call(values, f.name)
        ? values[f.name]
        : f.defaultValue;
      line += this.format(f, provided ?? '');
    }
    return line;
  }

  /** Validate a line against this record spec. */
  public validate(line: string): ValidationResult {
    const errors: string[] = [];
    if (line.length !== this._spec.lineLength) {
      errors.push(
        `line length ${line.length} does not match expected ${this._spec.lineLength}`
      );
    }
    for (const f of this._spec.fields) {
      const raw = line.substring(f.start - 1, f.end);
      if (f.fieldType === FieldType.NUM || f.fieldType === FieldType.NUM_DECIMAL) {
        // numeric fields may be all blanks (unset) or digits
        if (!/^[0-9]*$/.test(raw.trim()) && raw.trim() !== '') {
          errors.push(`field "${f.name}" (${f.start}-${f.end}) is not numeric: "${raw}"`);
        }
      }
    }
    return { valid: errors.length === 0, errors };
  }

  private normalize(f: FieldSpec, raw: string): string {
    if (f.fieldType === FieldType.ALPHA) {
      return raw.replace(/\s+$/, '');
    }
    const stripped = raw.replace(/^0+/, '');
    return stripped === '' ? '0' : stripped;
  }

  private format(f: FieldSpec, value: string): string {
    const width = size(f);
    if (f.fieldType === FieldType.ALPHA) {
      const v = value.length > width ? value.substring(0, width) : value;
      return v.padEnd(width, ' ');
    }
    // numeric / numeric-with-decimals: digits only, right-aligned, zero-padded
    const digits = value.replace(/\D/g, '');
    const v = digits.length > width ? digits.substring(digits.length - width) : digits;
    return v.padStart(width, '0');
  }
}

interface RawCodeTableJson {
  readonly meta?: Record<string, unknown>;
  readonly codes?: Record<string, unknown>;
}

/** A compiled spec: a collection of named records (whole `spec.json`). */
export class CnabSpec {
  /** Load from the compiled `spec.json` content. */
  public static fromJson(json: string): CnabSpec {
    const doc = JSON.parse(json) as {
      records?: Record<string, unknown>;
      codeTables?: Record<string, RawCodeTableJson>;
    };
    const codeTables: { [key: string]: { [code: string]: string } } = {};
    for (const [key, table] of Object.entries(doc.codeTables ?? {})) {
      const codes: { [code: string]: string } = {};
      for (const [code, description] of Object.entries(table.codes ?? {})) {
        codes[code] = String(description);
      }
      codeTables[key] = codes;
    }
    return new CnabSpec(doc.records ?? {}, codeTables);
  }

  private readonly _records: Record<string, unknown>;
  private readonly _codeTables: { [key: string]: { [code: string]: string } };

  private constructor(
    records: Record<string, unknown>,
    codeTables: { [key: string]: { [code: string]: string } }
  ) {
    this._records = records;
    this._codeTables = codeTables;
  }

  /** All available record keys, e.g. `cnab240/104/sigcb/header_arquivo`. */
  public recordKeys(): string[] {
    return Object.keys(this._records);
  }

  /** Whether a record with the given key exists. */
  public hasRecord(key: string): boolean {
    return Object.prototype.hasOwnProperty.call(this._records, key);
  }

  /** Get a record by key. Throws if it does not exist. */
  public getRecord(key: string): CnabRecord {
    if (!this.hasRecord(key)) {
      throw new Error(`record not found: ${key}`);
    }
    return CnabRecord.fromJson(JSON.stringify(this._records[key]));
  }

  /** All available code-table keys, e.g. `cnab400/104/retorno/codigo_ocorrencia`. */
  public codeTableKeys(): string[] {
    return Object.keys(this._codeTables);
  }

  /** Whether a code table with the given key exists. */
  public hasCodeTable(key: string): boolean {
    return Object.prototype.hasOwnProperty.call(this._codeTables, key);
  }

  /** Get a code table (code -> description map) by key. Throws if it does not exist. */
  public getCodeTable(key: string): { [code: string]: string } {
    if (!this.hasCodeTable(key)) {
      throw new Error(`code table not found: ${key}`);
    }
    const out: { [code: string]: string } = {};
    for (const [code, description] of Object.entries(this._codeTables[key])) {
      out[code] = description;
    }
    return out;
  }

  /**
   * Look up a code's description in a table, or `''` when the code is unknown.
   * The code is normalized during lookup: tried as-is, then with leading zeros
   * stripped (legacy tables use unpadded keys like `"2"` while CNAB fields
   * carry `"02"`), then zero-padded to 2 digits.
   */
  public lookupCode(key: string, code: string): string {
    const table = this.getCodeTable(key);
    const candidates = [code];
    const stripped = code.replace(/^0+/, '');
    candidates.push(stripped === '' ? '0' : stripped);
    candidates.push(code.padStart(2, '0'));
    for (const candidate of candidates) {
      if (Object.prototype.hasOwnProperty.call(table, candidate)) {
        return table[candidate];
      }
    }
    return '';
  }
}

/** One parsed line of a whole CNAB file. */
export interface ParsedLine {
  /** Detected record key (empty when the line could not be classified). */
  readonly recordKey: string;
  /** The record-type discriminator value (CNAB240 pos 8 / CNAB400 pos 1). */
  readonly tipo: string;
  /** The segment code for CNAB240 detail lines (empty otherwise). */
  readonly segment: string;
  /** Parsed field values (empty when the line could not be classified). */
  readonly fields: { [name: string]: string };
}

/** The scope of a CNAB file inferred from its content (see `CnabFile.detectScope`). */
export interface DetectedScope {
  /** Detected layout family, `cnab240` or `cnab400`. */
  readonly layout: string;
  /** Detected bank code, e.g. `104`. */
  readonly bank: string;
  /** Detected variant, e.g. `sigcb` (empty when the bank has none). */
  readonly variant: string;
  /** Detected direction, `remessa` or `retorno`. */
  readonly direction: string;
}

/** Fixed discriminator positions per layout (1-based, inclusive). */
interface Detect {
  readonly tipoStart: number;
  readonly tipoEnd: number;
  readonly segStart: number;
  readonly segEnd: number;
}

const LAYOUT_DETECT: { [layout: string]: Detect } = {
  cnab240: { tipoStart: 8, tipoEnd: 8, segStart: 14, segEnd: 14 },
  cnab400: { tipoStart: 1, tipoEnd: 1, segStart: 0, segEnd: 0 },
};

/**
 * Parses a whole CNAB file (many lines of mixed record types) by detecting each
 * line's record type from its discriminator positions and dispatching to the
 * matching record spec. Scope it to one bank/variant/direction with `forBank`.
 */
export class CnabFile {
  /**
   * Build a file parser scoped to the records of one bank (and optional variant
   * / direction). `variant` and `direction` may be empty strings.
   */
  public static forBank(
    specJson: string,
    layout: string,
    bank: string,
    variant: string,
    direction: string
  ): CnabFile {
    const detect = LAYOUT_DETECT[layout];
    if (!detect) {
      throw new Error(`unknown layout: ${layout}`);
    }
    const spec = CnabSpec.fromJson(specJson);
    const prefix = variant
      ? `${layout}/${bank}/${variant}/`
      : `${layout}/${bank}/`;
    const byDisc: { [disc: string]: CnabRecord } = {};
    const keyByDisc: { [disc: string]: string } = {};
    for (const key of spec.recordKeys()) {
      if (!key.startsWith(prefix)) {
        continue;
      }
      const rec = spec.getRecord(key);
      const dir = rec.spec.direction;
      if (dir !== '' && direction !== '' && dir !== direction) {
        continue;
      }
      const disc = CnabFile.discriminator(rec, layout);
      if (disc === '') {
        continue;
      }
      byDisc[disc] = rec;
      keyByDisc[disc] = key;
    }
    return new CnabFile(detect, byDisc, keyByDisc);
  }

  /**
   * Infer a file's scope (layout / bank / variant / direction) from its first
   * line (the header_arquivo):
   *
   * - **layout** from the line length: 240 -> `cnab240`, 400 -> `cnab400`;
   * - **bank** from `codigo_banco`: positions 1-3 (CNAB240) or 77-79 (CNAB400);
   * - **direction** from the CNAB240 header position 143 (`1` remessa /
   *   `2` retorno), or for CNAB400 from header position 2 (`1` remessa /
   *   `2` retorno) corroborated by the `REMESSA`/`RETORNO` literal at 3-9;
   * - **variant** by trying every candidate variant of the detected bank and
   *   keeping the one whose records classify the most lines of the file.
   *
   * Throws an `Error` with a descriptive message when the content cannot be
   * detected: empty input, a first line that is not 240/400 characters long, a
   * position 1-3 / 77-79 value that is not a three-digit bank code, an
   * unrecognizable direction indicator, or a bank with no matching records in
   * the spec.
   */
  public static detectScope(specJson: string, content: string): DetectedScope {
    const lines = content.split(/\r?\n/).filter((l) => l.length > 0);
    if (lines.length === 0) {
      throw new Error('cannot detect CNAB scope: content has no non-empty lines');
    }
    const first = lines[0];

    let layout = '';
    if (first.length === 240) {
      layout = 'cnab240';
    } else if (first.length === 400) {
      layout = 'cnab400';
    } else {
      throw new Error(
        `cannot detect CNAB layout: first line is ${first.length} characters long (expected 240 or 400)`
      );
    }

    const bank =
      layout === 'cnab240' ? first.substring(0, 3) : first.substring(76, 79);
    if (!/^[0-9]{3}$/.test(bank)) {
      throw new Error(
        `cannot detect bank: "${bank}" at positions ${
          layout === 'cnab240' ? '1-3' : '77-79'
        } is not a three-digit bank code`
      );
    }

    let direction = '';
    if (layout === 'cnab240') {
      const code = first.substring(142, 143);
      if (code === '1') {
        direction = 'remessa';
      } else if (code === '2') {
        direction = 'retorno';
      } else {
        throw new Error(
          `cannot detect direction: CNAB240 header position 143 is "${code}" (expected "1" remessa or "2" retorno)`
        );
      }
    } else {
      const tipo = first.substring(0, 1);
      const operacao = first.substring(1, 2);
      const literal = first.substring(2, 9);
      if (tipo !== '0') {
        throw new Error(
          `cannot detect direction: CNAB400 first line is not a header (position 1 is "${tipo}", expected "0")`
        );
      }
      if (operacao === '2' || literal === 'RETORNO') {
        direction = 'retorno';
      } else if (operacao === '1' || literal === 'REMESSA') {
        direction = 'remessa';
      } else {
        throw new Error(
          `cannot detect direction: CNAB400 header position 2 is "${operacao}" and positions 3-9 are "${literal}" (expected "1"/REMESSA or "2"/RETORNO)`
        );
      }
    }

    // Candidate variants: every distinct variant of this bank/layout that has
    // at least one record usable for the detected direction.
    const spec = CnabSpec.fromJson(specJson);
    const variants: string[] = [];
    for (const key of spec.recordKeys()) {
      const rs = spec.getRecord(key).spec;
      if (rs.layout !== layout || rs.bank !== bank) {
        continue;
      }
      if (rs.direction !== '' && rs.direction !== direction) {
        continue;
      }
      if (variants.indexOf(rs.variant) === -1) {
        variants.push(rs.variant);
      }
    }
    if (variants.length === 0) {
      throw new Error(
        `cannot detect scope: no ${layout} ${direction} records for bank "${bank}" in the spec`
      );
    }

    variants.sort();
    let variant = variants[0];
    if (variants.length > 1) {
      let bestScore = -1;
      for (const candidate of variants) {
        const score = CnabFile.classifiedLineCount(
          spec,
          layout,
          bank,
          candidate,
          direction,
          lines
        );
        if (score > bestScore) {
          bestScore = score;
          variant = candidate;
        }
      }
    }

    return { layout, bank, variant, direction };
  }

  /**
   * Convenience: detect the file's scope with `detectScope` and return a
   * `CnabFile` parser scoped to it. Throws the same errors as `detectScope`
   * when the content cannot be identified.
   */
  public static detect(specJson: string, content: string): CnabFile {
    const scope = CnabFile.detectScope(specJson, content);
    return CnabFile.forBank(
      specJson,
      scope.layout,
      scope.bank,
      scope.variant,
      scope.direction
    );
  }

  /**
   * How many of the given lines are classifiable by the records of exactly
   * this scope (unlike `forBank`, the variant must match exactly — an empty
   * variant does not absorb the records of named variants). Used by
   * `detectScope` to rank candidate variants.
   */
  private static classifiedLineCount(
    spec: CnabSpec,
    layout: string,
    bank: string,
    variant: string,
    direction: string,
    lines: string[]
  ): number {
    const detect = LAYOUT_DETECT[layout];
    const byDisc: { [disc: string]: boolean } = {};
    for (const key of spec.recordKeys()) {
      const rec = spec.getRecord(key);
      const m = rec.spec;
      if (m.layout !== layout || m.bank !== bank || m.variant !== variant) {
        continue;
      }
      if (m.direction !== '' && m.direction !== direction) {
        continue;
      }
      const disc = CnabFile.discriminator(rec, layout);
      if (disc !== '') {
        byDisc[disc] = true;
      }
    }
    let score = 0;
    for (const line of lines) {
      const tipo = line.substring(detect.tipoStart - 1, detect.tipoEnd);
      let segment = '';
      if (detect.segEnd > 0) {
        segment = line.substring(detect.segStart - 1, detect.segEnd);
      }
      if (byDisc[`${tipo}|${segment}`] || (segment !== '' && byDisc[`${tipo}|`])) {
        score += 1;
      }
    }
    return score;
  }

  private static discriminator(rec: CnabRecord, layout: string): string {
    // CNAB240 uses `tipo_registro`; CNAB400 uses `tipo_de_registro` (retorno)
    // or `tipo_registro` (remessa).
    const tipoNames =
      layout === 'cnab240' ? ['tipo_registro'] : ['tipo_de_registro', 'tipo_registro'];
    let tipo = '';
    let segment = '';
    for (const f of rec.spec.fields) {
      if (tipoNames.indexOf(f.name) !== -1 && f.defaultValue !== '') {
        tipo = f.defaultValue;
      }
      if (layout === 'cnab240' && f.name === 'codigo_segmento') {
        segment = f.defaultValue;
      }
    }
    if (tipo === '') {
      return '';
    }
    return `${tipo}|${segment}`;
  }

  private readonly _detect: Detect;
  private readonly _byDisc: { [disc: string]: CnabRecord };
  private readonly _keyByDisc: { [disc: string]: string };

  private constructor(
    detect: Detect,
    byDisc: { [disc: string]: CnabRecord },
    keyByDisc: { [disc: string]: string }
  ) {
    this._detect = detect;
    this._byDisc = byDisc;
    this._keyByDisc = keyByDisc;
  }

  /** Parse a whole file's content into one `ParsedLine` per non-empty line. */
  public parse(content: string): ParsedLine[] {
    const out: ParsedLine[] = [];
    for (const line of content.split(/\r?\n/)) {
      if (line.length === 0) {
        continue;
      }
      const tipo = line.substring(this._detect.tipoStart - 1, this._detect.tipoEnd);
      let segment = '';
      if (this._detect.segEnd > 0) {
        segment = line.substring(this._detect.segStart - 1, this._detect.segEnd);
      }
      let disc = `${tipo}|${segment}`;
      let rec = this._byDisc[disc];
      if (!rec && segment !== '') {
        disc = `${tipo}|`;
        rec = this._byDisc[disc];
      }
      if (!rec) {
        out.push({ recordKey: '', tipo, segment, fields: {} });
        continue;
      }
      out.push({ recordKey: this._keyByDisc[disc], tipo, segment, fields: rec.parse(line) });
    }
    return out;
  }
}

export * from './boleto';
export * from './builder';
