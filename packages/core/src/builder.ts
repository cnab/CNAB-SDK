/**
 * Whole-file CNAB generation: `CnabFileBuilder` assembles a complete
 * remessa/retorno file (header, lotes, details, trailers) and owns the
 * layout's control fields — lote numbering, per-lote record sequences and
 * record/lote counters — so callers only supply business values.
 *
 * Control fields are identified by NAME CONVENTION per layout (see ADR 0007);
 * a field is only auto-filled when the record actually has it, and
 * user-supplied values win over auto-computed counters/totals, EXCEPT pure
 * sequence counters, which the builder always owns.
 */

import { CnabRecord, CnabSpec } from './index';

/** Zero-based padding helper (numeric fields are zero-padded by `toLine`,
 * but we pass canonical padded strings so intent is explicit). */
function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

function hasField(rec: CnabRecord, name: string): boolean {
  for (const f of rec.spec.fields) {
    if (f.name === name) {
      return true;
    }
  }
  return false;
}

/** First name of `candidates` that exists on the record, or `''`. */
function firstField(rec: CnabRecord, candidates: string[]): string {
  for (const name of candidates) {
    if (hasField(rec, name)) {
      return name;
    }
  }
  return '';
}

function copyValues(values: { [name: string]: string }): {
  [name: string]: string;
} {
  const out: { [name: string]: string } = {};
  for (const key of Object.keys(values)) {
    out[key] = values[key];
  }
  return out;
}

function userSupplied(values: { [name: string]: string }, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(values, name);
}

/**
 * CNAB240 name variants of the detail-record sequence within a lote
 * (positions 9-13): `numero_sequencial_lote` on remessa segments (P/R/Q...),
 * `numero_sequencial_registro` / `numero_sequencial` on retorno segments
 * (U/W). Builder-owned (always overwritten).
 */
const CNAB240_DETAIL_SEQ_NAMES = [
  'numero_sequencial_lote',
  'numero_sequencial_registro',
  'numero_sequencial',
];

/** One queued detail line (record + user values). */
interface PendingDetail {
  readonly rec: CnabRecord;
  readonly values: { [name: string]: string };
}

/** One CNAB240 lote under construction. */
interface PendingLote {
  readonly headerValues: { [name: string]: string };
  readonly details: PendingDetail[];
  trailerValues: { [name: string]: string } | null;
}

/**
 * Builds a whole CNAB file (header + lotes/details + trailer), auto-computing
 * the layout's control fields. Terminal method is `toFileContent` (`build` is
 * a prohibited member name in jsii).
 *
 * CNAB240 usage: `setHeader`, then one or more `startLote` / `addDetail`* /
 * `endLote` cycles, then `toFileContent`.
 * CNAB400 usage: `setHeader`, `addDetail`*, `toFileContent` (no lotes).
 *
 * Every line is emitted through the **strict** `CnabRecord.toLine`: a value
 * that does not fit its field, or a non-digit value on a numeric field, aborts
 * `toFileContent` with an error naming the field instead of being silently
 * truncated or stripped. There is deliberately no lenient mode here — a whole
 * generated bank file must never contain quietly altered amounts. Callers that
 * need the legacy behaviour must build those lines themselves with
 * `CnabRecord.toLineWithOptions`.
 */
export class CnabFileBuilder {
  /**
   * Create a builder scoped to the records of one bank (and optional variant /
   * direction) — same record-key prefix logic as `CnabFile.forBank`.
   * `variant` and `direction` may be empty strings.
   */
  public static forBank(
    specJson: string,
    layout: string,
    bank: string,
    variant: string,
    direction: string
  ): CnabFileBuilder {
    if (layout !== 'cnab240' && layout !== 'cnab400') {
      throw new Error(`unknown layout: ${layout}`);
    }
    const spec = CnabSpec.fromJson(specJson);
    const prefix = variant
      ? `${layout}/${bank}/${variant}/`
      : `${layout}/${bank}/`;
    const byName: { [record: string]: CnabRecord } = {};
    for (const key of spec.recordKeys()) {
      if (!key.startsWith(prefix)) {
        continue;
      }
      const rec = spec.getRecord(key);
      const dir = rec.spec.direction;
      if (dir !== '' && direction !== '' && dir !== direction) {
        continue;
      }
      const name = rec.spec.record;
      const existing = byName[name];
      // On a name collision prefer the record whose direction matches exactly.
      if (
        !existing ||
        (direction !== '' &&
          dir === direction &&
          existing.spec.direction !== direction)
      ) {
        byName[name] = rec;
      }
    }
    if (Object.keys(byName).length === 0) {
      throw new Error(
        `no records found for scope ${prefix} (direction "${direction}")`
      );
    }
    return new CnabFileBuilder(layout, byName);
  }

