# Validation Record

Date: 2026-10-05. Runtimes: Node.js 24.20.0 locally and Node.js 26.8.1 on the server, both Linux.

## Passed

- 38 Node runtime/integration tests, with zero failures or skips.
- 4 Python client tests.
- Strict TypeScript consumer compilation for core, workflow and browser exports. Third-party declaration checking is skipped; application-facing calls are checked.
- Build, CLI syntax, both offline examples, real ML-DSA signing/verification and signed-report CLI behavior.
- Pipeline input/decision binding checked through the actual SDK local proving and signing methods. Licence, quota and storage services are isolated test doubles; this does not validate production entitlements.
- An eight-process budget contention test and a process-exit/restart recovery test against the file store.
- npm archive creation, required-file checks and export target validation.
- Clean offline dependency installation in an extracted package using the release lockfile and integrity-checked cache entries. Install scripts were disabled. Fifty packages installed; an uncached optional native accelerator was not required for import checks.
- All seven package entry points imported from that clean installation.
- The preserved 1.4.1 folder matches a fresh extraction of the original tarball byte for byte.
- Chromium verification of trusted ML-DSA signatures, untrusted-key rejection, tamper rejection, Node-free browser imports and summary rendering at mobile and desktop widths.
- Read-only SSH comparison against `/var/www/vhosts/Git/SDK`. The server's MCP helper and CLI routing were restored in the 2.0.0-beta.1 candidate. The server's HMAC-not-ZK clarification was preserved.
- Separate server installation at `/var/www/vhosts/Git/SDK-1.4.2`, with a matching upload checksum and a clean install of 51 dependencies. Build, all 38 runtime tests, all 4 Python tests and TypeScript checks also passed there before the local candidate was renamed to 2.0.0-beta.1.
- Server package checks passed after tightening the Python file allowlist, including repacking after Python tests without shipping bytecode caches.
- A subsequent clean local install also installed all 51 dependencies before the final prepack gate.

The initial local test runner used `--test-isolation=none` on Node 24 to obtain individual test results while the environment was restricted. Normal `npm test` passed locally and on the server with all 38 tests reported individually.

## Not Verified Live

- Live API licence/entitlement responses and production API compatibility beyond the existing request contracts.
- A complete UltraHonk proving run. Existing cryptography and circuits were retained rather than rewritten.
- Real x402 settlement, AP2 signed-mandate-provider conformance, Stripe billing, or payment processing. Tests use fixtures and callback contracts; no money was charged.
- A real external MCP server, A2A peer, n8n runtime or OpenTelemetry exporter.

## Provenance

Baseline package: `affixio@1.4.1`, downloaded from the npm registry before this build.

Tarball integrity:

```text
sha512-18O0LBNaFE3DlNj+foH1UoJ3yUDpvdHMJd9L5w9z8qnLJirHE0g8UBDSzXflJUsaJEoZbgIRyJDWnYBhejVevA==
```

New implementation source is in `src/runtime/`; `scripts/build.mjs` copies it to `dist/runtime/` and validates module imports and export paths. Existing 1.4.1 code remains in `dist/`, with scoped changes to payment limits, public type declarations, MCP configuration and the client version header. The public server distribution was compared and reconciled without copying operator state, secrets, backups or Git history.

No npm publication, website update or production API edit was performed. The candidate was uploaded to `/var/www/vhosts/Git/SDK-1.4.2`, not installed as a replacement for the live SDK. The original `/var/www/vhosts/Git/SDK` remains at 1.4.1.
