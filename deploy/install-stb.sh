#!/bin/bash
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then echo 'Run as root'; exit 1; fi
if [ "$(uname -m)" != 'aarch64' ]; then echo 'This installer requires ARM64'; exit 1; fi
test -f /tmp/pdf-scanner-release.tar.gz
install -d -m 0755 /opt/pdf-scanner/app /opt/pdf-scanner/node-runtime
if [ ! -x /opt/pdf-scanner/node-runtime/bin/node ]; then
  download_dir=$(mktemp -d)
  trap 'rm -rf -- "$download_dir"' EXIT
  curl --fail --silent --show-error --location https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt -o "$download_dir/SHASUMS256.txt"
  archive=$(awk '/ node-v[0-9.]+-linux-arm64.tar.xz$/ {print $2}' "$download_dir/SHASUMS256.txt")
  test -n "$archive"
  curl --fail --silent --show-error --location "https://nodejs.org/dist/latest-v24.x/$archive" -o "$download_dir/$archive"
  (cd "$download_dir"; grep " $archive$" SHASUMS256.txt | sha256sum --check -)
  tar -xJf "$download_dir/$archive" --strip-components=1 -C /opt/pdf-scanner/node-runtime
fi
id pdf-scanner >/dev/null 2>&1 || useradd --system --home-dir /var/lib/pdf-scanner --shell /usr/sbin/nologin pdf-scanner
tar -xzf /tmp/pdf-scanner-release.tar.gz -C /opt/pdf-scanner/app
chown -R root:root /opt/pdf-scanner/app /opt/pdf-scanner/node-runtime
chmod -R a+rX /opt/pdf-scanner/app /opt/pdf-scanner/node-runtime
install -m 0644 /opt/pdf-scanner/app/deploy/pdf-scanner.service /etc/systemd/system/pdf-scanner.service
if [ ! -f /etc/pdf-scanner.conf ]; then
  printf 'TRUSTED_HOSTS=127.0.0.1,localhost\n' > /etc/pdf-scanner.conf
  chmod 0600 /etc/pdf-scanner.conf
fi
systemctl daemon-reload
systemctl enable --now pdf-scanner
systemctl restart pdf-scanner
if ! command -v tailscale >/dev/null; then
  curl --fail --silent --show-error --location https://pkgs.tailscale.com/stable/ubuntu/noble.noarmor.gpg -o /usr/share/keyrings/tailscale-archive-keyring.gpg
  curl --fail --silent --show-error --location https://pkgs.tailscale.com/stable/ubuntu/noble.tailscale-keyring.list -o /etc/apt/sources.list.d/tailscale.list
  chmod 0644 /usr/share/keyrings/tailscale-archive-keyring.gpg /etc/apt/sources.list.d/tailscale.list
  apt-get update -o Dir::Etc::sourcelist=/etc/apt/sources.list.d/tailscale.list -o Dir::Etc::sourceparts=- -o APT::Get::List-Cleanup=0
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends tailscale
fi
systemctl enable --now tailscaled
/opt/pdf-scanner/node-runtime/bin/node --version
systemctl is-active pdf-scanner
