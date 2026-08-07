// Sender: turn a file into an endless fountain-coded QR stream.
//
// Tuning notes from the experiments this PoC is distilled from:
// - Frame payload sets the QR version; denser wins on goodput as long as the
//   receiver can still decode it. 1465 bytes ≈ V27 is a safe middle ground
//   for arbitrary monitors; 2953 (V40) is the ceiling and works phone-to-
//   phone at close range.
// - The mask pattern is pinned (any declared mask is valid to a decoder);
//   this skips the spec's 8-way mask evaluation and speeds generation ~4×.
// - Displays need each frame shown for ≥2 refresh cycles or captures catch
//   the transition; 24 fps on a 60 Hz screen is comfortable.
// - Error correction stays at L by default: the fountain layer already
//   handles erasures, and a frame is either decoded whole or discarded.

import QRCode from "qrcode";
import { LTEncoder } from "../shared/fountain";
import { HEADER_LEN, fnv1a, packFrame, type FrameHeader } from "../shared/protocol";
import { wrapPayload, type FileMeta } from "../shared/filemeta";

const MARGIN = 4; // quiet-zone modules
const LOOKAHEAD = 3;

const canvas = document.getElementById("qr") as HTMLCanvasElement;
const specs = document.getElementById("specs")!;
const cfgFile = document.getElementById("cfg-file") as HTMLInputElement;
const filename = document.getElementById("filename")!;
const cfgPayload = document.getElementById("cfg-payload") as HTMLSelectElement;
const cfgFps = document.getElementById("cfg-fps") as HTMLSelectElement;
const cfgBytes = document.getElementById("cfg-bytes") as HTMLSelectElement;
const cfgEcc = document.getElementById("cfg-ecc") as HTMLSelectElement;
const cfgSize = document.getElementById("cfg-size") as HTMLInputElement;
const cfgGrid = document.getElementById("cfg-grid") as HTMLSelectElement;

const payloadCache = new Map<string, Uint8Array>();
let generation = 0; // bumped on every restart; stale loops see it and die

// A user-chosen file, when present, wins over the demo dropdown.
let chosenFile: { bytes: Uint8Array; meta: FileMeta } | null = null;

async function loadPayload(url: string): Promise<Uint8Array | null> {
  const hit = payloadCache.get(url);
  if (hit) return hit;
  const res = await fetch(url);
  if (!res.ok) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  payloadCache.set(url, bytes);
  return bytes;
}

// The bytes actually streamed = file metadata envelope + file contents, so the
// receiver can restore the original name and MIME type.
async function currentPayload(): Promise<Uint8Array | null> {
  if (chosenFile) return wrapPayload(chosenFile.bytes, chosenFile.meta);
  const bytes = await loadPayload(cfgPayload.value);
  if (!bytes) return null;
  const name = cfgPayload.value.split("/").pop() || "image.png";
  return wrapPayload(bytes, { name, type: "image/png" });
}

// Idle state: instead of streaming a demo the moment the page opens, show a
// static QR that opens the receiver on the phone — one scan, no typing an IP.
// Streaming begins only once a file is chosen.
async function showReceiverQR() {
  const recv = new URL("../receive/", location.href).href;
  try {
    await QRCode.toCanvas(canvas, recv, {
      width: 340,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#000000", light: "#ffffff" },
    });
  } catch {
    /* ignore */
  }
  specs.textContent = "Point your phone's camera here to open the receiver, then choose a file to send.";
}

async function main() {
  cfgFile.addEventListener("change", async () => {
    const f = cfgFile.files?.[0];
    if (!f) return;
    chosenFile = {
      bytes: new Uint8Array(await f.arrayBuffer()),
      meta: { name: f.name, type: f.type || "application/octet-stream" },
    };
    filename.textContent = `${f.name} · ${Math.round(f.size / 1024)} KB`;
    void startStream();
  });
  for (const el of [cfgPayload, cfgFps, cfgBytes, cfgEcc, cfgSize, cfgGrid]) {
    el.addEventListener("change", () => {
      if (el === cfgPayload) {
        // Picking a demo image clears any user file selection.
        chosenFile = null;
        cfgFile.value = "";
        filename.textContent = "no file chosen — sending demo image";
      }
      void startStream();
    });
  }
  void showReceiverQR();
  try {
    await (navigator as Navigator & { wakeLock?: { request(t: "screen"): Promise<unknown> } })
      .wakeLock?.request("screen");
  } catch {
    /* fine without it */
  }
}

