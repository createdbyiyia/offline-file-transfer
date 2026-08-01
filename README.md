# Optical Transfer — send files from PC to phone with no internet

Send a file between two devices using nothing but a **screen and a camera**.
The computer displays the file as an endless stream of animated QR codes; the
phone points its camera at it and reconstructs the file. **No internet, no
Wi-Fi, no Bluetooth, no cable, no app, no pairing** — the payload travels as
light.

**Live:** https://createdbyiyia.github.io/offline-file-transfer/

- **Send** (on the computer): open `/send/`, choose any file, and it starts
  streaming animated QR codes. Max screen brightness helps.
- **Receive** (on the phone): open `/receive/`, tap **Start camera**, and point
  it at the code. A few seconds later the file downloads, verified by checksum.

Fountain coding (Luby transform) means the receiver can drop any frames, in any
order, and still rebuild the file — dropped frames cost a little time, never
correctness.

## Run it locally

```bash
npm install
npm run dev
```

Open `https://localhost:5173/send/` on the computer and the `Network` URL Vite
prints (`https://<lan-ip>:5173/receive/`) on the phone. The dev server is
HTTPS-only because the receiver needs `getUserMedia`, which browsers disable on
insecure origins for non-localhost hosts; accept the self-signed certificate
once and the camera works.

## Build & deploy (static)

```bash
npm run build                                  # → dist/ (relative asset paths)
npx vite build --base=/offline-file-transfer/  # for a GitHub Pages project site
```

The output in `dist/` is fully static — HTML, JS and the QR-decoder WASM are all
served locally, so once the pages load the transfer itself works completely
offline.

## Credit

Based on [decimen-optical-transfer](https://github.com/bashalarmistalt/decimen-optical-transfer)
by bashalarmistalt (MIT). This fork adds an arbitrary-file picker, a file
metadata envelope so transfers keep their original name and type, a download
step on the receiver, and an SEO landing page. Original license retained in
[LICENSE](LICENSE).
