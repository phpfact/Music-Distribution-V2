/**
 * The sub-user screens shared by ALL three panels: Sub-Platform Owners
 * (Platform), Sub-Tenants (Tenant) and Sub-Customers (Customer)
 * (.vibe/memory/role-privilege-management.md, "UI specs (approved
 * 2026-10-16)" → Sub-users list, Sub-user form; "Technical Notes" → "RBAC
 * pages (all panels)").
 *
 * Each panel's route file only renders one of these screens with its binding
 * (rbac-bindings.ts). The screen asks the binding's page guard for the actor
 * (session + the page privilege, else the access-denied state) and every read
 * goes through the sub-user service with that actor: platform = owners of the
 * control plane; tenant = staff users of the Host's tenant; customer =
 * sub-customers of the session user's MAIN customer only.
 *
 * Server components (async). No panel guard, session or Server Action is
 * imported here.
 */
import { PlusIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { parseRbacListQuery } from "@/components/rbac/list-href";
import { SubUsersSummary } from "@/components/rbac/rbac-summary";
import { RbacToolbar } from "@/components/rbac/rbac-toolbar";
import { SubUserForm } from "@/components/rbac/sub-user-form";
import { SubUsersDirectory } from "@/components/rbac/sub-users-directory";
import { SectionedLayout, type SecondaryMenuItem } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { holdsPrivilege } from "@/lib/authz/management-common";
import { toPageView, toRoleOptionView, toSubUserListQuery, toSubUserRowView } from "@/lib/authz/management-view";
import { POLICY_DENIAL_MESSAGES } from "@/lib/authz/policy";
import { listRoleFilterOptions } from "@/lib/authz/role-filter";
import { listAssignableRoles } from "@/lib/authz/role-service";
import { getSubUserEditModel, getSubUserSummary, listSubUsers } from "@/lib/authz/sub-user-service";
import { rbacNoticeMessage } from "./notices";
import { ActorFallback, DeniedScreen, LoadFailed, ScreenFrame } from "./screen-parts";
import type { SubUserScreenBinding } from "./types";

/** The URL search parameters of a page (Next.js). */
type SearchParams = Record<string, string | string[] | undefined>;

// The list page's sections (secondary menu, top variant like the roles list).
const LIST_SECTIONS = {
  summary:   { id: "sub-users-summary", label: "Summary" },
  directory: { id: "sub-users-directory", label: "Directory" },
} as const;
const LIST_MENU: readonly SecondaryMenuItem[] = Object.values(LIST_SECTIONS);

type SubUsersListScreenProps = {
  /** The panel's binding (variant, texts, paths, page guard, bound Server Actions). */
  binding: SubUserScreenBinding;
  searchParams: SearchParams;
};

/**
 * Description: The sub-users list of a panel (UI spec "Sub-users list").
 * Input: The panel's binding and the URL query.
 * Output: Without the users view privilege the access-denied state (nothing
 *   read). Otherwise PageHeader ("Add …" only with the create privilege), the
 *   one-off notice, the top secondary menu, three clickable summary figures,
 *   the toolbar (search — name, username and, outside the platform, email —,
 *   status, searchable role filter: every role with the roles view privilege,
 *   else the assignable roles, else none) and one server page of the
 *   directory (Edit / Suspend only where manageable and permitted).
 * Use case: /platform/users, /tenant/users and /customer/sub-customers.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function SubUsersListScreen({ binding, searchParams }: SubUsersListScreenProps) {
  // Step 1: session + the users view privilege (else access denied), then the viewer's privileges.
  const access = await binding.pageActor("usersView");
  if (!access.ok) return <ActorFallback binding={binding} result={access} title={binding.plural} />;
  const actor       = access.actor;
  const permissions = {
    create:  holdsPrivilege(actor, "usersCreate"),
    edit:    holdsPrivilege(actor, "usersEdit"),
    suspend: holdsPrivilege(actor, "usersSuspend"),
  };
  // Platform owners have no email, so search and description name only what exists.
  const withEmail = binding.variant !== "platform";

  // Step 2: URL state and the one-off notice.
  const query  = parseRbacListQuery(searchParams);
  const notice = rbacNoticeMessage(searchParams.notice);

  // Step 3: summary, the requested page and the role filter's choices (every role
  // with the roles view privilege, else the assignable ones, else no filter).
  const summary     = await getSubUserSummary(actor);
  const page        = await listSubUsers(actor, toSubUserListQuery(searchParams));
  const roleOptions = await listRoleFilterOptions(actor);

  const addButton = permissions.create ? (
    <Button asChild>
      <Link href={`${binding.list}/new`}>
        <PlusIcon aria-hidden="true" />
        {binding.addLabel}
      </Link>
    </Button>
  ) : undefined;

  const frame = {
    gutterClassName: binding.gutterClassName,
    eyebrow: binding.eyebrow,
    title: binding.plural,
    description: binding.description,
    actions: addButton,
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

  // Step 5: the page. Suspend/Reactivate sends the change each row's button means
  // (computed by the shared row actions from the shown status; the service
  // refuses a stale change), so the panel's action is passed as is.
  return (
    <ScreenFrame {...frame}>
      <SectionedLayout items={LIST_MENU} variant="top" contentClassName="flex flex-col gap-6">
        <section id={LIST_SECTIONS.summary.id} aria-labelledby={`${LIST_SECTIONS.summary.id}-title`} className="flex flex-col gap-3">
          <h2 id={`${LIST_SECTIONS.summary.id}-title`} className="text-base font-semibold">
            Summary
          </h2>
          <SubUsersSummary counts={summary.data} nounPlural={binding.plural} loadUsers={binding.actions.loadUsers} />
        </section>

        <section id={LIST_SECTIONS.directory.id} aria-labelledby={`${LIST_SECTIONS.directory.id}-title`}>
          <Card>
            <CardHeader>
              <CardTitle>
                <h2 id={`${LIST_SECTIONS.directory.id}-title`} className="text-base font-semibold">
                  {binding.plural}
                </h2>
              </CardTitle>
              <CardDescription>
                {withEmail
                  ? "Search and filter by name, username, email, status or role."
                  : "Search by name or username and filter by status or role."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <RbacToolbar
                basePath={binding.list}
                query={query}
                searchPlaceholder={withEmail ? "Name, username or email" : "Name or username"}
                statusLabels={{ active: "Active", disabled: "Suspended" }}
                roleOptions={roleOptions}
              />
              <SubUsersDirectory
                variant={binding.variant}
                page={toPageView(page.data, toSubUserRowView)}
                query={query}
                basePath={binding.list}
                permissions={permissions}
                toggleStatusAction={permissions.suspend ? binding.actions.setStatus : undefined}
              />
            </CardContent>
          </Card>
        </section>
      </SectionedLayout>
    </ScreenFrame>
  );
}

type SubUserFormScreenProps = {
  /** The panel's binding (variant, texts, paths, page guard, bound Server Actions). */
  binding: SubUserScreenBinding;
  mode: "create" | "edit";
  /** Edit only: the `[id]` route segment (untrusted; the service validates and scopes it). */
  userId?: string;
};

