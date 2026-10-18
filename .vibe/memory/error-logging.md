# Error Logging

## Overview and rules

The shared server log boundary removes credential material before diagnostic text
leaves the application. `describeError` retains its public API and last meaningful
Prisma line; provisioning keeps explicit known-secret replacement and its bounded
cause chain. Both use a dependency-free sanitizer, so authentication does not
depend on provisioning or introduce a circular database import.

## Requested audit remediation (2026-10-17)

- AUD-019: redact connection URIs, SQL password literals, password verifiers,
  sensitive assignments (including JSON and compound field names), authorization
  and cookie headers. Replace known secrets before pattern matching, then flatten
  control characters and bound output to 2,000 characters.
- Preserve benign operational messages and provisioning error codes/causes.
- Synthetic regression tests must cover alternate credential forms and a benign
  control. Arbitrary unlabeled secrets cannot be inferred from free text; callers
  must continue to avoid passing credentials or arbitrary request objects.

## Change history

- 2026-10-17: Recorded AUD-019 implementation and verification requirements before code.
- 2026-10-18: Authentication rate-limiter outage/cleanup diagnostics also use the
  shared sanitizer; Redis errors must not bypass the credential boundary.
- 2026-10-18: Independent review found valid apostrophes in connection passwords
  and overlapping SQL-escape regex alternatives. URI redaction now consumes the
  whole whitespace-delimited value; SQL literals use disjoint escape branches,
  including unterminated literals, with bounded-time regression coverage.
- 2026-10-18: Implementation complete. All credential, alternate URI/literal,
  multiline, benign diagnostic, cause-chain and malformed-escape regressions pass;
  the combined suite, lint, TypeScript and production build also pass.
