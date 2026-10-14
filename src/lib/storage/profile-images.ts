import "server-only";
/**
 * Tenant profile images (docs/tenant-management.md §8.6): checked by their
 * bytes, stored under a server-generated key, read back for the avatar route.
 */
import { getControlDb } from "../db/control";
import type { RuleResult } from "../tenants/rules";
import {
  InvalidStorageKeyError,
  profileImageKey,
  type ProfileImageExtension,
  readStoredFile,
  saveFile,
} from "./files";
import { validateProfileImage } from "./image";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The served type follows the stored key's extension, which the server chose
// from the sniffed bytes; never from what the uploader claimed.
const CONTENT_TYPES: Record<ProfileImageExtension, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};

/**
 * Validates and stores a new profile image for the tenant; returns its key.
 * An invalid image is a result (shown next to the field); a storage failure throws.
 */
export async function storeProfileImage(
  tenantId: string,
  bytes: Uint8Array,
): Promise<RuleResult<string>> {
  const image = validateProfileImage(bytes);
  if (!image.ok) return image;
  const key = profileImageKey(tenantId, image.value.extension);
  await saveFile(key, bytes);
  return { ok: true, value: key };
}

function contentTypeOf(key: string): string | null {
  const extension = key.slice(key.lastIndexOf(".") + 1) as ProfileImageExtension;
  return CONTENT_TYPES[extension] ?? null;
}

/** The tenant's current profile image, or null when it has none (or the file is gone). */
export async function readProfileImage(
  tenantId: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  if (!UUID_PATTERN.test(tenantId)) return null;
  const tenant = await getControlDb().tenant.findUnique({
    where: { id: tenantId },
    select: { profileImageKey: true },
  });
  const key = tenant?.profileImageKey;
  if (!key) return null;
  const contentType = contentTypeOf(key);
  if (!contentType) return null;
  try {
    const bytes = await readStoredFile(key);
    return bytes ? { bytes: new Uint8Array(bytes), contentType } : null;
  } catch (error) {
    // A stored key that is not one we generate is treated as no image.
    if (error instanceof InvalidStorageKeyError) return null;
    throw error;
  }
}
