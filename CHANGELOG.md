# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

## [Unreleased]

### Added

- Vallox integration over the unit's local WebSocket API (Vallox MV, ValloPlus, ValloMulti,
  TSK Multi, Helios KWL): one Gladys device per unit, identified by the unit's UUID.
- Features: ventilation on/off, away, boost and fireplace switches, current fan speed, extract /
  outdoor / supply / exhaust air temperatures, humidity, CO2, fan speed and supply air target of
  the home, away and boost profiles, boost time left, days before the filter change.
- Data model read from the unit's own web interface, with a built-in fallback.
- Scene triggers: profile changed, alarm raised, filter change due, unit unreachable.
- Scene actions: set the profile (with a duration), set the fan speed of a profile, record a
  filter change, read the values.
- "Vallox ventilation" dashboard widget with Home / Away / Boost buttons.
- Configuration screen buttons: test the connection, filters changed today.
- `local` / `unreachable` transport badge per unit.
- English, French, German and Spanish texts and documentation.

[Unreleased]: https://github.com/prohand/gladys-vallox/commits/main
