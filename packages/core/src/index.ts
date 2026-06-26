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

/** A compiled spec: a collection of named records (whole `spec.json`). */
export class CnabSpec {
  /** Load from the compiled `spec.json` content. */
  public static fromJson(json: string): CnabSpec {
    const doc = JSON.parse(json) as { records?: Record<string, unknown> };
    return new CnabSpec(doc.records ?? {});
  }

  private readonly _records: Record<string, unknown>;

  private constructor(records: Record<string, unknown>) {
    this._records = records;
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
}
