# Contributing

`dist/` is the published build. `npm test` runs `tests/*.test.mjs` against it.

## Development setup

```bash
git clone https://github.com/AffixIO/SDK.git
cd SDK
npm install
npm test
```

Requires Node.js 20+.

## What we accept

- Fixes with a regression test in `tests/`
- New or fixed examples (they must run with `node`; say in the PR if one needs an external key)
- Documentation (README, SECURITY, examples)
- Issue reports with reproduction steps

Sign off commits (`git commit -s`). Security issues go to SECURITY.md, not public issues.

## Code of conduct

Be direct, stay on topic, no harassment.

## Commercial access

For custom circuits or higher API limits: [affix-io.com](https://affix-io.com).
