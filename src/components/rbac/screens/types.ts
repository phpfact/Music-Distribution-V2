/**
 * The binding objects the shared RBAC screens receive from each panel
 * (Platform, Tenant, Customer; .vibe/memory/role-privilege-management.md,
 * "Technical Notes" → "RBAC pages (all panels)").
 *
 * The screens never import a panel's guard, session or actions: everything
 * panel-specific — paths, dashboard link, texts, gutters, the page guard +
 * actor builder and the bound Server Actions — arrives through one of these
 * objects (each panel's `rbac-bindings.ts`). So a screen cannot mix up
 * privileges or scopes of two panels, and the three panels render the same
 * UI from the same code.
 */
import type { RbacStatusFilter } from "@/components/rbac/list-href";
import type { AssignedUserWithRoleView, PrivilegesResult } from "@/components/rbac/rbac-records";
import type {
  AssignedUserView,
  RbacActionResult,
  RecordsResult,
  RoleFormState,
  RoleRowView,
  RoleOptionView,
  RoleOptionsPurpose,
  RoleStatusValue,
  SubUserFormState,
  SubUserRowView,
  UserStatusChange,
} from "@/components/rbac/types";
import type { ManagementOperation } from "@/lib/authz/management-model";
import type { PageActorResult } from "@/lib/authz/page-support";
import type { SubUserVariant } from "@/lib/authz/sub-user-rules";

/** The roles actions of one panel (each authorizes its own exact privilege). */
export type RoleScreenActions = {
  /** `*.roles.view`: one role's privileges grouped by module (privileges popup). */
  loadPrivileges: (roleId: string) => Promise<PrivilegesResult>;
  /** `*.roles.view`: the users holding a role, paged (users popup, dialogs). */
  loadUsers: (roleId: string, page: number) => Promise<RecordsResult<AssignedUserView>>;
  /** `*.roles.view`: the roles behind Total / Active / Disabled, paged. */
  loadRoles: (filter: RbacStatusFilter, page: number) => Promise<RecordsResult<RoleRowView>>;
  /** `*.roles.view`: the users behind "Users assigned", paged. */
  loadAssignedUsers: (page: number) => Promise<RecordsResult<AssignedUserWithRoleView>>;
  /** `*.roles.create`: the role editor's create action. */
  create: (state: RoleFormState, formData: FormData) => Promise<RoleFormState>;
  /** `*.roles.edit`: the role editor's save action (role id bound on the server). */
  update: (roleId: string, state: RoleFormState, formData: FormData) => Promise<RoleFormState>;
  /** `*.roles.edit`: switch a role to the intended status (computed from the shown status). */
  setStatus: (roleId: string, next: RoleStatusValue) => Promise<RbacActionResult>;
  /** `*.roles.delete`: delete, reassigning the holders to the replacement. */
  remove: (roleId: string, replacementRoleId: string | null) => Promise<RbacActionResult>;
};

/** The sub-user actions of one panel (each authorizes its own exact privilege). */
export type SubUserScreenActions = {
  /** Users view privilege: the accounts behind a summary figure. */
  loadUsers: (filter: RbacStatusFilter, page: number) => Promise<RecordsResult<SubUserRowView>>;
  /** Users create privilege: the create form's action. */
  create: (state: SubUserFormState, formData: FormData) => Promise<SubUserFormState>;
  /** Users edit privilege: the edit form's action (user id bound on the server). */
  update: (userId: string, state: SubUserFormState, formData: FormData) => Promise<SubUserFormState>;
  /** Users suspend privilege: make the intended change (computed from the shown status). */
  setStatus: (userId: string, change: UserStatusChange) => Promise<RbacActionResult>;
};

/** What every RBAC screen of a panel needs, whatever it shows. */
export type RbacPanelBinding = {
  /** Every remote request authorizes this panel and the current operation again. */
  loadRoleOptions: (purpose: RoleOptionsPurpose, search: string, page: number, excludeRoleId?: string) => Promise<RecordsResult<RoleOptionView>>;
  /** The panel's dashboard (access-denied "Go to dashboard"). */
  home: string;
  /** The PageHeader eyebrow, e.g. "Access control" (platform, tenant) or "Account" (customer). */
  eyebrow: string;
  /**
   * The content gutters of the panel's pages: the workspace portals pad their
   * pages themselves ("px-4 lg:px-6"); the platform console shell already pads
   * its content area (""). Layout only, never colours.
   */
  gutterClassName: string;
  /**
   * Server-only: the panel's page guard. Checks the session and the page's
   * management privilege, then builds the actor from server-resolved data
   * (platformPageActor / tenantPageActor / customerPageActor).
   */
  pageActor: (operation: ManagementOperation) => Promise<PageActorResult>;
};

/** The role screens of one panel. */
export type RoleScreenBinding = RbacPanelBinding & {
  /** The roles list, e.g. "/tenant/roles" (details/new/edit derive from it). */
  list: string;
  actions: RoleScreenActions;
};

/** The sub-user screens of one panel (Sub-Platform Owners / Sub-Tenants / Sub-Customers). */
export type SubUserScreenBinding = RbacPanelBinding & {
  /** The sub-users list, e.g. "/tenant/users" (new/edit derive from it). */
  list: string;
  /** "platform" (no email), "tenant" or "customer" (account type). */
  variant: SubUserVariant;
  /** Page title and plural noun, e.g. "Sub-Tenants". */
  plural: string;
  /** The singular noun for the edit page, e.g. "Sub-Tenant". */
  singular: string;
  /** The add action / create page title, e.g. "Add Sub-Tenant". */
  addLabel: string;
  /** The list page's description. */
  description: string;
  actions: SubUserScreenActions;
};
