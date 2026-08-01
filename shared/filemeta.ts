// File metadata envelope. The fountain layer carries an opaque byte payload,
// so to move a *named* file (not just an anonymous image) we prepend a small
// header describing it and strip it back off on the receiver. It rides inside
// the payload, so the hash still covers name+type — a corrupted name fails the
// same check as corrupted bytes.
//
// Layout (little-endian):
//   0  u8   magic 0xF1
//   1  u8   magic 0x1E
//   2  u16  jsonLen
//   4  ...  jsonLen bytes of UTF-8 JSON {name, type}
//   ...     the original file bytes

const M0 = 0xf1;
const M1 = 0x1e;

export interface FileMeta {
  name: string;
  type: string;
}

export function wrapPayload(file: Uint8Array, meta: FileMeta): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(meta));
  const out = new Uint8Array(4 + json.length + file.length);
  const dv = new DataView(out.buffer);
  dv.setUint8(0, M0);
  dv.setUint8(1, M1);
  dv.setUint16(2, json.length, true);
  out.set(json, 4);
  out.set(file, 4 + json.length);
  return out;
}

export function unwrapPayload(
  payload: Uint8Array,
): { meta: FileMeta; file: Uint8Array } | null {
  if (payload.length < 4 || payload[0] !== M0 || payload[1] !== M1) return null;
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const jsonLen = dv.getUint16(2, true);
  if (payload.length < 4 + jsonLen) return null;
  try {
    const meta = JSON.parse(
      new TextDecoder().decode(payload.subarray(4, 4 + jsonLen)),
    ) as FileMeta;
    if (typeof meta?.name !== "string") return null;
    return { meta, file: payload.subarray(4 + jsonLen) };
  } catch {
    return null;
  }
}
