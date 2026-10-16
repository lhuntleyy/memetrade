# systemd units

> Status: `memebot-core` & `memebot-dashboard` sudah ter-install & aktif sejak 2026-10-17. `memebot-llm` belum (Fase 4).

Belum di-install (Fase 0 = template). Deploy pertama (saat Fase 1 siap jalan 24/7):

```bash
sudo -u memebot bash -c 'curl -fsSL https://bun.sh/install | bash'      # bun untuk user memebot
sudo rsync -a --delete --exclude node_modules --exclude .env ~/memebot/ /opt/memebot/app/
sudo chown -R memebot:memebot /opt/memebot/app
sudo -u memebot bash -c 'cd /opt/memebot/app && ~/.bun/bin/bun install --frozen-lockfile'
# /etc/memebot/secrets.env sudah berisi DATABASE_URL & DATABASE_URL_RO; tambahkan CONTROL_SECRET dll
sudo cp infra/systemd/memebot-*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now memebot-core memebot-dashboard
journalctl -u memebot-core -f
```