  private readonly _layout: string;
  private readonly _byName: { [record: string]: CnabRecord };
  private _headerValues: { [name: string]: string };
  /** CNAB240 lotes (closed and open). */
  private readonly _lotes: PendingLote[];
  /** CNAB400 flat details. */
  private readonly _details: PendingDetail[];
  private _loteOpen: boolean;

  private constructor(
    layout: string,
    byName: { [record: string]: CnabRecord }
  ) {
    this._layout = layout;
    this._byName = byName;
    this._headerValues = {};
    this._lotes = [];
    this._details = [];
    this._loteOpen = false;
  }

  /**
   * Set the values for the `header_arquivo` record. (Named `withHeader`
   * rather than `setHeader` because jsii prohibits `setXxx` method names —
   * they conflict with Java property setters.)
   */
  public withHeader(values: { [name: string]: string }): void {
    this._headerValues = copyValues(values);
  }

  /**
   * CNAB240 only: begin a new lote with the given `header_lote` values.
   * Throws for CNAB400 (which has no lotes) and when a lote is already open.
   */
  public startLote(headerValues: { [name: string]: string }): void {
    if (this._layout !== 'cnab240') {
      throw new Error(`startLote is only available for cnab240 (layout is ${this._layout})`);
    }
    if (this._loteOpen) {
      throw new Error('a lote is already open: close it with endLote first');
    }
    this.record('header_lote'); // fail early when the scope has no header_lote
    this._lotes.push({
      headerValues: copyValues(headerValues),
      details: [],
      trailerValues: null,
    });
    this._loteOpen = true;
  }

  /**
   * Append a detail line. `recordName` is the record's short name in scope,
   * e.g. `detalhe_segmento_p` (CNAB240) or `detalhe` (CNAB400). Throws when
   * the name is unknown in this scope or (CNAB240) when no lote is open.
   */
  public addDetail(
    recordName: string,
    values: { [name: string]: string }
  ): void {
    const rec = this.record(recordName);
    const detail: PendingDetail = { rec, values: copyValues(values) };
    if (this._layout === 'cnab240') {
      if (!this._loteOpen) {
        throw new Error('no lote is open: call startLote before addDetail');
      }
      this._lotes[this._lotes.length - 1].details.push(detail);
    } else {
      this._details.push(detail);
    }
  }

  /**
   * CNAB240 only: close the open lote with the given `trailer_lote` values.
   * The lote's `qtde_registro_lote` (header_lote + details + trailer_lote) is
   * auto-computed unless supplied here.
   */
  public endLote(trailerValues: { [name: string]: string }): void {
    if (this._layout !== 'cnab240') {
      throw new Error(`endLote is only available for cnab240 (layout is ${this._layout})`);
    }
    if (!this._loteOpen) {
      throw new Error('no lote is open: call startLote before endLote');
    }
    this.record('trailer_lote'); // fail early when the scope has no trailer_lote
    this._lotes[this._lotes.length - 1].trailerValues =
      copyValues(trailerValues);
    this._loteOpen = false;
  }

  /**
   * Emit the whole file: header + lotes/details + `trailer_arquivo`, lines
   * joined with `\n` (no trailing newline). Control fields are auto-computed
   * per layout (see ADR 0007); user-supplied counter/total values win, pure
   * sequence counters are always builder-owned.
   */
  public toFileContent(trailerValues: { [name: string]: string }): string {
    if (this._loteOpen) {
      throw new Error('a lote is still open: close it with endLote before toFileContent');
    }
    return this._layout === 'cnab240'
      ? this.emit240(trailerValues)
      : this.emit400(trailerValues);
  }

