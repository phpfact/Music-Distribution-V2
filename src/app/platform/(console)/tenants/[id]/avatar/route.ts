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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
