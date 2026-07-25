'use strict';
// Regenerate the committed public-API snapshot after an INTENTIONAL API change:
//   npm run build:jsii --workspace @cnab/core
//   node packages/core/test/generate-api-surface.cjs
// Review the resulting diff as carefully as a breaking-change review: every line
// here is a promise made to Node, .NET, Python and Java consumers.
const fs = require('node:fs');
const path = require('node:path');
const { readSurface } = require('./api-surface.cjs');

const out = path.resolve(__dirname, 'api-surface.json');
const surface = readSurface();
fs.writeFileSync(out, JSON.stringify(surface, null, 2) + '\n');

const types = Object.keys(surface).length;
const members = Object.values(surface).reduce((n, t) => n + t.members.length, 0);
console.log(`wrote ${out} — ${types} types, ${members} public members`);
