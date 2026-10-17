/**
 * The Tenant panel's bindings for the shared RBAC screens
 * (src/components/rbac/screens/; .vibe/memory/role-privilege-management.md,
 * "Technical Notes" → "RBAC pages (all panels)"): which page guard, Server
 * Actions, paths and texts the role and Sub-Tenant screens use. Every page of
 * /tenant/roles and /tenant/users passes these, so a page can never be wired
 * to another panel's actions or privileges by mistake.
 */
import type { RbacPanelBinding, RoleScreenBinding, SubUserScreenBinding } from "@/components/rbac/screens/types";
import { TENANT_DASHBOARD_PATH } from "./navigation";
import { TENANT_RBAC_PATHS, tenantPageActor } from "./rbac-actor";
import {
  createTenantRoleAction,
  deleteTenantRoleAction,
  loadTenantAssignedUserRecordsAction,
  loadTenantRolePrivilegesAction,
  loadTenantRoleRecordsAction,
  loadTenantRoleUsersAction,
  setTenantRoleStatusAction,
  updateTenantRoleAction,
} from "./roles/actions";
import { createSubTenantAction, loadSubTenantRecordsAction, setSubTenantStatusAction, updateSubTenantAction } from "./users/actions";

/** What every tenant RBAC screen shares: dashboard link, eyebrow, gutters and the page guard. */
export const TENANT_RBAC_PANEL: RbacPanelBinding = {
  home: TENANT_DASHBOARD_PATH,
  // The eyebrow of every access-control page (navigation group "Access control").
  eyebrow: "Access control",
  // The portal pages pad themselves.
  gutterClassName: "px-4 lg:px-6",
  pageActor: tenantPageActor,
};

/** The tenant role screens (each action authorizes its own tenant.roles.* privilege). */
export const TENANT_ROLE_SCREENS: RoleScreenBinding = {
  ...TENANT_RBAC_PANEL,
  list: TENANT_RBAC_PATHS.roles,
  actions: {
    loadPrivileges: loadTenantRolePrivilegesAction,
    loadUsers: loadTenantRoleUsersAction,
    loadRoles: loadTenantRoleRecordsAction,
    loadAssignedUsers: loadTenantAssignedUserRecordsAction,
    create: createTenantRoleAction,
    update: updateTenantRoleAction,
    setStatus: setTenantRoleStatusAction,
    remove: deleteTenantRoleAction,
  },
};

/** The Sub-Tenant screens (each action authorizes its own tenant.users.* privilege). */
export const SUB_TENANT_SCREENS: SubUserScreenBinding = {
  ...TENANT_RBAC_PANEL,
  list: TENANT_RBAC_PATHS.users,
  variant: "tenant",
  plural: "Sub-Tenants",
  singular: "Sub-Tenant",
  addLabel: "Add Sub-Tenant",
  description: "Your team's accounts. Each one logs in to this workspace with exactly one role.",
  actions: {
    loadUsers: loadSubTenantRecordsAction,
    create: createSubTenantAction,
    update: updateSubTenantAction,
    setStatus: setSubTenantStatusAction,
  },
};
