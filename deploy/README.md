# Private STB deployment

This deployment serves the scanner on ARM64 Armbian using a dedicated Node 24 runtime and an unprivileged `pdf-scanner` systemd service. It does not install to or modify eMMC. The web server listens only on `127.0.0.1:3000`; Tailscale Serve provides private HTTPS.

## Features and limits

- Camera/gallery scanning, image enhancement, browser PDF export, browser merge/split, and shared phone/desktop scan session.
- Server session is saved in `/var/lib/pdf-scanner/session.json` using an atomic file replacement, including fsync before replacement.
- One shared session for devices permitted to reach this service in the tailnet. This is not a multi-user document vault.
- Limit: 30 pages, 4 MiB per encoded image, 24 MiB per session. Export PDF and delete old pages when full.
- Conditional polling avoids resending unchanged scan images.
- Server conversions (Word/PDF conversion, compression, PDF images) are disabled on the STB and indicated in the interface. Local laptop behavior stays enabled by default. They require separately installed browser/Python dependencies and resource review before enabling.
- Session persistence is not a backup. Keep exported PDFs and an additional copy on another device. Flash wear, sudden power loss, and filesystem damage can still lose documents.

## Install/update

From PowerShell in this project directory, package only deployment files:

Prepare the browser OCR engine and Indonesian/English models on the packaging computer first. The generated `public/assets/ocr/` directory must be included in the archive. The STB still runs without Node dependencies; OCR processing uses the visiting phone/desktop browser.

```powershell
npm.cmd ci
npm.cmd run prepare:ocr
tar -czf "$env:TEMP\pdf-scanner-release.tar.gz" server.mjs session-store.mjs converters.mjs public deploy
scp -i "$env:USERPROFILE\.ssh\id_ed25519_stb" "$env:TEMP\pdf-scanner-release.tar.gz" root@192.168.1.20:/tmp/pdf-scanner-release.tar.gz
scp -i "$env:USERPROFILE\.ssh\id_ed25519_stb" deploy/install-stb.sh root@192.168.1.20:/tmp/pdf-scanner-install.sh
ssh -i "$env:USERPROFILE\.ssh\id_ed25519_stb" root@192.168.1.20 'bash /tmp/pdf-scanner-install.sh'
```

Before replacing a running deployment, copy `/var/lib/pdf-scanner/session.json` to another device if it exists.

Authenticate Tailscale on the STB with `tailscale up --hostname=stb-scanner`. Use the same tailnet as the phone/laptop. Read the DNS name using `tailscale status --json`; add that exact DNS hostname (without its trailing dot) to `TRUSTED_HOSTS` in `/etc/pdf-scanner.conf`, keeping `127.0.0.1,localhost` as well. Restart `pdf-scanner` and run:

```bash
tailscale serve --bg http://127.0.0.1:3000
```

If HTTPS requires activation, follow the Tailscale-provided account URL. Use Serve for tailnet access; do not enable public Funnel for personal documents. Tailnet access policy must allow only the intended devices/users.

## Operations

After saving a scan, copy the shared session to the laptop with `./deploy/backup-stb.ps1` from PowerShell. The script saves timestamped JSON files under Documents/STB Backups/PDF Scanner, outside this repository. Keep exported PDFs as an additional, portable copy. This backup is manual; no automatic backup job is configured.

```bash
systemctl status pdf-scanner
journalctl -u pdf-scanner -n 30 --no-pager
curl --fail http://127.0.0.1:3000/healthz
tailscale serve status
```

To stop the app while preserving documents: `systemctl disable --now pdf-scanner`. To remove its private HTTPS proxy: `tailscale serve --https=443 off` (only if no other service shares this proxy).

## Verification

```powershell
node --test test/server.test.mjs
node test/browser-smoke.mjs
```

The browser test uses installed Microsoft Edge on Windows (override with `BROWSER_EXECUTABLE`). Tests create isolated temporary sessions and do not touch saved user documents. Physical phone camera permission and capture still require a phone check over the final HTTPS address.