async function startStream() {
  const gen = ++generation;
  const payload = await currentPayload();
  if (!payload) {
    specs.textContent = `✗ couldn't load payload`;
    return;
  }
  if (gen !== generation) return; // superseded while fetching
  const txFps = Number(cfgFps.value);
  const frameBytes = Number(cfgBytes.value);
  const ecc = cfgEcc.value as "L" | "M" | "Q" | "H";
  const displayPx = Number(cfgSize.value);
  const grid = Number(cfgGrid.value); // g×g QR codes shown at once → ~g² throughput

  const sessionId = (Math.floor(Math.random() * 0xffff) + 1) & 0xffff;
  const blockLen = frameBytes - HEADER_LEN;
  const encoder = new LTEncoder(payload, blockLen, sessionId);
  const header: FrameHeader = {
    sessionId,
    seq: 0,
    k: encoder.k,
    blockLen,
    totalLen: payload.length,
    payloadFnv: fnv1a(payload),
  };

  let version: number | undefined; // locked after the first code
  let modules = 0;
  let scale = 1;
  const staging = document.createElement("canvas");
  const queue: ImageData[] = [];
  let nextSeq = 0;

  const sizeCanvas = () => {
    const dpr = window.devicePixelRatio || 1;
    const total = (modules + 2 * MARGIN) * grid;
    const cssBudget = Math.min(0.92 * Math.min(window.innerWidth, window.innerHeight), displayPx);
    scale = Math.max(1, Math.floor((cssBudget * dpr) / total));
    staging.width = total;
    staging.height = total;
    canvas.width = total * scale;
    canvas.height = total * scale;
    canvas.style.width = `${(total * scale) / dpr}px`;
    canvas.style.height = `${(total * scale) / dpr}px`;
  };

  // One QR for a given seq. Version/module count lock on the very first code so
  // every cell in the grid tiles at exactly the same size.
  const makeQR = (seq: number): { size: number; data: Uint8Array } => {
    const bytes = packFrame({ ...header, seq }, encoder.encode(seq));
    const qr = QRCode.create([{ data: bytes, mode: "byte" } as unknown as QRCode.QRCodeSegment], {
      errorCorrectionLevel: ecc,
      version,
      maskPattern: 4,
    });
    if (version === undefined) {
      version = qr.version;
      modules = qr.modules.size;
      sizeCanvas();
      const codes = grid * grid;
      const eta = Math.ceil((encoder.k * 1.18) / (txFps * codes));
      specs.textContent =
        `${txFps} FPS · ${grid}×${grid} codes · ${frameBytes} B/code · V${version} · ECC ${ecc} · ` +
        `${Math.round(payload.length / 1024)} KB · K=${encoder.k} · ~${eta}s+`;
    }
    return qr.modules as { size: number; data: Uint8Array };
  };

  // A displayed frame is a g×g grid of independent fountain codes. The camera
  // captures the whole grid in one shot, so the receiver pulls g² frames each
  // capture — throughput scales with the grid, correctness does not depend on it.
  const makeGridFrame = (): ImageData => {
    const cells: { size: number; data: Uint8Array }[] = [];
    for (let i = 0; i < grid * grid; i++) cells.push(makeQR(nextSeq++));
    const cell = modules + 2 * MARGIN;
    const total = cell * grid;
    const img = new ImageData(total, total);
    const px = new Uint32Array(img.data.buffer);
    px.fill(0xffffffff);
    for (let gy = 0; gy < grid; gy++) {
      for (let gx = 0; gx < grid; gx++) {
        const qr = cells[gy * grid + gx]!;
        const size = qr.size;
        const data = qr.data;
        const ox = gx * cell + MARGIN;
        const oy = gy * cell + MARGIN;
        for (let y = 0; y < size; y++) {
          const row = (oy + y) * total + ox;
          const src = y * size;
          for (let x = 0; x < size; x++) {
            if (data[src + x]) px[row + x] = 0xff000000;
          }
        }
      }
    }
    return img;
  };

  const pump = () => {
    if (gen !== generation) return; // superseded by a settings change
    try {
      while (queue.length < LOOKAHEAD) queue.push(makeGridFrame());
    } catch (err) {
      // e.g. frame bytes over capacity for the chosen ECC level
      specs.textContent = `✗ ${err instanceof Error ? err.message : String(err)}`;
      return;
    }
    setTimeout(pump, 0);
  };
  pump();

  const interval = 1000 / txFps;
  let nextAt = performance.now();
  const tick = (now: number) => {
    if (gen !== generation) return;
    requestAnimationFrame(tick);
    if (now < nextAt) return;
    const img = queue.shift();
    if (!img) {
      nextAt = now + interval;
      return;
    }
    staging.getContext("2d")!.putImageData(img, 0, 0);
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(staging, 0, 0, canvas.width, canvas.height);
    nextAt += interval;
    if (now - nextAt > 3 * interval) nextAt = now + interval; // fell behind — don't burst
  };
  requestAnimationFrame(tick);
}

void main();
