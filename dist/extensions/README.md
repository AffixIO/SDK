# AffixIO feature pack (protected)

Obfuscated/minified first-party modules shipped with affixio ≥1.4.0.
Clear feature source is not included in the deployed tree.

Import: `import { verifySignedRoot, runDoctor } from "affixio/extensions"`
Also: `affixio/sth`, `affixio/offline`

CLI: `affix-sdk-ext doctor` or `affix-sdk doctor` / `affixio doctor`

API key policy: Affix API keys are ONLY for heartbeats and proof counts.
Core verify/crypto features work offline with provided artifacts + public keys.