/**
 * Description: The create / edit page of a sub-user (UI spec "Sub-user form").
 * Input: The panel's binding, the mode and the user id (edit).
 * Output: Without the users create (create) / edit (edit) privilege the
 *   access-denied state. Otherwise the shared SubUserForm with the roles the
 *   actor may assign (exactly one is submitted); edit is prefilled. Edit:
 *   unknown/malformed/out-of-scope id → 404; an account the viewer may not
 *   manage (own, primary, above the ceiling) → the access-denied state with
 *   the reason.
 * Use case: /platform/users/new|[id]/edit, /tenant/users/new|[id]/edit and
 *   /customer/sub-customers/new|[id]/edit.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function SubUserFormScreen({ binding, mode, userId }: SubUserFormScreenProps) {
  // Step 1: session + the page privilege of this mode (else access denied).
  const title  = mode === "create" ? binding.addLabel : `Edit ${binding.singular}`;
  const access = await binding.pageActor(mode === "create" ? "usersCreate" : "usersEdit");
  if (!access.ok) return <ActorFallback binding={binding} result={access} title={title} />;
  const actor = access.actor;

  // Step 2 (create): the roles the actor may assign; the action redirects to the list on success.
  if (mode === "create") {
    const roles = await listAssignableRoles(actor);
    if (!roles.ok && roles.reason === "forbidden") {
      return <DeniedScreen gutterClassName={binding.gutterClassName} homeHref={binding.home} description={roles.error} />;
    }
    return (
      <ScreenFrame
        gutterClassName={binding.gutterClassName}
        eyebrow={binding.eyebrow}
        title={binding.addLabel}
        description="The new account can log in as soon as it is created. It gets exactly one role."
        backHref={binding.list}
        backLabel={binding.plural}
      >
        {roles.ok ? (
          <SubUserForm
            variant={binding.variant}
            mode="create"
            roles={roles.data.map(toRoleOptionView)}
            action={binding.actions.create}
            cancelHref={binding.list}
          />
        ) : (
          <LoadFailed message={roles.error} />
        )}
      </ScreenFrame>
    );
  }

  // Step 3 (edit): the account inside the actor's scope.
  const model = await getSubUserEditModel(actor, userId ?? "");
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
        backLabel={binding.plural}
      >
        <LoadFailed message={model.error} />
      </ScreenFrame>
    );
  }

  // Step 4: only manageable accounts can be edited (never own, primary or above the ceiling).
  const { user, manageable, manageableReason, assignableRoles } = model.data;
  if (!manageable) {
    return (
      <DeniedScreen
        gutterClassName={binding.gutterClassName}
        homeHref={binding.home}
        description={POLICY_DENIAL_MESSAGES[manageableReason ?? "out_of_scope"]}
      />
    );
  }

  // Step 5: the prefilled form; the user id is bound on the server (the service re-checks it).
  return (
    <ScreenFrame
      gutterClassName={binding.gutterClassName}
      eyebrow={binding.eyebrow}
      title={`Edit ${user.fullName}`}
      description={
        binding.variant === "platform"
          ? "Change the name, the role or set a new password. A role change takes effect on the next request."
          : "Change the name, the role or set a new password. Username and email stay as they are."
      }
      backHref={binding.list}
      backLabel={binding.plural}
    >
      <SubUserForm
        variant={binding.variant}
        mode="edit"
        roles={assignableRoles.map(toRoleOptionView)}
        initial={{
          fullName: user.fullName,
          username: user.username ?? "",
          email: user.email,
          ...(user.accountType ? { accountType: user.accountType } : {}),
          roleId: user.roleId ?? "",
        }}
        action={binding.actions.update.bind(null, user.id)}
        cancelHref={binding.list}
      />
    </ScreenFrame>
  );
}
