/**
 * Profile image checks (docs/tenant-management.md §8.6).
 *
 * The type is decided from the file's first bytes only: the client's content
 * type and file name are under the uploader's control. SVG is deliberately
 * not supported, since it can carry scripts. Pure, so the form can run the
 * same size/container check before uploading. Server storage additionally decodes
 * every image; a signature or complete container alone does not prove validity.
 */
import type { RuleResult } from "@/lib/tenants/rules";

export const MAX_PROFILE_IMAGE_BYTES = 2_097_152;
/** Bound decompression independently of the uploaded compressed byte count. */
export const MAX_PROFILE_IMAGE_PIXELS = 16_000_000;
/** For the file input's `accept` attribute; only a hint, the server sniffs. */
export const PROFILE_IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";

export type SniffedImage = {
  kind: "png" | "jpeg" | "webp";
  contentType: string;
  extension: "png" | "jpg" | "webp";
};

const PNG_SIGNATURE  = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const RIFF           = [0x52, 0x49, 0x46, 0x46];
const WEBP           = [0x57, 0x45, 0x42, 0x50];

/**
 * Description: Compare bytes at an offset with an expected signature.
 * Input: The file bytes, the offset and the expected bytes.
 * Output: True when the file is long enough and the bytes match.
 * Use case: sniffImage.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function startsWithAt(bytes: Uint8Array, offset: number, expected: number[]): boolean {
  return (
    bytes.length >= offset + expected.length &&
    expected.every((byte, index) => bytes[offset + index] === byte)
  );
}

/**
 * Description: Decide an image's type from its first bytes only.
 * Input: The file bytes.
 * Output: PNG, JPEG or WebP with its content type and extension, or null. The
 *   uploader's content type and file name are never trusted; SVG is not supported.
 * Use case: validateProfileImage.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  if (startsWithAt(bytes, 0, PNG_SIGNATURE)) {
    return { kind: "png", contentType: "image/png", extension: "png" };
  }
  if (startsWithAt(bytes, 0, JPEG_SIGNATURE)) {
    return { kind: "jpeg", contentType: "image/jpeg", extension: "jpg" };
  }
  // RIFF <4-byte size> WEBP
  if (startsWithAt(bytes, 0, RIFF) && startsWithAt(bytes, 8, WEBP)) {
    return { kind: "webp", contentType: "image/webp", extension: "webp" };
  }
  return null;
}

/**
 * Description: Check size, supported format and basic container completeness.
 * Input: The file bytes.
 * Output: The sniffed image, or the message: empty file, larger than 2 MB, or not
 *   PNG/JPEG/WebP, or a truncated image. This is not a pixel decoder: the server
 *   must also run normalizeProfileImage before storage.
 * Use case: Image picker feedback and the server's inexpensive preliminary checks.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function validateProfileImage(bytes: Uint8Array): RuleResult<SniffedImage> {
  if (bytes.length === 0) return { ok: false, error: "The file is empty. Choose an image file." };
  if (bytes.length > MAX_PROFILE_IMAGE_BYTES) {
    return { ok: false, error: "The image is larger than 2 MB. Choose a smaller image." };
  }
  const image = sniffImage(bytes);
  if (!image) return { ok: false, error: "Use a PNG, JPEG or WebP image." };
  // A signature identifies a format, but it must not count as a complete file.
  const pngComplete = image.kind === "png" && bytes.length >= 45 &&
    startsWithAt(bytes, 12, [0x49, 0x48, 0x44, 0x52]) &&
    startsWithAt(bytes, bytes.length - 12, [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44]);
  const jpegComplete = image.kind === "jpeg" && bytes.length >= 20 &&
    startsWithAt(bytes, bytes.length - 2, [0xff, 0xd9]);
  const webpSize = image.kind === "webp"
    ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true) + 8
    : 0;
  const webpComplete = image.kind === "webp" && bytes.length >= 20 && webpSize === bytes.length;
  if (!pngComplete && !jpegComplete && !webpComplete) {
    return { ok: false, error: "The image is incomplete or damaged. Choose a valid PNG, JPEG or WebP image." };
  }
  return { ok: true, value: image };
}
