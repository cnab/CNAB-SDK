# bindings/ — per-language unit tests

Unit suites that run against the **generated language bindings**, not against
the TypeScript source. They are the only thing in this repo that tests what a
PyPI / Maven Central / NuGet consumer actually receives.

| directory | language | runner | run in CI by |
| --- | --- | --- | --- |
| `python/` | Python 3.11 | pytest | `bindings (python)` |
| `java/`   | Java 17     | JUnit 5 + Maven Surefire | `bindings (java)` |
| `dotnet/` | .NET 8      | xUnit | `bindings (dotnet)` |

Go has no suite because there is no Go target configured yet — see #41.

## Why these exist

`npm test` proves the **engine** is correct. It cannot prove the **projection**
is correct, and those are different things.

The case that motivated the suites: `CnabRecord.setDecimal` and `setDateIso`
returned `void` and mutated the value map in place. That works in Node, where
objects are passed by reference. jsii marshals maps **by value**, so in
Python/Java/.NET the mutation happened on a copy that was immediately discarded
— the two helpers were **completely inert in three of the four languages the SDK
ships**, and returned no value the caller could use instead.

Every one of the 185 Node tests passed throughout. No amount of Node testing
could have found it; only executing the generated binding could. The methods now
return the updated map (ADR 0006), and each suite pins that with an explicit
"does not mutate its input" test.

Other things only these suites can catch: naming drift in the projections
(`snake_case` / `camelCase` / `PascalCase`), struct construction (Python kwargs,
Java `Builder`, C# object initialisers), enum projection, `number` → `Number` /
`double`, and whether exceptions cross the runtime boundary at all.

## Keeping them honest

The assertions deliberately mirror `packages/core/test/*.js`. When you change
engine behaviour, change all four or you will get a red matrix — that is the
point. A binding suite that drifts into testing less than Node is not a safety
net.

## Running locally

All three need the binding generated first:

```bash
npm run build:spec
npm run build:jsii --workspace @cnab/core
cd packages/core && npx jsii-pacmak --targets python --targets java --targets dotnet
```

```bash
# python
python -m venv /tmp/venv
/tmp/venv/bin/pip install pytest packages/core/dist/python/*.whl
/tmp/venv/bin/python -m pytest bindings/python -v

# java  (V = the version in packages/core/package.json)
V=0.1.0; D=packages/core/dist/java/org/cnab/cnab-core/$V
mvn -q install:install-file -Dfile=$D/cnab-core-$V.jar -DpomFile=$D/cnab-core-$V.pom
mvn -f bindings/java/pom.xml -Dcnab.version=$V test

# dotnet
dotnet nuget add source "$(pwd)/packages/core/dist/dotnet" --name cnab-local
dotnet test bindings/dotnet/Cnab.Core.BindingTests.csproj
```

`jsii-pacmak --targets dotnet` needs the .NET SDK to build the package; add
`--code-only` to emit C# sources without compiling, which is enough to check
generated names.
