# 07 — Setup VPS

## 1. Kondisi VPS (dicek 2026-10-17)

| Item | Nilai |
|---|---|
| Provider / region | Tencent Cloud **ap-singapore-3** |
| OS | Ubuntu 24.04.4 LTS, kernel 6.8.0-138 (kernel baru **6.8.0-147 sudah terpasang, butuh reboot**) |
| CPU / RAM / swap / disk | 2 vCPU · 1.9 GB RAM · swap file 1.9 GB (`/swap.img`, swappiness 60) · 40 GB (terpakai ~15%) |
| Jaringan | IPv4 private + NAT publik (egress IPv4 OK — penting buat GMGN yang IPv4-only). Tidak ada IPv6 global. |
| Latency | Jupiter / DexScreener / Helius edge ~3–5 ms connect; Solana public RPC `getSlot` ~45 ms; PumpPortal ~225 ms connect; Telegram API ~160 ms |
| Mirror | apt, npm, pip pakai mirror Tencent (`mirrors.tencentyun.com`) |
| Timezone | Asia/Shanghai (UTC+8) — bot tetap simpan semua waktu dalam UTC |
| SSH | ⚠️ `PermitRootLogin yes`, `PasswordAuthentication yes` |
| Firewall | ufw **inactive**, fail2ban **belum ada** |

## 2. Yang SUDAH dikerjakan (sesi ini)

- [x] `apt-get update` + `full-upgrade` (108 paket, termasuk kernel 6.8.0-147, libc6) — log di scratchpad sesi.
- [x] Paket dasar: `build-essential jq htop tmux unzip zip ca-certificates gnupg lsb-release software-properties-common net-tools sqlite3`.
- [x] `apt autoremove`.
- [x] **Bun 1.4.3** terpasang di `~/.bun` (PATH ditambahkan ke `~/.bashrc`).
- [ ] **Reboot** belum (biar sesi ini nggak putus) → jalankan sendiri: `sudo reboot`.
- Catatan: `apparmor` & `libapparmor1` ditahan (phased update Ubuntu) — normal, akan terpasang otomatis via unattended-upgrades.

## 3. Hardening — ✅ SUDAH DITERAPKAN (2026-10-17)

> Catatan: file drop-in dinamai `01-hardening.conf` (bukan 99-) karena sshd memakai nilai pertama yang ditemukan dan `50-cloud-init.conf` berisi `PasswordAuthentication yes`. fail2ban butuh `journalmatch = _COMM=sshd` karena sshd jalan via socket activation.

> Lakukan **setelah memastikan login pakai SSH key berhasil** dari terminal lain.

```bash
# 3.1 Matikan login password & root via SSH
sudo tee /etc/ssh/sshd_config.d/01-hardening.conf >/dev/null <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
EOF
sudo mkdir -p /run/sshd && sudo sshd -t   # socket activation: berlaku untuk koneksi baru

# 3.2 Firewall: izinkan SSH saja (dashboard lewat Tailscale)
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw enable

# 3.3 fail2ban (jail sshd default)
sudo apt-get install -y fail2ban
sudo systemctl enable --now fail2ban

# 3.4 Swap lebih jarang dipakai (latency)
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-memebot.conf && sudo sysctl --system

# 3.5 Batasi ukuran journald
sudo mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nSystemMaxUse=1G\n' | sudo tee /etc/systemd/journald.conf.d/size.conf
sudo systemctl restart systemd-journald
```

Juga cek **Security Group** Tencent Cloud: inbound cukup port 22 (idealnya dibatasi IP lo).

## 4. Komponen aplikasi (Fase 0) — 4.1 & 4.2 ✅ sudah, 4.3 Tailscale belum

### 4.1 User service & direktori
```bash
sudo useradd --system --create-home --home-dir /opt/memebot --shell /usr/sbin/nologin memebot
sudo mkdir -p /etc/memebot /var/lib/memebot /run/memebot
sudo chown memebot:memebot /var/lib/memebot /run/memebot
sudo install -m 600 -o memebot -g memebot /dev/null /etc/memebot/secrets.env
```
Kode dikembangkan di `~/memebot` (repo), di-deploy ke `/opt/memebot` (atau systemd langsung pakai path repo di awal).

