#!/usr/bin/env bash
# Buka dashboard ke internet publik lewat HTTPS: https://43-156-246-199.sslip.io
# Jalankan SENDIRI (keputusan keamanan user): sudo bash infra/scripts/enable-public-dashboard.sh
# Prasyarat: Security Group Tencent mengizinkan inbound TCP 80 & 443.
set -euo pipefail
cd "$(dirname "$0")/../.."

# 1) Caddy: reverse proxy + sertifikat otomatis
install -m 644 infra/caddy/Caddyfile /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile

# 2) dashboard bind lokal di belakang Caddy, cookie Secure, percaya X-Forwarded-For dari Caddy saja
mkdir -p /etc/systemd/system/memebot-dashboard.service.d
rm -f /etc/systemd/system/memebot-dashboard.service.d/tailscale.conf
cat > /etc/systemd/system/memebot-dashboard.service.d/public.conf <<'UNIT'
[Service]
Environment=DASHBOARD_HOST=127.0.0.1
Environment=DASHBOARD_SECURE_COOKIE=1
Environment=DASHBOARD_TRUST_PROXY=1
UNIT

# 3) firewall: buka 80 (ACME + redirect) & 443; tutup akses tailnet langsung ke 3000
ufw allow 80/tcp comment 'caddy http'
ufw allow 443/tcp comment 'caddy https dashboard'
ufw delete allow in on tailscale0 to any port 3000 proto tcp || true

systemctl daemon-reload
systemctl restart memebot-dashboard
systemctl enable --now caddy
systemctl reload caddy
echo "Selesai. Buka: https://43-156-246-199.sslip.io (sertifikat terbit dalam ±1 menit)"
