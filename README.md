# Vallox — Gladys Assistant integration

External integration connecting [Gladys Assistant](https://gladysassistant.com) to **Vallox**
heat recovery ventilation units (MV controller: Vallox MV, ValloPlus, ValloMulti, TSK Multi, and
the Helios KWL units built on it), over the unit's **local** WebSocket API.

Built on the official
[JavaScript integration template](https://github.com/GladysAssistant/integration-template-js)
and the SDK
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).
Requires **Gladys 5.3.0 or later**.

User documentation: [English](./docs/en.md) · [Français](./docs/fr.md) · [Deutsch](./docs/de.md) ·
[Español](./docs/es.md).

## What it does

| Gladys surface        | What the integration provides                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Device (one per unit) | On/off, away, boost, fireplace switches; fan speed; 4 temperatures; humidity; CO2; per-profile fan speeds and supply air targets; boost time left; filter days left |
| Scene triggers        | `profile_changed`, `alarm_raised`, `filter_change_due`, `unit_unreachable`                                                                                          |
| Scene actions         | `set_profile`, `set_fan_speed`, `reset_filter_reminder`, `read_values`                                                                                              |
| Dashboard widget      | `ventilation`: live tiles, profile / heat exchanger / filter / alarms status, Home / Away / Boost buttons                                                           |
| Configuration actions | `test_connection`, `reset_filter_reminder`                                                                                                                          |
| Transport badge       | `local` while the unit answers, `unreachable` otherwise                                                                                                             |

Manifest: `transports: ["local"]` — there is no cloud channel, nothing leaves the LAN.

## How it talks to the unit

The unit's web interface talks to it over a WebSocket on `ws://<unit>/` (port 80), with binary
frames of 16-bit words (`src/vallox/protocol.js`):

- `READ_TABLES` (246) returns the whole register table in one frame;
- `WRITE_DATA` (249) writes `(address, value)` pairs.

Which register lives where (the data model) is read from the unit's own `js/bundle.js` (or
`js/vallox.js` on older firmwares); a built-in model, identical for the registers used here on
every known firmware (2.0.x, 3.x), takes over when that fails (`src/vallox/model.js`).

One short connection per request, one request at a time per unit, retried on network errors
(`src/vallox/client.js`). Node's built-in WebSocket client is enough: the only runtime dependency
is the Gladys SDK.

The wire format was documented by the
[`vallox_websocket_api`](https://github.com/yozik04/vallox_websocket_api) Python library
(LGPL-3.0) that Home Assistant uses; this is an independent JavaScript implementation, checked
against the same reference frames (`test/protocol.test.js`).

## Project structure

```
.
├─ index.js                        # entry point: SDK client, store, shutdown
├─ src/
│  ├─ app.js                       # every Gladys handler, registered before connect()
│  ├─ units.js                     # the units: reads, publications, scene triggers, poll timer
│  ├─ config.js                    # defaults (mirror of the manifest) + normalization
│  ├─ i18n.js                      # languages of user-facing text (en, fr, de, es)
│  ├─ devices/ventilation.js       # the Gladys device: features, states, commands
│  ├─ capabilities/
│  │  ├─ scenes.js                 # scene actions
│  │  ├─ widget.js                 # the "Vallox ventilation" dashboard widget
│  │  └─ actions.js                # Configuration screen buttons
│  └─ vallox/
│     ├─ protocol.js               # binary frames, checksum, temperature conversions
│     ├─ model.js                  # data model: register addresses and table layout
│     ├─ metrics.js                # raw registers -> snapshot (profile, alarms, filter…)
│     ├─ client.js                 # WebSocket client of one unit
│     └─ store.js                  # /data/units.json: units already met
├─ test/                           # node --test, SDK fake Gladys + in-memory Vallox unit
├─ docs/{en,fr,de,es}.md           # user documentation (re-hosted by Gladys)
├─ gladys-assistant-integration.json
├─ Dockerfile                      # node:24-alpine, non-root, /data only writable path
└─ .github/                        # CI, image build, release, GitHub releases, Dependabot
```

## Development

```bash
npm install
npm test
npm run lint
npm run format:check
npx github:GladysAssistant/integration-store .
```

Tests never touch the network: `test/helpers/fakeVallox.js` is an in-memory unit answering the
real frames, and `@gladysassistant/integration-sdk/testing` provides the fake Gladys.

To try it against a real unit, build the image and install it in Gladys in developer mode
(Integrations → Install an integration → Developer mode) with the manifest printed by the
**Build and publish image** workflow summary.

## Releases

Everything goes through GitHub Actions:

| Workflow              | Trigger                                   | What it does                                                                                   |
| --------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **CI**                | push on `main`, pull requests             | Prettier, ESLint, tests on Node 22 and 24; on pull requests: store checks and a Docker build   |
| **Release**           | Actions → Release → patch / minor / major | Bumps `package.json` + manifest (`version`, `docker_image`), rolls the changelog, tags, builds |
| **Build and publish** | `v*` tag, manual run, called by Release   | Multi-arch image (amd64 + arm64) on `ghcr.io/prohand/gladys-vallox`                            |
| **GitHub releases**   | push on `main`, called by Release         | One GitHub Release per `vX.Y.Z` tag, notes taken from `CHANGELOG.md`                           |

Never edit the versions by hand; add user-visible changes under `## [Unreleased]` in
[`CHANGELOG.md`](./CHANGELOG.md).

## Security

See [SECURITY.md](./SECURITY.md).

## License

Apache-2.0.
