/**
 * The Customer panel's bindings for the shared RBAC screens
 * (src/components/rbac/screens/; .vibe/memory/role-privilege-management.md,
 * "Technical Notes" → "RBAC pages (all panels)"): which page guard, Server
 * Actions, paths and texts the role and Sub-Customer screens use. Every page
 * of /customer/roles and /customer/sub-customers passes these, so a page can
 * never be wired to another panel's actions or privileges by mistake.
 */
import { loadRoleOptionsAction } from "./rbac-options-actions";
import type { RbacPanelBinding, RoleScreenBinding, SubUserScreenBinding } from "@/components/rbac/screens/types";
import { CUSTOMER_DASHBOARD_PATH } from "./navigation";
import { CUSTOMER_RBAC_PATHS, customerPageActor } from "./rbac-actor";
import {
  createCustomerRoleAction,
  deleteCustomerRoleAction,
  loadCustomerAssignedUserRecordsAction,
  loadCustomerRolePrivilegesAction,
  loadCustomerRoleRecordsAction,
  loadCustomerRoleUsersAction,
  setCustomerRoleStatusAction,
  updateCustomerRoleAction,
} from "./roles/actions";
import {
  createSubCustomerAction,
  loadSubCustomerRecordsAction,
  setSubCustomerStatusAction,
  updateSubCustomerAction,
} from "./sub-customers/actions";

/** What every customer RBAC screen shares: dashboard link, eyebrow, gutters and the page guard. */
export const CUSTOMER_RBAC_PANEL: RbacPanelBinding = {
  home: CUSTOMER_DASHBOARD_PATH,
  // The eyebrow of every account page (navigation group "Account").
  eyebrow: "Account",
  // The portal pages pad themselves.
  gutterClassName: "px-4 lg:px-6",
  pageActor: customerPageActor,
  loadRoleOptions: loadRoleOptionsAction,
};

/** The customer role screens (each action authorizes its own customer.roles.* privilege). */
export const CUSTOMER_ROLE_SCREENS: RoleScreenBinding = {
  ...CUSTOMER_RBAC_PANEL,
  list: CUSTOMER_RBAC_PATHS.roles,
  actions: {
    loadPrivileges: loadCustomerRolePrivilegesAction,
    loadUsers: loadCustomerRoleUsersAction,
    loadRoles: loadCustomerRoleRecordsAction,
    loadAssignedUsers: loadCustomerAssignedUserRecordsAction,
    create: createCustomerRoleAction,
    update: updateCustomerRoleAction,
    setStatus: setCustomerRoleStatusAction,
    remove: deleteCustomerRoleAction,
  },
};

/** The Sub-Customer screens (each action authorizes its own customer.sub_customers.* privilege). */
export const SUB_CUSTOMER_SCREENS: SubUserScreenBinding = {
  ...CUSTOMER_RBAC_PANEL,
  list: CUSTOMER_RBAC_PATHS.users,
  variant: "customer",
  plural: "Sub-Customers",
  singular: "Sub-Customer",
  addLabel: "Add Sub-Customer",
  description: "Accounts that work under your customer account. Each one logs in with exactly one role.",
  actions: {
    loadUsers: loadSubCustomerRecordsAction,
    create: createSubCustomerAction,
    update: updateSubCustomerAction,
    setStatus: setSubCustomerStatusAction,
  },
};
