"use client";

/**
 * Error boundary of the root route ("/"), e.g. when a tenant's database is
 * temporarily unreachable while its welcome page is rendered. The platform
 * console keeps its own boundary (src/app/platform/error.tsx).
 */
export { WorkspaceError as default } from "@/components/workspace/workspace-error";
