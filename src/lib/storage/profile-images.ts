import "server-only";
/**
 * Tenant profile images (docs/tenant-management.md §8.6): checked by their
 * bytes, decoded and normalized before storage under a server-generated key,
 * then read back for the avatar route.
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
import { normalizeProfileImage } from "./normalize-image";
import { UUID_PATTERN } from "@/lib/uuid";

// The served type follows the stored key's extension, which the server chose
// from the sniffed bytes; never from what the uploader claimed.
const CONTENT_TYPES: Record<ProfileImageExtension, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};

/**
 * Description: Validate and store a new profile image for a tenant.
 * Input: The tenant id and the uploaded bytes.
 * Output: The new storage key, or the validation message (shown next to the field);
 *   a storage failure throws.
 * Use case: Tenant create and edit services.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-17
 */
export async function storeProfileImage(
  tenantId: string,
  bytes: Uint8Array,
): Promise<RuleResult<string>> {
  const normalized = await normalizeProfileImage(bytes);
  if (!normalized.ok) return normalized;
  const key = profileImageKey(tenantId, normalized.value.image.extension);
  await saveFile(key, normalized.value.bytes);
  return { ok: true, value: key };
}

/**
 * Description: Derive the served content type from a stored key's extension.
 * Input: The storage key.
 * Output: image/png, image/jpeg or image/webp, or null for an unknown extension.
 *   The server chose the extension from the sniffed bytes.
 * Use case: readProfileImage.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function contentTypeOf(key: string): string | null {
  const extension = key.slice(key.lastIndexOf(".") + 1) as ProfileImageExtension;
  return CONTENT_TYPES[extension] ?? null;
}

/**
 * Description: Read a tenant's current profile image.
 * Input: The tenant id (UUID-validated here).
 * Output: The bytes and content type, or null when the tenant has no image, the file
 *   is gone or the stored key is not one the server generates.
 * Use case: The protected avatar route.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
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
