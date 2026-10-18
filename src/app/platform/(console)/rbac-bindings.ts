/**
 * The Platform panel's bindings for the shared RBAC screens
 * (src/components/rbac/screens/; .vibe/memory/role-privilege-management.md,
 * "Technical Notes" → "RBAC pages (all panels)"): which page guard, Server
 * Actions, paths and texts the role and Sub-Platform Owner screens use. Every
 * page of /platform/roles and /platform/users passes these, so a page can
 * never be wired to another panel's actions or privileges by mistake.
 */
import { loadRoleOptionsAction } from "./rbac-options-actions";
import type { RbacPanelBinding, RoleScreenBinding, SubUserScreenBinding } from "@/components/rbac/screens/types";
import { getNavItem } from "./navigation";
import { PLATFORM_RBAC_PATHS, platformPageActor } from "./rbac-actor";
import {
  createRoleAction,
  deleteRoleAction,
  loadAssignedUserRecordsAction,
  loadRolePrivilegesAction,
  loadRoleRecordsAction,
  loadRoleUsersAction,
  setRoleStatusAction,
  updateRoleAction,
} from "./roles/actions";
import {
  createSubPlatformOwnerAction,
  loadSubPlatformOwnerRecordsAction,
  setSubPlatformOwnerStatusAction,
  updateSubPlatformOwnerAction,
} from "./users/actions";

/** What every platform RBAC screen shares: dashboard link, eyebrow, gutters and the page guard. */
export const PLATFORM_RBAC_PANEL: RbacPanelBinding = {
  home: getNavItem("dashboard").href,
  // The navigation group's wording for access management.
  eyebrow: "Access control",
  // The console shell already pads its content area.
  gutterClassName: "",
  pageActor: platformPageActor,
  loadRoleOptions: loadRoleOptionsAction,
};

/** The platform role screens (each action authorizes its own platform.roles.* privilege). */
export const PLATFORM_ROLE_SCREENS: RoleScreenBinding = {
  ...PLATFORM_RBAC_PANEL,
  list: PLATFORM_RBAC_PATHS.roles,
  actions: {
    loadPrivileges: loadRolePrivilegesAction,
    loadUsers: loadRoleUsersAction,
    loadRoles: loadRoleRecordsAction,
    loadAssignedUsers: loadAssignedUserRecordsAction,
    create: createRoleAction,
    update: updateRoleAction,
    setStatus: setRoleStatusAction,
    remove: deleteRoleAction,
  },
};

/** The Sub-Platform Owner screens (each action authorizes its own platform.users.* privilege). */
export const SUB_PLATFORM_OWNER_SCREENS: SubUserScreenBinding = {
  ...PLATFORM_RBAC_PANEL,
  list: PLATFORM_RBAC_PATHS.users,
  variant: "platform",
  plural: "Sub-Platform Owners",
  singular: "Sub-Platform Owner",
  addLabel: "Add Sub-Platform Owner",
  description: "Add the people who help you run the platform and give each of them exactly one role.",
  actions: {
    loadUsers: loadSubPlatformOwnerRecordsAction,
    create: createSubPlatformOwnerAction,
    update: updateSubPlatformOwnerAction,
    setStatus: setSubPlatformOwnerStatusAction,
  },
};
