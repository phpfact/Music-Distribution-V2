import "server-only";
import sharp from "sharp";
import type { RuleResult } from "@/lib/tenants/rules";
import { MAX_PROFILE_IMAGE_BYTES, MAX_PROFILE_IMAGE_PIXELS, validateProfileImage, type SniffedImage } from "./image";

/**
 * Description: Decode uploaded avatar pixels and re-encode a supported clean image.
 * Input: Untrusted compressed PNG, JPEG or WebP bytes, at most 2 MiB.
 * Output: Clean bytes and their detected type, or a friendly field validation error.
 * Use case: storeProfileImage, before any storage key or file is created.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
export async function normalizeProfileImage(
  bytes: Uint8Array,
): Promise<RuleResult<{ bytes: Uint8Array; image: SniffedImage }>> {
  const checked = validateProfileImage(bytes);
  if (!checked.ok) return checked;
  try {
    // Full toBuffer decoding catches damaged pixel streams that metadata() alone
    // would accept. Default encoding strips EXIF/comments and appended payloads.
    const normalized = await sharp(bytes, { failOn: "warning", limitInputPixels: MAX_PROFILE_IMAGE_PIXELS })
      .rotate()
      .toFormat(checked.value.kind)
      .timeout({ seconds: 5 })
      .toBuffer();
    if (normalized.length > MAX_PROFILE_IMAGE_BYTES) {
      return { ok: false, error: "The decoded image is too large. Choose a smaller image." };
    }
    return { ok: true, value: { bytes: normalized, image: checked.value } };
  } catch {
    // Decoder diagnostics may expose details of malformed input; show fixed text.
    return { ok: false, error: "The image is damaged or exceeds the 16 megapixel limit. Choose a smaller valid image." };
  }
}
