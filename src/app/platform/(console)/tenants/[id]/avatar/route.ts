/**
 * GET /platform/tenants/<id>/avatar: a tenant's profile image
 * (docs/tenant-management.md §8.6).
 *
 * Route handlers are not wrapped by the console layout, so the session is
 * checked here. Without one the answer is the same 404 as for a missing
 * image: the route reveals nothing about which tenants exist. The session
 * cookie's path (/platform) covers this URL.
 */
import { getPlatformSession } from "@/lib/platform-auth/dal";
import { describeError } from "@/lib/platform-auth/session";
import { readProfileImage } from "@/lib/storage/profile-images";
import { UUID_PATTERN } from "@/lib/uuid";

/**
 * Description: Build the route's 404 answer.
 * Input: None.
 * Output: A plain, uncached 404 (also used without a session, so the route reveals
 *   nothing about which tenants exist).
 * Use case: GET.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Description: Serve a tenant's profile image to the signed-in owner.
 * Input: The request and the route parameters (tenant id).
 * Output: The image (sniffed type, nosniff, sandboxed CSP, private cache) or 404
 *   for no session, a bad id, no image or a read failure (logged).
 * Use case: GET /platform/tenants/<id>/avatar (avatars in the console).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getPlatformSession();
  if (!session) return notFound();

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return notFound();

  let image: Awaited<ReturnType<typeof readProfileImage>>;
  try {
    image = await readProfileImage(id);
  } catch (error) {
    console.error(`[tenants] could not read the profile image of ${id}: ${describeError(error)}`);
    return notFound();
  }
  if (!image) return notFound();

  return new Response(image.bytes as Uint8Array<ArrayBuffer>, {
    status: 200,
    headers: {
      "Content-Type": image.contentType,
      "Content-Length": String(image.bytes.byteLength),
      // The bytes were sniffed on upload; the browser must not re-guess the type.
      "X-Content-Type-Options": "nosniff",
      // Opened directly, the image cannot run anything or load anything else.
      "Content-Security-Policy": "default-src 'none'; sandbox",
      // Private: only the signed-in owner's browser may keep it.
      "Cache-Control": "private, max-age=300",
    },
  });
}
