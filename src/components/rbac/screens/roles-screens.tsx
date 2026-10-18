/**
 * The role screens shared by ALL three panels — Platform, Tenant, Customer
 * (.vibe/memory/role-privilege-management.md, "UI specs (approved
 * 2026-10-16)" → Roles list, Role details, Role editor; "Technical Notes" →
 * "RBAC pages (all panels)").
 *
 * Each panel's route file only renders one of these screens with its binding
 * (rbac-bindings.ts). The screen asks the binding's page guard for the actor
 * (session + the page privilege, else the access-denied state), reads the
 * viewer's management privileges from that actor and only calls the role
 * service with it, so scope (control plane, tenant database, main customer)
 * and the delegation ceiling are always decided by the services, never here.
 *
 * Server components (async): no client state, nothing from the browser is
 * trusted beyond the URL query (parsed and bounded). No panel guard, session
 * or Server Action is imported here.
 */
import { PlusIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AssignedUsersTable } from "@/components/rbac/assigned-users";
import { formatRbacDate, privilegeCountText } from "@/components/rbac/format";
import { parseRbacListQuery } from "@/components/rbac/list-href";
import { PrivilegeList } from "@/components/rbac/privilege-list";
import { RolePrivilegesRecords, RoleUsersRecords } from "@/components/rbac/rbac-records";
import { RolesSummary } from "@/components/rbac/rbac-summary";
import { RbacToolbar } from "@/components/rbac/rbac-toolbar";
import { RoleEditor } from "@/components/rbac/role-editor";
import { AboveAuthorityBadge, RoleStatusBadge, SystemRoleBadge } from "@/components/rbac/role-badges";
import { RolesDirectory } from "@/components/rbac/roles-directory";
import type { AssignedUserView } from "@/components/rbac/types";
import { CountDetails, FormSection, SectionedLayout, type SecondaryMenuItem } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { holdsPrivilege } from "@/lib/authz/management-common";
import { parseRoleListQuery } from "@/lib/authz/management-model";
import {
  toAssignedUserView,
  toEditorModules,
  toPageView,
  toReadOnlyModules,
  toRoleOptionView,
  toRoleRowView,
} from "@/lib/authz/management-view";
import { POLICY_DENIAL_MESSAGES } from "@/lib/authz/policy";
import {
  getRoleDetails,
  getRoleEditorModel,
  getRoleSummary,
  listAssignableRoles,
  listRoles,
} from "@/lib/authz/role-service";
import { rbacNoticeMessage } from "./notices";
import { RoleDetailsActions } from "./role-details-actions";
import { ActorFallback, DeniedScreen, DetailRow, LoadFailed, ScreenFrame } from "./screen-parts";
import type { RoleScreenBinding } from "./types";

/** The URL search parameters of a page (Next.js). */
type SearchParams = Record<string, string | string[] | undefined>;

// The list page's sections (secondary menu, top variant: spec "Summary, Role directory").
const LIST_SECTIONS = {
  summary:   { id: "roles-summary", label: "Summary" },
  directory: { id: "roles-directory", label: "Role directory" },
} as const;
const LIST_MENU: readonly SecondaryMenuItem[] = Object.values(LIST_SECTIONS);

// The details page's sections (spec: Overview, Privileges, Assigned users).
const DETAIL_SECTIONS = {
  overview:   { id: "role-overview", label: "Overview", icon: "info" },
  privileges: { id: "role-privilege-list", label: "Privileges", icon: "key-round" },
  users:      { id: "role-assigned-users", label: "Assigned users", icon: "user" },
} as const satisfies Record<string, SecondaryMenuItem>;
const DETAIL_MENU: readonly SecondaryMenuItem[] = Object.values(DETAIL_SECTIONS);

// The page title of the roles screens (same in every panel; spec "Roles & Privileges").
const ROLES_TITLE = "Roles & Privileges";

type RolesListScreenProps = {
  /** The panel's binding (paths, texts, page guard, bound Server Actions). */
  binding: RoleScreenBinding;
  searchParams: SearchParams;
};

