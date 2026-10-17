import "server-only";
/**
 * The acting person of a role / sub-user management call
 * (.vibe/memory/role-privilege-management.md, "Technical Notes" → "Services").
 *
 * An actor is built ONLY from server-resolved data: the verified session and
 * the effective access the guards computed for this request
 * (PlatformAccessContext / TenantArea / CustomerArea), plus the centrally
 * disabled modules of the actor's panel. Nothing in it ever comes from a form,
 * a query string or a header (the client address is used for audit rows only).
 *
 * The services re-read the actor's own role inside every mutation transaction
 * (stores/*.ts `reloadActor`), so a ceiling that changed after this snapshot
 * is honoured.
 */
import type { TenantDb } from "@/lib/db/tenant";
import { getControlDb } from "@/lib/db/control";
import type { CustomerArea, TenantArea } from "@/lib/workspace/guards";
import type { AuthzDomain } from "./catalog";
import type { PlatformAccessContext } from "./platform";
import { loadDisabledPlatformModules } from "./platform-access";
import type { PolicyActor } from "./policy";
import { getDisabledTenantModules } from "./workspace-access";

/** Where the actor acts: the control plane, one tenant, or one main customer of a tenant. */
export type PlatformScope = { kind: "platform" };
export type TenantScope   = { kind: "tenant"; tenantId: string; db: TenantDb };
export type CustomerScope = {
  kind: "customer";
  tenantId: string;
  db: TenantDb;
  /** COALESCE(parent_id, id) of the actor's customer: owner of the custom customer roles. */
  mainCustomerId: string;
  /** The actor's own customer (the main customer itself or one of its sub-customers). */
  customerId: string;
};

/** What every actor carries. */
type ActorBase = {
  /** Platform owner id or tenant-database user id (from the verified session). */
  userId: string;
  /** The actor's role id (also when it grants nothing), or null. */
  roleId: string | null;
  /** Holds the active master role of the domain. */
  isMaster: boolean;
  /** The actor is the primary (lockout-protected) account. */
  isPrimary: boolean;
  /** The effective privileges of this request (the delegation ceiling). */
  permissions: readonly string[];
  /** Module keys switched off centrally for the actor's panel. */
  disabledModules: readonly string[];
  /** The client address, for audit rows only (never trusted for decisions). */
  ipAddress: string | null;
};

export type PlatformAuthzActor = ActorBase & { domain: "platform"; scope: PlatformScope };
export type TenantAuthzActor   = ActorBase & { domain: "tenant"; scope: TenantScope };
export type CustomerAuthzActor = ActorBase & { domain: "customer"; scope: CustomerScope };

/** The acting person of a management call, in one of the three domains. */
export type AuthzActor = PlatformAuthzActor | TenantAuthzActor | CustomerAuthzActor;

/** Optional extras when building an actor. */
export type ActorOptions = {
  /** The client address for audit rows. */
  ipAddress?: string | null;
  /** Already-loaded disabled modules (otherwise read here; tests pass them explicitly). */
  disabledModules?: readonly string[];
};

/**
 * Description: Build the actor of a Platform Panel call.
 * Input: The platform access context of this request (only `access` is read:
 *   owner id, role, master/primary flags, effective privileges) and options.
 * Output: The platform actor. The disabled platform modules are read from the
 *   control plane unless given.
 * Use case: Platform role / Sub-Platform Owner Server Actions and pages.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function platformActor(
  context: Pick<PlatformAccessContext, "access">,
  options: ActorOptions = {},
): Promise<PlatformAuthzActor> {
  const { access } = context;
  // The switches the resolver already applied; kept for editor lock reasons.
  const disabledModules = options.disabledModules ?? (await loadDisabledPlatformModules(getControlDb()));
  return {
    domain: "platform",
    userId: access.ownerId,
    roleId: access.roleId,
    isMaster: access.isMaster,
    isPrimary: access.isPrimary,
    permissions: [...access.permissions],
    disabledModules: [...disabledModules],
    ipAddress: options.ipAddress ?? null,
    scope: { kind: "platform" },
  };
}

/**
 * Description: Build the actor of a tenant-area call (Tenant / Sub-Tenant).
 * Input: The tenant area of this request (workspace, user, `authz`) and options.
 * Output: The tenant actor; the tenant database comes from the Host-resolved
 *   workspace. Disabled modules come from the per-request cache unless given.
 * Use case: Tenant role / Sub-Tenant Server Actions and pages.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function tenantActor(
  area: Pick<TenantArea, "tenant" | "db" | "user" | "authz">,
  options: ActorOptions = {},
): Promise<TenantAuthzActor> {
  const disabledModules = options.disabledModules ?? (await getDisabledTenantModules(area.tenant.id));
  return {
    domain: "tenant",
    userId: area.user.id,
    roleId: area.authz.roleId,
    isMaster: area.authz.isMaster,
    isPrimary: area.user.isPrimary,
    permissions: [...area.authz.permissions],
    disabledModules: [...disabledModules],
    ipAddress: options.ipAddress ?? null,
    scope: { kind: "tenant", tenantId: area.tenant.id, db: area.db },
  };
}

/**
 * Description: Build the actor of a customer-area call (Customer / Sub-Customer).
 * Input: The customer area of this request (workspace, user with customer, `authz`) and options.
 * Output: The customer actor; mainCustomerId = the customer's parent, or the
 *   customer itself for a main customer (one level deep).
 * Use case: Customer role / Sub-Customer Server Actions and pages.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function customerActor(
  area: Pick<CustomerArea, "tenant" | "db" | "user" | "authz">,
  options: ActorOptions = {},
): Promise<CustomerAuthzActor> {
  const disabledModules = options.disabledModules ?? (await getDisabledTenantModules(area.tenant.id));
  const customer        = area.user.customer;
  return {
    domain: "customer",
    userId: area.user.id,
    roleId: area.authz.roleId,
    isMaster: area.authz.isMaster,
    isPrimary: area.user.isPrimary,
    permissions: [...area.authz.permissions],
    disabledModules: [...disabledModules],
    ipAddress: options.ipAddress ?? null,
    scope: {
      kind: "customer",
      tenantId: area.tenant.id,
      db: area.db,
      mainCustomerId: customer.parentId ?? customer.id,
      customerId: customer.id,
    },
  };
}

/**
 * Description: Reduce an actor to the facts the pure policy needs.
 * Input: The actor.
 * Output: The PolicyActor (domain, ids, master flag, ceiling, disabled modules, main customer).
 * Use case: Every policy call of the services.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function toPolicyActor(actor: AuthzActor): PolicyActor {
  return {
    domain: actor.domain,
    userId: actor.userId,
    roleId: actor.roleId,
    isMaster: actor.isMaster,
    permissions: actor.permissions,
    disabledModules: actor.disabledModules,
    mainCustomerId: actor.scope.kind === "customer" ? actor.scope.mainCustomerId : null,
  };
}

/**
 * Description: Name the tenant an actor acts in.
 * Input: The actor.
 * Output: The tenant id of a tenant/customer actor; null on the platform.
 * Use case: Audit rows and log lines.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function actorTenantId(actor: AuthzActor): string | null {
  return actor.scope.kind === "platform" ? null : actor.scope.tenantId;
}

/** The audit actor type of each domain. */
export const AUDIT_ACTOR_TYPES = {
  platform: "super_admin",
  tenant: "tenant_user",
  customer: "customer_user",
} as const satisfies Record<AuthzDomain, string>;
