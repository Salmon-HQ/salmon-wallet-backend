# Security Policy

This backend serves a cryptocurrency wallet. Security reports are taken seriously and handled with priority.

## Reporting a vulnerability

**Do not open a public issue for security problems.**

Report vulnerabilities privately through **GitHub Security Advisories**: go to the repository's **Security** tab → **Report a vulnerability**. Only repository administrators can see the report, and the discussion stays private until a fix ships.

Please include:

- A description of the vulnerability and its impact.
- Steps to reproduce (endpoint, payload, network/stage if relevant).
- Any suggested remediation, if you have one.

You can expect an acknowledgement within a few business days. Please give us a reasonable window to ship a fix before any public disclosure.

## Scope

In scope: everything served by this repository — the HTTP API (`src/`), scheduled jobs, the analytics ingest endpoint, and the deployment configuration checked in here.

Out of scope: the wallet clients (separate repositories), third-party providers this API consumes (Jupiter, CoinGecko, Helius, Triton, StealthEX), and social engineering.

## Notes for maintainers

- Private vulnerability reporting is a GitHub feature for **public** repositories. While this repository is private it cannot be enabled; when the repository goes public, an admin must turn it on once under **Settings → Advanced Security → Private vulnerability reporting**.
- Secret handling and rotation live in `docs/DEPLOY.md` (prod secrets are in AWS SSM Parameter Store, never in the repo).