### 4.2 PostgreSQL 17 + TimescaleDB
```bash
# repo resmi PostgreSQL (PGDG)
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt noble-pgdg main" | sudo tee /etc/apt/sources.list.d/pgdg.list
# repo TimescaleDB
curl -fsSL https://packagecloud.io/timescale/timescaledb/gpgkey | sudo gpg --dearmor -o /etc/apt/keyrings/timescaledb.gpg
echo "deb [signed-by=/etc/apt/keyrings/timescaledb.gpg] https://packagecloud.io/timescale/timescaledb/ubuntu/ noble main" | sudo tee /etc/apt/sources.list.d/timescaledb.list
sudo apt-get update
sudo apt-get install -y postgresql-17 timescaledb-2-postgresql-17
sudo timescaledb-tune --pg-version 17 --memory 768MB --cpus 2 --yes   # sisakan RAM untuk Bun
sudo systemctl restart postgresql
```
Tuning tambahan untuk 2 GB: `shared_buffers=192MB`, `work_mem=8MB`, `maintenance_work_mem=64MB`, `max_connections=30`, `effective_cache_size=768MB`, `listen_addresses='localhost'`.
Buat DB `memebot`, role `memebot` (rw) & `memebot_ro` (read-only untuk dashboard), `CREATE EXTENSION timescaledb;`.

> Versi paket (PG 17 vs 18, Timescale 2.x) dicek ulang saat eksekusi — pilih kombinasi yang didukung Timescale saat itu.

### 4.3 Tailscale (akses dashboard privat)
```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --ssh=false
```
Dashboard bind ke `127.0.0.1:3000` lalu `tailscale serve` atau bind ke IP tailnet.

### 4.4 Node.js LTS (opsional)
Bun cukup untuk hampir semua hal. Node hanya kalau ada tool yang wajib Node (mis. `npx skills`, beberapa CLI). Bisa pakai `bunx` dulu.

### 4.5 Registry npm
`~/.npmrc` mengarah ke mirror Tencent. Kalau paket baru (mis. SDK Solana rilis kemarin) belum tersinkron, override per project dengan `bunfig.toml`:
```toml
[install]
registry = "https://registry.npmjs.org"
```

### 4.6 systemd units (contoh `infra/systemd/memebot-core.service`)
```ini
[Unit]
Description=memebot core trading engine
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
User=memebot
WorkingDirectory=/opt/memebot
EnvironmentFile=/etc/memebot/secrets.env
Environment=NODE_ENV=production
ExecStart=/opt/memebot/.bun/bin/bun run apps/core/src/main.ts
Restart=always
RestartSec=3
MemoryMax=700M
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/memebot /run/memebot
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```
Serupa untuk `memebot-dashboard` (`MemoryMax=300M`) dan `memebot-llm` (`MemoryMax=200M`).

### 4.7 Backup
- `pg_dump` harian (format custom, tanpa tabel tick mentah) → `/var/lib/memebot/backup` → **restic** ke storage eksternal (Backblaze B2 / Cloudflare R2 / S3).
- Repo kode di GitHub (private).
- **Private key tidak pernah ikut backup otomatis** — simpan offline sendiri.

## 5. Budget RAM (target)

| Proses | Perkiraan |
|---|---|
| OS + sshd + journald + tailscale | ~300 MB |
| PostgreSQL + Timescale (tuned) | 250–400 MB |
| memebot-core | 200–500 MB |
| memebot-dashboard | 100–200 MB |
| memebot-llm | 80–150 MB |
| **Total** | **~1.0–1.6 GB** dari 1.9 GB |

Cukup untuk Fase 0–5. **Upgrade ke 4 GB** direkomendasikan sebelum Fase 6 (multi-profile, gRPC, Grafana).
