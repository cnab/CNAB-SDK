---
'@cnab/core': minor
'@cnab/spec': minor
'@cnab/cli': minor
---

Add `CnabFile.parseToJson(content)` so large files are usable outside Node.

`parse` returns one `ParsedLine` per line and jsii marshals each one — with its
~40-key field map — across the kernel individually. A 200,000-line retorno is
200,000 crossings: ~280 s in Python, and the same in Java and .NET, which share
the kernel. In Node the cost is memory instead — the result retains ~6x the
input size (615 MB for a 76 MB file).

`parseToJson` returns the whole result as one JSON string, which the host
decodes with its own in-process parser. Fed a few thousand lines at a time — the
documented recipe, because the jsii boundary degrades sharply on large strings
in both directions — the same 200,000-line file takes **7.5 s in Python** and
peaks at **4 MB of Node heap**.

The output is an array of `ParsedLine`-shaped objects with camelCase keys and
values identical to `parse`. `parse` is unchanged and remains the Node path.
See ADR 0010 for the measurements, including the three rejected alternatives,
and `packages/core/README.md` for the documented limits.