  private emit240(trailerValues: { [name: string]: string }): string {
    const lines: string[] = [];

    const header = this.record('header_arquivo');
    const headerVals = copyValues(this._headerValues);
    if (hasField(header, 'lote_servico')) {
      headerVals['lote_servico'] = '0000'; // builder-owned
    }
    lines.push(header.toLine(headerVals));

    let totalRegistros = 1; // header_arquivo
    for (let i = 0; i < this._lotes.length; i++) {
      const lote = this._lotes[i];
      const loteNum = pad(i + 1, 4);

      const headerLote = this.record('header_lote');
      const hv = copyValues(lote.headerValues);
      if (hasField(headerLote, 'lote_servico')) {
        hv['lote_servico'] = loteNum; // builder-owned
      }
      lines.push(headerLote.toLine(hv));

      for (let d = 0; d < lote.details.length; d++) {
        const detail = lote.details[d];
        const dv = copyValues(detail.values);
        if (hasField(detail.rec, 'lote_servico')) {
          dv['lote_servico'] = loteNum; // builder-owned
        }
        const seqName = firstField(detail.rec, CNAB240_DETAIL_SEQ_NAMES);
        if (seqName !== '') {
          dv[seqName] = pad(d + 1, 5); // builder-owned
        }
        lines.push(detail.rec.toLine(dv));
      }

      const trailerLote = this.record('trailer_lote');
      const tv = copyValues(lote.trailerValues ?? {});
      if (hasField(trailerLote, 'lote_servico')) {
        tv['lote_servico'] = loteNum; // builder-owned
      }
      // header_lote + details + trailer_lote
      const qtdeLote = lote.details.length + 2;
      if (
        hasField(trailerLote, 'qtde_registro_lote') &&
        !userSupplied(tv, 'qtde_registro_lote')
      ) {
        tv['qtde_registro_lote'] = pad(qtdeLote, 6);
      }
      lines.push(trailerLote.toLine(tv));
      totalRegistros += qtdeLote;
    }

    const trailer = this.record('trailer_arquivo');
    const fv = copyValues(trailerValues);
    if (hasField(trailer, 'lote_servico')) {
      fv['lote_servico'] = '9999'; // builder-owned
    }
    if (hasField(trailer, 'qtde_lotes') && !userSupplied(fv, 'qtde_lotes')) {
      fv['qtde_lotes'] = pad(this._lotes.length, 6);
    }
    totalRegistros += 1; // trailer_arquivo itself
    if (
      hasField(trailer, 'qtde_registros') &&
      !userSupplied(fv, 'qtde_registros')
    ) {
      fv['qtde_registros'] = pad(totalRegistros, 6);
    }
    lines.push(trailer.toLine(fv));

    return lines.join('\n');
  }

  private emit400(trailerValues: { [name: string]: string }): string {
    const lines: string[] = [];
    let seq = 0;

    const emit = (rec: CnabRecord, values: { [name: string]: string }) => {
      seq += 1;
      const v = copyValues(values);
      if (hasField(rec, 'numero_sequencial')) {
        v['numero_sequencial'] = pad(seq, 6); // builder-owned
      }
      lines.push(rec.toLine(v));
    };

    emit(this.record('header_arquivo'), this._headerValues);
    for (const detail of this._details) {
      emit(detail.rec, detail.values);
    }
    emit(this.record('trailer_arquivo'), trailerValues);

    return lines.join('\n');
  }

  /** Resolve a record by short name in this scope, or throw. */
  private record(name: string): CnabRecord {
    const rec = this._byName[name];
    if (!rec) {
      throw new Error(
        `unknown record "${name}" in this scope (available: ${Object.keys(
          this._byName
        )
          .sort()
          .join(', ')})`
      );
    }
    return rec;
  }
}