/**
 * Description: The roles list of a panel (UI spec "Roles list").
 * Input: The panel's binding and the URL query.
 * Output: Without `*.roles.view` the access-denied state (nothing read).
 *   Otherwise PageHeader ("Create role" only with `*.roles.create`), the
 *   one-off notice, the top secondary menu, the four clickable summary
 *   figures, the URL-preserved toolbar and one server page of the role
 *   directory (row actions only where manageable and permitted by
 *   `*.roles.edit|delete`). A load failure shows a friendly error.
 * Use case: /platform/roles, /tenant/roles and /customer/roles.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function RolesListScreen({ binding, searchParams }: RolesListScreenProps) {
  // Step 1: session + `*.roles.view` (else access denied), then the viewer's management privileges.
  const access = await binding.pageActor("rolesView");
  if (!access.ok) return <ActorFallback binding={binding} result={access} title={ROLES_TITLE} />;
  const actor       = access.actor;
  const actions     = binding.actions;
  const permissions = {
    create: holdsPrivilege(actor, "rolesCreate"),
    edit:   holdsPrivilege(actor, "rolesEdit"),
    delete: holdsPrivilege(actor, "rolesDelete"),
  };

  // Step 2: the URL state (toolbar and service read the same query) and the notice.
  const query  = parseRbacListQuery(searchParams);
  const notice = rbacNoticeMessage(searchParams.notice);

  // Step 3: the summary, the requested page and, for deleting, the replacement roles.
  const summary      = await getRoleSummary(actor);
  const page         = await listRoles(actor, parseRoleListQuery(searchParams));
  const replacements = permissions.delete ? await listAssignableRoles(actor) : null;

  // The header action exists only with the create privilege (the action re-checks).
  const createButton = permissions.create ? (
    <Button asChild>
      <Link href={`${binding.list}/new`}>
        <PlusIcon aria-hidden="true" />
        Create role
      </Link>
    </Button>
  ) : undefined;

  const frame = {
    gutterClassName: binding.gutterClassName,
    eyebrow: binding.eyebrow,
    title: ROLES_TITLE,
    description: "Roles decide what each member of your team can see and do. Every user holds exactly one role.",
    actions: createButton,
    notice,
  };

  // Step 4: a failed load shows a friendly message instead of empty figures.
  if (!summary.ok || !page.ok) {
    return (
      <ScreenFrame {...frame}>
        <LoadFailed message={summary.ok ? (page.ok ? "" : page.error) : summary.error} />
      </ScreenFrame>
    );
  }

  // Step 5: the page. Disable/Enable sends the status each row's button means
  // (computed by the shared row actions from the shown status; the service
  // refuses a stale change), so the panel's action is passed as is.
  return (
    <ScreenFrame {...frame}>
      <SectionedLayout items={LIST_MENU} variant="top" contentClassName="flex flex-col gap-6">
        <section id={LIST_SECTIONS.summary.id} aria-labelledby={`${LIST_SECTIONS.summary.id}-title`} className="flex flex-col gap-3">
          <h2 id={`${LIST_SECTIONS.summary.id}-title`} className="text-base font-semibold">
            Summary
          </h2>
          <RolesSummary
            counts={summary.data}
            catalogPrivilegeCount={page.data.allPrivilegeCount}
            loadRoles={actions.loadRoles}
            loadAssignedUsers={actions.loadAssignedUsers}
          />
        </section>

        <section id={LIST_SECTIONS.directory.id} aria-labelledby={`${LIST_SECTIONS.directory.id}-title`}>
          <Card>
            <CardHeader>
              <CardTitle>
                <h2 id={`${LIST_SECTIONS.directory.id}-title`} className="text-base font-semibold">
                  Role directory
                </h2>
              </CardTitle>
              <CardDescription>Search and filter the roles of your account.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <RbacToolbar basePath={binding.list} query={query} searchPlaceholder="Name or description" />
              <RolesDirectory
                page={toPageView(page.data, toRoleRowView)}
                query={query}
                basePath={binding.list}
                catalogPrivilegeCount={page.data.allPrivilegeCount}
                permissions={permissions}
                loadPrivileges={actions.loadPrivileges}
                loadUsers={actions.loadUsers}
                toggleStatusAction={permissions.edit ? actions.setStatus : undefined}
                deleteAction={permissions.delete ? actions.remove : undefined}
                replacementRoles={replacements?.ok ? replacements.data.map(toRoleOptionView) : []}
                loadReplacementRoles={binding.loadRoleOptions.bind(null, "delete")}
              />
            </CardContent>
          </Card>
        </section>
      </SectionedLayout>
    </ScreenFrame>
  );
}

type RoleDetailsScreenProps = {
  /** The panel's binding (paths, texts, page guard, bound Server Actions). */
  binding: RoleScreenBinding;
  /** The `[id]` route segment (untrusted; the service validates and scopes it). */
  roleId: string;
  searchParams: SearchParams;
};

