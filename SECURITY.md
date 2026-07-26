# Security Policy

## Reporting a vulnerability

Please report suspected vulnerabilities through
[GitHub Security Advisories](https://github.com/cnab/CNAB-SDK/security/advisories/new)
rather than a public issue, so a fix can be prepared before details are public.

Include what you have: affected version, a reproduction, and the impact you
believe it has. A partial report is worth more than a delayed one.

We aim to acknowledge within a few working days. If you have had no response in
a week, please open a public issue saying only that you are waiting on a
security response — no details.

## Supported versions

The SDK is **0.x** and pre-release. Only the latest release receives fixes;
there are no maintained release branches. See
[CHANGELOG.md](CHANGELOG.md) for what each version contains.

> **`v0.2.0` must not be used.** It was tagged on a commit whose manifests still
> said `0.1.0`, so every artifact attached to that release is a 0.1.0 build and
> does not contain the changes its notes describe. Use `v0.3.0` or later.

## What this software does and does not do

Useful context when judging impact:

- **No network access.** The engine parses and generates files. It opens no
  sockets, contacts no service and sends no telemetry.
- **No credential handling.** It does not authenticate to banks. Transmitting
  the files it produces is the caller's job.
- **It processes untrusted input by design.** A *retorno* file comes from a
  bank, but reaches you over channels you may not control, and CNAB is a
  fixed-width format with no integrity protection of its own. Parser robustness
  matters: crashes, unbounded memory growth, or pathological CPU on malformed
  input are all valid reports.
- **The `bindings/` and non-Node targets run an embedded Node process.** jsii
  starts `node` (overridable via `JSII_NODE`) to host the engine. A vulnerability
  in that runtime is inherited by the Python, Java and .NET bindings.

## Data correctness is a security concern here

This SDK writes files that move money. We treat **silent data corruption as a
security-class bug**, not merely a defect, because it is undetectable
downstream: a wrong value in a fixed-width field is still a syntactically valid
file that a bank will accept.

Two examples already fixed, to calibrate what we want reported:

- [#28](https://github.com/cnab/CNAB-SDK/issues/28) — `toLine` silently kept the
  *rightmost* digits of an oversized amount, turning one plausible value into a
  different plausible value that `validate()` still passed.
- The typed-value setters were inert in Python, Java and .NET, so a caller's
  amount was silently never written at all.

If you find something in that shape, report it here even if it is not
"exploitable" in the usual sense.

## Dependencies

`npm audit` runs against a small dependency surface, and Dependabot opens
updates weekly (`.github/dependabot.yml`). Advisories in build-time-only
dependencies are still worth reporting — `tools/build-spec.mjs` parses YAML from
the repository, so a malicious spec file in a pull request is a real path.
