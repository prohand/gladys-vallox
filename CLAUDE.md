# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human contributors.

## What this is

A Gladys Assistant **external integration** (Node 22+, ESM, no build step, one runtime
dependency: `@gladysassistant/integration-sdk`) for **Vallox** heat recovery ventilation units
with the MV controller (Vallox MV, ValloPlus, ValloMulti, TSK Multi, Helios KWL). It talks to the
unit over its **local** WebSocket API (`ws://<unit>/`, port 80) — manifest `transports: ["local"]`,
no cloud. Requires Gladys 5.3+ (manifest `keywords`). Started from the official JavaScript
template; workflows mirror `prohand/gladys-devmel`.

## Commands

```bash
npm install
npm test                                    # node --test (built-in runner)
node --test test/app.test.js                # one file
node --test --test-name-pattern "widget"    # tests whose name matches
npm run lint                                # eslint .
npm run format:check                        # prettier --check . (CI gate)
npm run format                              # prettier --write .
npx github:GladysAssistant/integration-store .   # store admission checks
```

CI runs `format:check`, `lint`, `test` on Node 22 and 24, plus the store checks and a Docker
build on pull requests: run the three commands before pushing.

## Architecture

```
index.js                     entry: SDK client, UnitStore, shutdown
src/app.js                   every Gladys handler (registerHandlers), no Vallox logic
src/units.js                 Units: reads every unit, publishes devices/states/transports/status,
                             fires scene triggers on transitions, nudges the widget, poll timer
src/devices/ventilation.js   features (keys, categories, bounds), states, command -> registers
src/capabilities/            scenes.js (scene actions), widget.js, actions.js (config buttons)
src/vallox/protocol.js       frames: [length, command, payload…, checksum] LE; answers BE
src/vallox/model.js          register addresses + table layout (from js/bundle.js, or built-in)
src/vallox/metrics.js        raw registers -> snapshot (profile, temperatures, alarms, filter…)
src/vallox/client.js         one unit: WebSocket request queue, retries, write allowlist
src/vallox/store.js          /data/units.json: identity of the units already met
test/helpers/fakeVallox.js   in-memory unit answering the real frames
```

### Invariants worth knowing

- **External ids are forever.** A unit's device is `gladys.externalIds('vallox', <unit UUID>)`,
  never the IP address (DHCP). Feature keys (`boost`, `home-fan-speed`…), trigger, scene action,
  action and widget keys (and widget button keys `set_home`/`set_away`/`set_boost`) are stored
  by users: never rename them.
- **Temperatures** are hundredths of a kelvin on the wire (`toCelsius` / `toKelvin`, rounded to
  the tenth like the unit's UI). 0 means "no sensor"; 0xFFFF means "no value", except in the
  profile timers where it means "no time limit".
- **Profile** is computed: a running boost / fireplace / extra timer wins over `A_CYC_STATE`
  (0 home, 1 away). `A_CYC_MODE` 5 is "stopped".
- **Writes go through an allowlist** (`WRITABLE` in client.js): never widen it to installer
  settings.
- **One request at a time per unit**, one short WebSocket per request: the unit serves few
  connections.
- **Triggers fire on transitions only**, never on the first read after startup. Orders given by
  Gladys are remembered (`ownOrder`, 2 min) so their own profile change never fires
  `profile_changed` (no loop through a scene). A unit is unreachable after 2 failed reads.
- **Polling** is the integration's own timer (`poll_frequency`, seconds); devices are published
  with `should_poll: false`. Gladys' `poll_frequency` would be milliseconds from a fixed enum.
- **Widget budget**: ≤ 8 components, unique button action keys — `validateWidgetContent` in
  the tests must return `[]`.
- **Every feature declares `min`/`max`** (NOT NULL in Gladys).
- The container rootfs is read-only: write only under `/data` (`DATA_DIR` in tests).

## Rules

- **Versions belong to the Release workflow** (Actions → Release). Never edit `version` in
  `package.json` or the manifest, nor the `docker_image` tag, by hand.
  `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`). Never write a version
  heading: the Release workflow moves the section, and it becomes the GitHub Release notes.
- **Manifest.** Every text is `{ en, fr, de, es }` (labels, descriptions, placeholders); the
  catalog `description` holds 10 to 100 characters per language. `test/manifest.test.js` ties
  the manifest to the code (handlers, trigger keys, profile options, defaults, bounds): change
  both sides together.
- **User-facing text** is in English, French, German and Spanish: action messages, connection
  status, widget texts (`src/i18n.js`), and `docs/en.md`, `docs/fr.md`, `docs/de.md`,
  `docs/es.md`, kept in sync.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why, in English. Tests
  never touch the network (except the loopback WebSocket server of `test/client.test.js`).