/**
 * Description: The details page of one role (UI spec "Role details").
 * Input: The panel's binding, the role id from the URL and the URL query (notice).
 * Output: Without `*.roles.view` the access-denied state. Unknown, malformed
 *   or out-of-scope ids → 404 (notFound; the [id] routes have no loading
 *   boundary, so the status is a real 404). Otherwise the header with back
 *   link, name, badges and the permitted actions (only when the role is
 *   manageable and the viewer holds `*.roles.edit|delete`); sidebar secondary
 *   menu with Overview, Privileges (read-only, module-disabled ones marked)
 *   and Assigned users (masked username/email).
 * Use case: /platform/roles/[id], /tenant/roles/[id] and /customer/roles/[id].
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function RoleDetailsScreen({ binding, roleId, searchParams }: RoleDetailsScreenProps) {
  // Step 1: session + `*.roles.view` (else access denied).
  const access = await binding.pageActor("rolesView");
  if (!access.ok) return <ActorFallback binding={binding} result={access} title="Role details" />;
  const actor   = access.actor;
  const actions = binding.actions;

  // Step 2: the role inside the actor's scope (another tenant / main customer = not found).
  const details = await getRoleDetails(actor, roleId);
  if (!details.ok && details.reason === "not_found") notFound();
  if (!details.ok && details.reason === "forbidden") {
    return <DeniedScreen gutterClassName={binding.gutterClassName} homeHref={binding.home} description={details.error} />;
  }
  if (!details.ok) {
    return (
      <ScreenFrame
        gutterClassName={binding.gutterClassName}
        eyebrow={binding.eyebrow}
        title="Role details"
        backHref={binding.list}
        backLabel={ROLES_TITLE}
      >
        <LoadFailed message={details.error} />
      </ScreenFrame>
    );
  }

  // Step 3: what the viewer may do here (manageable AND the matching privilege).
  const { role, modules, assignedUsers, affectedUserCount, manageable, manageableReason } = details.data;
  const editable    = manageable && !role.isMaster;
  const canEdit     = editable && holdsPrivilege(actor, "rolesEdit");
  const canDelete   = editable && holdsPrivilege(actor, "rolesDelete");
  const detailsHref = `${binding.list}/${role.id}`;

  // Step 4: replacement roles for "Delete and reassign", and the holders for the dialogs.
  const replacements                 = canDelete ? await listAssignableRoles(actor, { excludeRoleId: role.id }) : null;
  const affected: AssignedUserView[] = assignedUsers.rows.map(toAssignedUserView);
  const privilegeText                = privilegeCountText(role.privilegeCount);

  return (
    <ScreenFrame
      gutterClassName={binding.gutterClassName}
      eyebrow={binding.eyebrow}
      title={role.name}
      backHref={binding.list}
      backLabel={ROLES_TITLE}
      notice={rbacNoticeMessage(searchParams.notice)}
      description={
        <span className="flex flex-wrap items-center gap-2">
          <RoleStatusBadge status={role.status} />
          {role.isMaster ? <SystemRoleBadge /> : null}
          {!role.isMaster && !manageable ? <AboveAuthorityBadge /> : null}
        </span>
      }
      actions={
        <RoleDetailsActions
          role={{ id: role.id, name: role.name, status: role.status, userCount: affectedUserCount }}
          detailsHref={detailsHref}
          listHref={binding.list}
          canEdit={canEdit}
          canDelete={canDelete}
          // The status the button means is computed from the shown status (never a blind toggle).
          toggleStatusAction={canEdit ? actions.setStatus : undefined}
          deleteAction={canDelete ? actions.remove : undefined}
          replacementRoles={replacements?.ok ? replacements.data.map(toRoleOptionView) : []}
          loadReplacementRoles={binding.loadRoleOptions.bind(null, "delete")}
          affectedUsers={affected}
        />
      }
    >
      <SectionedLayout items={DETAIL_MENU} contentClassName="flex flex-col gap-6">
        <FormSection id={DETAIL_SECTIONS.overview.id} icon="info" title="Overview" description="What this role is and who it affects.">
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[minmax(8rem,auto)_minmax(0,1fr)]">
            <DetailRow label="Description">{role.description ?? <span className="text-muted-foreground">No description</span>}</DetailRow>
            <DetailRow label="Type">{role.isMaster ? "System role (grants every privilege of this panel)" : "Custom role"}</DetailRow>
            <DetailRow label="Status">
              <RoleStatusBadge status={role.status} />
            </DetailRow>
            <DetailRow label="Privileges">
              <CountDetails
                label={`${role.name}: ${privilegeText}. Show the privileges of this role.`}
                title={`Privileges of ${role.name}`}
                description="Grouped by module."
                calculation={
                  role.isMaster
                    ? "A master role always grants every privilege of this panel. Privileges of modules the Platform Owner disabled are marked."
                    : `The privileges stored on this role (modules switched off by the Platform Owner not counted): ${role.privilegeCount ?? 0}.`
                }
                records={<RolePrivilegesRecords roleId={role.id} loadPrivileges={actions.loadPrivileges} />}
              >
                {privilegeText}
              </CountDetails>
            </DetailRow>
            <DetailRow label="Users">
              <CountDetails
                label={`${role.name}: ${affectedUserCount} users. Show the users who hold this role.`}
                title={`Users with the role ${role.name}`}
                description="Every user has exactly one role."
                calculation={`Users of your account whose single role is ${role.name}: ${affectedUserCount}.`}
                records={<RoleUsersRecords roleId={role.id} loadUsers={actions.loadUsers} />}
                className="tabular-nums"
              >
                {affectedUserCount}
              </CountDetails>
            </DetailRow>
            <DetailRow label="Created">{formatRbacDate(role.createdAt)}</DetailRow>
            <DetailRow label="Updated">{formatRbacDate(role.updatedAt)}</DetailRow>
            {!editable ? (
              <DetailRow label="Changes">
                <span className="text-muted-foreground">
                  {POLICY_DENIAL_MESSAGES[manageableReason ?? "system_role"]}
                </span>
              </DetailRow>
            ) : null}
          </dl>
        </FormSection>

        <FormSection
          id={DETAIL_SECTIONS.privileges.id}
          icon="key-round"
          title="Privileges"
          description="Read-only. Privileges of a module the Platform Owner disabled grant nothing until it is enabled again."
        >
          <PrivilegeList modules={toReadOnlyModules(modules)} />
        </FormSection>

        <FormSection
          id={DETAIL_SECTIONS.users.id}
          icon="user"
          title="Assigned users"
          description="Each of these users holds exactly this role."
          action={
            assignedUsers.total > assignedUsers.rows.length ? (
              <CountDetails
                label={`Show all ${assignedUsers.total} users who hold ${role.name}.`}
                title={`Users with the role ${role.name}`}
                description="Every user has exactly one role."
                calculation={`Users of your account whose single role is ${role.name}: ${assignedUsers.total}.`}
                records={<RoleUsersRecords roleId={role.id} loadUsers={actions.loadUsers} />}
              >
                {`Show all ${assignedUsers.total}`}
              </CountDetails>
            ) : undefined
          }
        >
          <AssignedUsersTable users={affected} caption={`Users with the role ${role.name}`} />
        </FormSection>
      </SectionedLayout>
    </ScreenFrame>
  );
}

type RoleEditorScreenProps = {
  /** The panel's binding (paths, texts, page guard, bound Server Actions). */
  binding: RoleScreenBinding;
  mode: "create" | "edit";
  /** Edit only: the `[id]` route segment (untrusted). */
  roleId?: string;
};

