'use strict';
// Reads the jsii assembly (.jsii) and reduces it to a stable, human-readable
// description of the PUBLIC, multi-language API surface.
//
// Why the assembly and not runtime introspection: TypeScript `private` is
// erased at runtime, so `require('../lib')` also exposes internals like
// `format` or `discriminator`. The assembly contains exactly what jsii exports
// to Node/.NET/Python/Java — i.e. the contract we must not break by accident.
const fs = require('node:fs');
const path = require('node:path');

const ASSEMBLY = path.resolve(__dirname, '../.jsii');

/** Render a jsii type reference as a short, stable string. */
function typeRef(t) {
  if (!t) return 'void';
  if (t.primitive) return t.primitive;
  if (t.fqn) return t.fqn.split('.').pop();
  if (t.collection) {
    const kind = t.collection.kind === 'map' ? 'map' : 'array';
    return `${kind}<${typeRef(t.collection.elementtype)}>`;
  }
  if (t.union) return t.union.types.map(typeRef).join('|'); // jsii rejects these
  return 'unknown';
}

function member(m) {
  const params = (m.parameters || [])
    .map((p) => `${p.name}: ${typeRef(p.type)}${p.optional ? '?' : ''}`)
    .join(', ');
  const ret = m.returns ? typeRef(m.returns.type) : 'void';
  return `${m.static ? 'static ' : ''}${m.name}(${params}): ${ret}`;
}

function property(p) {
  return `${p.static ? 'static ' : ''}${p.name}: ${typeRef(p.type)}${
    p.immutable ? ' readonly' : ''
  }${p.optional ? ' optional' : ''}`;
}

/**
 * The public surface as `{ [shortTypeName]: { kind, base?, members: string[] } }`.
 * Members are sorted so the snapshot only changes when the API really changes.
 */
function readSurface() {
  if (!fs.existsSync(ASSEMBLY)) {
    throw new Error(
      `jsii assembly not found at ${ASSEMBLY} — run \`npm run build:jsii --workspace @cnab/core\``
    );
  }
  const assembly = JSON.parse(fs.readFileSync(ASSEMBLY, 'utf8'));
  const surface = {};
  for (const [fqn, type] of Object.entries(assembly.types || {})) {
    const name = fqn.split('.').pop();
    const members = [
      ...(type.methods || []).map(member),
      ...(type.properties || []).map(property),
      ...(type.members || []).map((m) => `enum ${m.name}`), // enum values
    ].sort();
    const entry = { kind: type.kind, members };
    if (type.base) entry.base = type.base.split('.').pop();
    surface[name] = entry;
  }
  return surface;
}

module.exports = { readSurface, ASSEMBLY };
