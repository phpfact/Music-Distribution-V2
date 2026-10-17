# Tenant Database Clients

## Overview and behavior

The server creates a Prisma client with a small PostgreSQL pool for a trusted,
decrypted tenant target. Clients are reused by tenant ID; changing credentials or
port replaces the old client. Suspension/password rotation can explicitly evict.

## Requested audit remediation (2026-10-17)

- AUD-008: `POSTGRES_TENANT_CLIENTS_MAX` is explicitly a soft retained-client target,
  not a hard connection/admission budget. The existing 30-second safety grace
  remains to avoid disconnecting a client immediately after use.
- Trim on cache hits and insertion, and schedule an unref'ed cleanup while above
  the target. Bursts therefore drain after the grace without requiring a new
  tenant/cache miss. Continually used clients may temporarily exceed the target.
- Each individual pool remains bounded by `POSTGRES_TENANT_POOL_MAX`; implementing
  a hard global budget would require request leases and is outside this fix.

## Change history

- 2026-10-17: Recorded AUD-008 cleanup policy and regression scenarios before code.
