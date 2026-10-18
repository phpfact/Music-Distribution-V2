import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { requestContextFromHeaders, type AuditRequestContext } from "./request-context";

/**
 * Description: Read the same sanitized request envelope throughout one HTTP request.
 * Input: None; Next.js provides the current headers when a request exists.
 * Output: Safe context, or null for CLI jobs/tests with no request scope.
 * Use case: Automatic context propagation for every administrative audit caller.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
export const currentRequestContext = cache(async (): Promise<AuditRequestContext | null> => {
  try {
    return requestContextFromHeaders(await headers());
  } catch {
    // Provisioning jobs and standalone services intentionally have no HTTP context.
    return null;
  }
});
