import type { Metadata } from "next";
import { Card, CardContent } from "@/components/ui/card";
import { AccessDenied } from "@/components/shared";
import { getControlDb } from "@/lib/db/control";
import { listPlatformModules } from "@/lib/authz/module-service";
import { requirePlatformAccess } from "@/lib/authz/platform";
import { ModuleToggleList } from "../../_components/module-toggle-list";
import { PageHeader } from "../../_components/page-header";
import { getNavItem } from "../../navigation";

export const metadata: Metadata = { title: "Modules" };

/**
 * Description: Render the platform module switches (.vibe/memory/role-privilege-management.md,
 *   "Module switches").
 * Input: None (the session and the privileges are checked on the server).
 * Output: The page header and one row per platform module (label, description,
 *   privileges, a Switch or the "Core · always on" lock badge). Without
 *   platform.modules.manage the inline access-denied state (HTTP 200) is shown
 *   before anything is read.
 * Use case: /platform/settings/modules — the Platform Owner switches platform
 *   modules on or off for every role, including Master Platform.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export default async function PlatformModulesPage() {
  // Step 1: session and CURRENT privileges, checked on every request.
  const { access } = await requirePlatformAccess();
  if (!access.can("platform.modules.manage")) return <AccessDenied homeHref={getNavItem("dashboard").href} />;

  // Step 2: the platform modules with their platform-wide state (read fresh).
  const modules = await listPlatformModules(getControlDb());

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader
        eyebrow="Settings"
        title="Modules"
        description="Switch platform modules on or off for everyone. A module that is off removes its privileges from every role at once; core modules are always on so nobody is locked out."
      />
      <Card className="py-0">
        <CardContent className="px-5 py-1">
          <ModuleToggleList target={{ scope: "platform" }} groups={[{ id: "platform", modules }]} canManage />
        </CardContent>
      </Card>
    </div>
  );
}
