import type { Metadata } from "next";
import { SUB_PLATFORM_OWNER_SCREENS } from "@/app/platform/(console)/rbac-bindings";
import { ActorFallback, DeniedScreen, LoadFailed, ScreenFrame } from "@/components/rbac/screens/screen-parts";
import { toRoleOptionView } from "@/lib/authz/management-view";
import { listAssignableRoles } from "@/lib/authz/role-service";
import { PlatformOwnerForm } from "../_components/platform-owner-form";
import { createSubPlatformOwnerAction } from "../actions";

export const metadata: Metadata = { title: "Create Platform Owner" };

/**
 * Description: Dedicated Create Platform Owner Page with 7 mandatory fields.
 * Input: None.
 * Output: Dedicated creation form with authorized assignable roles dropdown.
 * Use case: /platform/users/new
 * Author: Mr. Sachin Sharma
 * Created: 2026-11-24
 * Last modified: 2026-11-24
 */
export default async function CreatePlatformOwnerPage() {
  const binding = SUB_PLATFORM_OWNER_SCREENS;
  const access = await binding.pageActor("usersCreate");
  if (!access.ok) {
    return <ActorFallback binding={binding} result={access} title="Create Platform Owner" />;
  }

  const actor = access.actor;
  const rolesResult = await listAssignableRoles(actor);
  if (!rolesResult.ok) {
    return (
      <ScreenFrame
        gutterClassName={binding.gutterClassName}
        title="Create Platform Owner"
        eyebrow={binding.eyebrow}
      >
        {rolesResult.reason === "forbidden" ? (
          <DeniedScreen gutterClassName={binding.gutterClassName} homeHref={binding.home} />
        ) : (
          <LoadFailed message="Assignable roles could not be loaded. Please refresh the page." />
        )}
      </ScreenFrame>
    );
  }

  const roleOptions = rolesResult.data.map(toRoleOptionView);

  return (
    <ScreenFrame
      gutterClassName={binding.gutterClassName}
      title="Create Platform Owner"
      description="Create a new platform owner and assign their role immediately. Role selection is mandatory."
      eyebrow={binding.eyebrow}
    >
      <PlatformOwnerForm
        mode="create"
        roles={roleOptions}
        action={createSubPlatformOwnerAction}
        cancelHref={binding.list}
      />
    </ScreenFrame>
  );
}
