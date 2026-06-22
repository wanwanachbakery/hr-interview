#!/usr/bin/env bash
# ============================================================
# HR-Interview — one-shot setup for a fresh Ubuntu droplet
# Run as root on DigitalOcean Ubuntu 22.04/24.04:
#   bash setup-droplet.sh
# ============================================================
set -e

APP_DIR=/opt/hr-interview
NODE_MAJOR=20

echo "=== [1/6] System update ==="
apt-get update -y
apt-get upgrade -y

echo "=== [2/6] Install Node.js ${NODE_MAJOR} + git ==="
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash -
  apt-get install -y nodejs
fi
apt-get install -y git curl
node --version
npm --version

echo "=== [3/6] Get app code into ${APP_DIR} ==="
# If code already present (you uploaded it), skip clone. Otherwise clone from your repo.
if [ ! -d "${APP_DIR}" ]; then
  if [ -n "${REPO_URL}" ]; then
    git clone "${REPO_URL}" "${APP_DIR}"
  else
    echo "!! ${APP_DIR} not found and REPO_URL not set."
    echo "   Upload the project to ${APP_DIR} first, or run with:"
    echo "   REPO_URL=https://github.com/you/hr-interview.git bash setup-droplet.sh"
    exit 1
  fi
fi
cd "${APP_DIR}"

echo "=== [4/6] Install dependencies ==="
npm install --omit=dev

echo "=== [5/6] Install PM2 + start app ==="
npm install -g pm2

# Production env: Secure cookies (behind Cloudflare HTTPS), no browser auto-open
SECURE_COOKIES=true \
PORT=3000 \
NODE_ENV=production \
AUTO_OPEN_BROWSER=false \
pm2 start server.js --name hr-interview --update-env

pm2 save
# Make PM2 (and the app) start automatically after a reboot
pm2 startup systemd -u root --hp /root | tail -1 | bash || true
pm2 save

echo "=== [6/6] Install cloudflared (for the tunnel) ==="
if ! command -v cloudflared >/dev/null 2>&1; then
  mkdir -p /usr/local/bin
  curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
  chmod +x /usr/local/bin/cloudflared
fi
cloudflared --version

echo ""
echo "============================================================"
echo "  [OK] App is running on http://localhost:3000 (via PM2)"
echo "============================================================"
echo ""
echo "Next — connect the tunnel to wanwanachapp.com:"
echo "  1) cloudflared tunnel login          (open the URL it prints, authorize wanwanachapp.com)"
echo "  2) cloudflared tunnel create hrapp"
echo "  3) cloudflared tunnel route dns hrapp wanwanachapp.com"
echo "  4) cloudflared tunnel route dns hrapp www.wanwanachapp.com   (optional)"
echo "  5) create /root/.cloudflared/config.yml  (see docs/DIGITALOCEAN-DEPLOY.md)"
echo "  6) cloudflared service install        (run tunnel 24/7 as a service)"
echo ""
echo "Useful:"
echo "  pm2 logs hr-interview     # view app logs"
echo "  pm2 restart hr-interview  # restart after code update"
echo "  pm2 status                # check it's online"
