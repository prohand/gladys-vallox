# Security policy

## Supported versions

Only the latest release of the Vallox integration receives security fixes. Update the
integration from the Gladys store before reporting an issue.

| Version      | Supported |
| ------------ | --------- |
| 1.x (latest) | Yes       |
| older        | No        |

## Reporting a vulnerability

Please do **not** open a public issue for a security problem.

Report it privately through GitHub: open the **Security** tab of
[prohand/gladys-vallox](https://github.com/prohand/gladys-vallox/security), then
**Report a vulnerability**.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- any log line that helps (remove addresses and personal data first).

You should get a first answer within 7 days. A fix is released as a new version of the
integration, and the advisory is published once users can update.

## Scope

In scope: the code of this repository and the Docker image it publishes.

Out of scope: Gladys Assistant itself (report to
[GladysAssistant/Gladys](https://github.com/GladysAssistant/Gladys/security)) and the Vallox
units and their firmware (report to Vallox).

## What the integration does, security-wise

- It only connects to the addresses typed in its configuration, on the local network (HTTP and
  WebSocket on port 80, the unit's own web interface). No cloud service, no outgoing internet
  traffic.
- The Vallox local API has **no authentication**: anyone on the same network can drive the unit,
  with or without this integration. Keep the unit on a trusted network (or a dedicated VLAN that
  Gladys can reach).
- Writes are limited to an allowlist of registers (profiles, fan speeds, supply air targets,
  on/off, filter date): installer settings are never touched.
- It runs as a non-root user in a read-only container; the only file written is
  `/data/units.json` (unit id, model and firmware).

## Good practices for users

- Give the unit a fixed address and keep it off networks you do not control.
- Keep Gladys and the integration up to date.
