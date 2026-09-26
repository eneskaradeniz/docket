# Security policy

## Supported versions

Docket is being rebuilt (v2) and has no released version yet. Security fixes land on `main`.

## Reporting a vulnerability

Please report vulnerabilities **privately** through GitHub:
**Security → Report a vulnerability** on this repository (private vulnerability reporting).
Do not open a public issue for a security problem.

Include what you found, how to reproduce it, and the impact you expect. You will get an
acknowledgement within 7 days and a status update at least every 14 days until it is resolved.

## Scope

Docket runs AI coding agents on your machine and handles provider credentials, so these areas matter
most:

- Leaks of API keys or tokens (they must live only in the OS keychain, never in files, logs, or
  records).
- Ways an agent can escape its write scope or merge without a human approval.
- Agent-produced pages (artifacts) escaping their sandbox or reaching the network.
