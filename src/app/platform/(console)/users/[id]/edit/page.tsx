import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SUB_PLATFORM_OWNER_SCREENS } from "@/app/platform/(console)/rbac-bindings";
import { ActorFallback, DeniedScreen, LoadFailed, ScreenFrame } from "@/components/rbac/screens/screen-parts";
import { toRoleOptionView } from "@/lib/authz/management-view";
import { listAssignableRoles } from "@/lib/authz/role-service";
import { getSubUserEditModel } from "@/lib/authz/sub-user-service";
import { PlatformOwnerForm } from "../../_components/platform-owner-form";
import { updateSubPlatformOwnerAction } from "../../actions";

export const metadata: Metadata = { title: "Edit Platform Owner" };

type PageProps = {
  params: Promise<{ id: string }>;
};

/**
 * Description: Dedicated Edit Platform Owner Page.
 * Input: Platform owner ID from route params.
 * Output: Pre-filled PlatformOwnerForm with authorized roles.
 * Use case: /platform/users/[id]/edit
 * Author: Mr. Sachin Sharma
 * Created: 2026-11-24
 * Last modified: 2026-11-24
 */
export default async function EditPlatformOwnerPage({ params }: PageProps) {
  const { id } = await params;
  const binding = SUB_PLATFORM_OWNER_SCREENS;
  const access = await binding.pageActor("usersEdit");
  if (!access.ok) {
    return <ActorFallback binding={binding} result={access} title="Edit Platform Owner" />;
  }

  const actor = access.actor;
  const [modelResult, rolesResult] = await Promise.all([
    getSubUserEditModel(actor, id),
    listAssignableRoles(actor),
  ]);

  if (!modelResult.ok) {
    if (modelResult.reason === "validation") notFound();
    return (
      <ScreenFrame
        gutterClassName={binding.gutterClassName}
        title="Edit Platform Owner"
        eyebrow={binding.eyebrow}
      >
        {modelResult.reason === "forbidden" ? (
          <DeniedScreen
            gutterClassName={binding.gutterClassName}
            homeHref={binding.home}
            description={modelResult.error}
          />
        ) : (
          <LoadFailed message={modelResult.error} />
        )}
      </ScreenFrame>
    );
  }

  if (!rolesResult.ok) {
    return (
      <ScreenFrame
        gutterClassName={binding.gutterClassName}
        title="Edit Platform Owner"
        eyebrow={binding.eyebrow}
      >
        <LoadFailed message="Assignable roles could not be loaded. Please refresh the page." />
      </ScreenFrame>
    );
  }

  const roleOptions = rolesResult.data.map(toRoleOptionView);
  const targetUser = modelResult.data.user;

  // Bind userId to the server update action
  const boundUpdateAction = updateSubPlatformOwnerAction.bind(null, id);

  return (
    <ScreenFrame
      gutterClassName={binding.gutterClassName}
      title={`Edit ${targetUser.fullName}`}
      description="Update profile details, mobile number, role assignment, or reset password."
      eyebrow={binding.eyebrow}
    >
      <PlatformOwnerForm
        mode="edit"
        roles={roleOptions}
        action={boundUpdateAction}
        cancelHref={binding.list}
        initial={{
          fullName: targetUser.fullName,
          email: targetUser.email,
          phone: targetUser.phone ?? null,
          roleId: targetUser.roleId ?? "",
          status: targetUser.status === "active" ? "active" : "disabled",
        }}
      />
    </ScreenFrame>
  );
}
