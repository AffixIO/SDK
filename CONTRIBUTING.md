# Contributing

This repository ships compiled JavaScript in `dist/`. TypeScript source is maintained privately by AffixIO.

## What we accept

- Documentation fixes (README, SECURITY, examples)
- Issue reports with reproduction steps
- Feature requests with concrete use cases

## What we do not accept

- Pull requests that modify `dist/` directly
- Changes that expose witness construction or circuit internals

## Development setup

```bash
git clone https://github.com/AffixIO/SDK.git
cd SDK
npm install
cp .env.example .env
npx affix-sdk health
```

## Code of conduct

Be direct, stay on topic, no harassment.

## Commercial access

For source access, custom circuits, or higher API limits: [affix-io.com](https://affix-io.com).
