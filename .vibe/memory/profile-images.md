# Profile Images

## Overview and flow

Tenant create/edit accepts PNG, JPEG and WebP up to 2 MiB. Browser checks give
early size/type feedback. The server owns final validity: sniff the format, decode
all pixels under resource limits, then re-encode without uploaded metadata before
saving a server-generated tenant storage key. SVG and other formats are refused.

## Requested audit remediation (2026-10-17)

- AUD-020: header-only and corrupt files must never be stored. Shared lightweight
  validation rejects incomplete file containers; server `sharp` decoding verifies
  actual pixels, with a 16-megapixel input limit and five-second processing limit.
- Preserve PNG/JPEG/WebP format and extension; strip metadata, normalize the first
  frame for the avatar, and ensure re-encoded bytes remain within the size limit.
- Field errors remain friendly; invalid input never creates a storage file.
- Tests cover all three valid formats, header-only/truncated data, corrupt pixels,
  oversized dimensions and a decode of stored output.

## Change history

- 2026-10-17: Recorded AUD-020 server decode/normalization requirements before code.
