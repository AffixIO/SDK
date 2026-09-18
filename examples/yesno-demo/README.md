# AffixIO Yes/No Demo

Local demo for testing `simple_yesno` decisions with the [affixio](https://www.npmjs.com/package/affixio) npm SDK. Proofs run on your machine and report usage to Hub stats.

## Quick start

```bash
cd examples/yesno-demo     # from a clone of AffixIO/SDK
npm install                # installs the published affixio package
cp env.example .env        # paste your aio_live_... key from Hub
npm start
```

To run against the SDK build in this repo instead of the published package:

```bash
npm install ../..          # links the repo root (affixio) into this example
npm start
```

Open [http://127.0.0.1:3847](http://127.0.0.1:3847). Check usage at [hub.affix-io.com](https://hub.affix-io.com/).

## Requirements

- Node 20.19+ (Node 20 LTS recommended)
- An active **`aio_live_...`** licence key from Hub (trial or paid)
- Outbound access to `https://api.affix-io.com` for licence and quota

## Environment

Copy `env.example` to `.env`:

- `AFFIX_API_KEY` – required `aio_live_...` key from Hub
- `AFFIX_API_BASE` – default `https://api.affix-io.com`
- `AFFIX_LOCAL_HMAC_SECRET` – optional, for shared verification across machines
- `PORT` – default `3847`

Or store the key with:

```bash
npx affixio set-key --api-key aio_live_...
```

## Port already in use

```bash
fuser -k 3847/tcp
npm start
```

Or:

```bash
PORT=3848 npm start
```

## Node 24 / invalid package.json

Do not copy `node_modules` between machines. If you see `ERR_INVALID_PACKAGE_CONFIG` (for `unpipe`, `@noble/post-quantum`, or similar):

```bash
rm -rf node_modules package-lock.json
npm install
npm run fix
PORT=3848 npm start
```

Or:

```bash
npm run reinstall
npm start
```

Node 20 LTS is the more reliable runtime:

```bash
nvm install 20 && nvm use 20
rm -rf node_modules package-lock.json
npm install
npm start
```

## API

- `GET /api/health` – licence and quota snapshot
- `POST /api/prove` – body `{ "claim": "...", "required": "..." }`
- `POST /api/verify` – body `{ "proof": "..." }`

## SDK usage (same as the server)

```javascript
import { AffixSDK } from "affixio";

const sdk = new AffixSDK({
  apiKey: process.env.AFFIX_API_KEY,
  apiBase: process.env.AFFIX_API_BASE,
});

const result = await sdk.prove({
  mode: "auto",
  circuitId: "simple_yesno",
  credential: { /* ... */ },
  context: { required_claim_hash: "approved" },
});

const verified = await sdk.verifyLocal("simple_yesno", result.proof, {
  envelope: result.envelope,
});
```

Each `prove()` consumes quota and updates Hub stats when the licence key is valid.
