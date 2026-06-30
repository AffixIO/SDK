# Security policy

## Supported versions

| Version | Supported |
|---|---|
| 2.x | Yes |

## Reporting a vulnerability

Email security@affix-io.com with:

- Description of the issue
- Steps to reproduce
- Impact assessment (confidentiality, integrity, availability)
- Proof-of-concept if available

Do not open public GitHub issues for security reports.

We aim to acknowledge reports within 72 hours.

## Scope

In scope:

- This SDK package (`dist/`, CLI, local storage)
- Credential handling and offline queue behaviour
- TLS certificate pinning in `certs/`

Out of scope:

- The AffixIO API infrastructure (report separately)
- Third-party proving backends (Noir, Barretenberg, noble-post-quantum)

## Safe defaults

- Never commit `.env` with production API keys
- Use commercial keys for production workloads
- The public-tier key is rate-limited (6 req/sec per IP)