/**
 * Description: The create / edit page of a role (UI spec "Role editor").
 * Input: The panel's binding, the mode and the role id (edit).
 * Output: Without `*.roles.create` (create) / `*.roles.edit` (edit) the
 *   access-denied state. Otherwise the shared RoleEditor with only the
 *   privileges the actor may grant as checkboxes (the rest locked with its
 *   reason), prefilled on edit, plus the affected users. Edit:
 *   unknown/malformed/out-of-scope id → 404; a role the viewer may not manage
 *   (system role, own role, above the ceiling) → the access-denied state with
 *   the reason.
 * Use case: /<panel>/roles/new and /<panel>/roles/[id]/edit of every panel.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function RoleEditorScreen({ binding, mode, roleId }: RoleEditorScreenProps) {
  // Step 1: session + the page privilege of this mode (else access denied).
  const title  = mode === "create" ? "Create role" : "Edit role";
  const access = await binding.pageActor(mode === "create" ? "rolesCreate" : "rolesEdit");
  if (!access.ok) return <ActorFallback binding={binding} result={access} title={title} />;
  const actor   = access.actor;
  const actions = binding.actions;

  // Step 2: the editor model (create: no id; edit: the role must be manageable).
  const model = await getRoleEditorModel(actor, mode === "edit" ? roleId ?? "" : undefined);
  if (!model.ok && model.reason === "not_found") notFound();
  if (!model.ok && model.reason === "forbidden") {
    return <DeniedScreen gutterClassName={binding.gutterClassName} homeHref={binding.home} description={model.error} />;
  }
  if (!model.ok) {
    return (
      <ScreenFrame
        gutterClassName={binding.gutterClassName}
        eyebrow={binding.eyebrow}
        title={title}
        backHref={binding.list}
        backLabel={ROLES_TITLE}
      >
        <LoadFailed message={model.error} />
      </ScreenFrame>
    );
  }

  // Step 3: checkboxes vs. locked privileges, and (edit) the users a save affects.
  const { modules, locked } = toEditorModules(model.data.modules);
  const editedRoleId        = model.data.roleId;

  // Step 4 (create): an empty editor; the action redirects to the new role on success.
  if (!editedRoleId) {
    return (
      <ScreenFrame
        gutterClassName={binding.gutterClassName}
        eyebrow={binding.eyebrow}
        title="Create role"
        description="Choose exactly the privileges this role grants. You can only grant privileges you hold yourself."
        backHref={binding.list}
        backLabel={ROLES_TITLE}
      >
        <RoleEditor mode="create" modules={modules} locked={locked} action={actions.create} cancelHref={binding.list} />
      </ScreenFrame>
    );
  }

  // Step 5 (edit): prefilled; the role id is bound on the server (the service re-checks it).
  const detailsHref = `${binding.list}/${editedRoleId}`;
  return (
    <ScreenFrame
      gutterClassName={binding.gutterClassName}
      eyebrow={binding.eyebrow}
      title={`Edit ${model.data.initial.name}`}
      description="Changes apply to every user of this role on their next request."
      backHref={detailsHref}
      backLabel={model.data.initial.name}
    >
      <RoleEditor
        mode="edit"
        modules={modules}
        locked={locked}
        initial={{
          name: model.data.initial.name,
          description: model.data.initial.description,
          status: model.data.initial.status,
          privileges: model.data.initial.permissionKeys,
        }}
        roleId={editedRoleId}
        affectedUserCount={model.data.affectedUserCount}
        preservedKeys={model.data.preservedKeys}
        loadAffectedUsers={actions.loadUsers.bind(null, editedRoleId)}
        action={actions.update.bind(null, editedRoleId)}
        cancelHref={detailsHref}
      />
    </ScreenFrame>
  );
}
