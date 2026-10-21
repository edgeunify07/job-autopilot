#!/usr/bin/env bash
#
# Job Autopilot — one-shot EC2 setup.
#
#   sudo bash deploy/ec2-setup.sh
#
# Installs Node, Chromium and system deps, builds the app, and registers two
# systemd services (web + worker) that restart on boot and on crash.
#
# Tested shape: Ubuntu 22.04/24.04 on t3.small or larger. Works on t2/t3.micro
# because the script adds swap first — 1 GB of RAM is not enough to run
# `next build` and Playwright without it.
#
# Env you can set before running:
#   ANTHROPIC_API_KEY=...        your key (prompted if unset)
#   ANTHROPIC_BASE_URL=...       gateway, if you use one
#   APP_PASSWORD=...             dashboard password (generated if unset)
#   APP_PORT=3000                port the dashboard listens on
#   RUN_USER=ubuntu              the unix user that owns the app

set -euo pipefail

APP_PORT="${APP_PORT:-3000}"
RUN_USER="${RUN_USER:-${SUDO_USER:-ubuntu}}"
NODE_MAJOR=20
REPO="${REPO:-edgeunify07/job-autopilot}"
GH_TOKEN="${GH_TOKEN:-}"

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m    %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31mx %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Needs root. Pipe it into 'sudo bash', or run 'sudo bash ec2-setup.sh'."

# Where did we come from? This has to work three ways: piped into bash from
# curl (BASH_SOURCE unset), run as a file inside the repo, and re-run later to
# update. Note ${BASH_SOURCE[0]:-} — without the :- this dies under `set -u`
# the moment anyone pipes or pastes it.
SRC="${BASH_SOURCE[0]:-}"
if [ -n "$SRC" ] && [ -f "$(cd "$(dirname "$SRC")/.." 2>/dev/null && pwd)/package.json" ]; then
  APP_DIR="$(cd "$(dirname "$SRC")/.." && pwd)"
elif [ -f "./package.json" ] && grep -q '"job-autopilot"' ./package.json 2>/dev/null; then
  APP_DIR="$(pwd)"
else
  APP_DIR="${APP_DIR:-/home/$RUN_USER/job-autopilot}"
fi

# ---------------------------------------------------------------- 0. source
if [ ! -f "$APP_DIR/package.json" ]; then
  say "Fetching the app into $APP_DIR"
  command -v git >/dev/null || { apt-get update -qq && apt-get install -y -qq git >/dev/null; }
  if [ -n "$GH_TOKEN" ]; then
    CLONE_URL="https://x-access-token:${GH_TOKEN}@github.com/${REPO}.git"
  else
    CLONE_URL="https://github.com/${REPO}.git"
  fi
  if ! sudo -u "$RUN_USER" git clone --depth 1 "$CLONE_URL" "$APP_DIR" 2>/dev/null; then
    die "Could not clone ${REPO}. It is private, so either make it public or re-run with a token:
    curl -fsSL -H 'Authorization: Bearer ghp_YOURTOKEN' \\
      https://raw.githubusercontent.com/${REPO}/main/deploy/ec2-setup.sh \\
      | sudo GH_TOKEN=ghp_YOURTOKEN bash
  Create a token at https://github.com/settings/tokens with 'repo' scope."
  fi
  # Never leave the token sitting in .git/config.
  sudo -u "$RUN_USER" git -C "$APP_DIR" remote set-url origin "https://github.com/${REPO}.git"
fi

[ -f "$APP_DIR/package.json" ] || die "No app found at $APP_DIR."
id "$RUN_USER" >/dev/null 2>&1 || die "User '$RUN_USER' does not exist. Re-run with RUN_USER=<your-user>."

# ---------------------------------------------------------------- 1. swap
# next build on a 1 GB box dies with an OOM kill that looks like a random
# "Killed". Swap is the difference between this working and not.
say "Checking memory"
TOTAL_MB=$(free -m | awk '/^Mem:/{print $2}')
echo "    RAM: ${TOTAL_MB} MB"
if [ "$TOTAL_MB" -lt 2048 ] && [ ! -f /swapfile ]; then
  say "Adding 2 GB swap (RAM is tight)"
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "    swap on"
fi

# ---------------------------------------------------------------- 2. packages
say "Installing system packages"
if command -v apt-get >/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq curl ca-certificates gnupg git build-essential >/dev/null
  if ! command -v node >/dev/null || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt "$NODE_MAJOR" ]; then
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null
    apt-get install -y -qq nodejs >/dev/null
  fi
else
  die "This script expects Ubuntu/Debian (apt). On Amazon Linux, install Node ${NODE_MAJOR}+, git and Chromium's deps by hand, then run the npm steps below."
fi
echo "    node $(node -v), npm $(npm -v)"

# ---------------------------------------------------------------- 3. app deps
say "Installing app dependencies"
cd "$APP_DIR"
chown -R "$RUN_USER":"$RUN_USER" "$APP_DIR"
sudo -u "$RUN_USER" npm ci --no-audit --no-fund 2>&1 | tail -3 ||
  sudo -u "$RUN_USER" npm install --no-audit --no-fund 2>&1 | tail -3

say "Installing Chromium and its system libraries"
sudo -u "$RUN_USER" npx playwright install --with-deps chromium 2>&1 | tail -3

# ---------------------------------------------------------------- 4. config
say "Writing .env"
if [ ! -f "$APP_DIR/.env" ]; then
  if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
    read -rsp "    Anthropic (or gateway) API key: " ANTHROPIC_API_KEY; echo
  fi
  [ -n "$ANTHROPIC_API_KEY" ] || die "An API key is required."

  APP_PASSWORD="${APP_PASSWORD:-$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-14)}"
  APP_SECRET="$(openssl rand -hex 32)"

  cat > "$APP_DIR/.env" <<ENVEOF
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
$([ -n "${ANTHROPIC_BASE_URL:-}" ] && echo "ANTHROPIC_BASE_URL=${ANTHROPIC_BASE_URL}")
ANTHROPIC_MODEL=${ANTHROPIC_MODEL:-claude-opus-5-5}
ANTHROPIC_BULK_MODEL=${ANTHROPIC_BULK_MODEL:-claude-haiku-5-5}

# Password for the dashboard. Without this the app would be open to anyone
# who finds the port, along with your resume and phone number.
APP_PASSWORD=${APP_PASSWORD}
APP_SECRET=${APP_SECRET}

DATABASE_URL=file:./data/autopilot.db
DATA_DIR=./data
HEADLESS=true
TZ_NAME=Asia/Kolkata
PORT=${APP_PORT}
ENVEOF
  chown "$RUN_USER":"$RUN_USER" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
  NEW_PASSWORD="$APP_PASSWORD"
else
  warn ".env already exists — leaving it alone."
  NEW_PASSWORD="$(grep -E '^APP_PASSWORD=' "$APP_DIR/.env" | cut -d= -f2- || true)"
fi

say "Setting up the database"
sudo -u "$RUN_USER" npx prisma db push --skip-generate 2>&1 | tail -2
sudo -u "$RUN_USER" npx prisma generate 2>&1 | tail -1

say "Building (a minute or two on a small instance)"
sudo -u "$RUN_USER" npm run build 2>&1 | tail -4

# ---------------------------------------------------------------- 5. services
say "Registering systemd services"

cat > /etc/systemd/system/job-autopilot-web.service <<UNITEOF
[Unit]
Description=Job Autopilot dashboard
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
Environment=NODE_ENV=production
ExecStart=${APP_DIR}/node_modules/.bin/next start -p ${APP_PORT} -H 0.0.0.0
Restart=always
RestartSec=5
StandardOutput=append:${APP_DIR}/data/logs/web.log
StandardError=append:${APP_DIR}/data/logs/web.log

[Install]
WantedBy=multi-user.target
UNITEOF

cat > /etc/systemd/system/job-autopilot-worker.service <<UNITEOF
[Unit]
Description=Job Autopilot worker
After=job-autopilot-web.service
Wants=network-online.target

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${APP_DIR}/.env
Environment=NODE_ENV=production
ExecStart=${APP_DIR}/node_modules/.bin/tsx src/worker/index.ts
Restart=always
RestartSec=15
StandardOutput=append:${APP_DIR}/data/logs/worker.log
StandardError=append:${APP_DIR}/data/logs/worker.log

[Install]
WantedBy=multi-user.target
UNITEOF

sudo -u "$RUN_USER" mkdir -p "$APP_DIR/data/logs"
systemctl daemon-reload
systemctl enable --now job-autopilot-web job-autopilot-worker >/dev/null 2>&1
sleep 6

# ---------------------------------------------------------------- 6. report
say "Checking it came up"
systemctl is-active --quiet job-autopilot-web && echo "    web:    running" || warn "web:    NOT running — journalctl -u job-autopilot-web -n 40"
systemctl is-active --quiet job-autopilot-worker && echo "    worker: running" || warn "worker: NOT running — journalctl -u job-autopilot-worker -n 40"

CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:${APP_PORT}/login" || echo 000)
[ "$CODE" = "200" ] && echo "    dashboard responding on ${APP_PORT}" || warn "dashboard returned HTTP ${CODE}"

# Current Ubuntu AMIs default to IMDSv2 (token required); the plain v1 GET
# returns 401/403 there, so ask for a token first and fall back to v1.
IMDS_TOKEN=$(curl -sS -X PUT --max-time 3 \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 60" \
  http://169.254.169.254/latest/api/token 2>/dev/null || true)
if [ -n "$IMDS_TOKEN" ]; then
  PUBLIC_IP=$(curl -sS --max-time 3 -H "X-aws-ec2-metadata-token: $IMDS_TOKEN" \
    http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || true)
else
  PUBLIC_IP=$(curl -sS --max-time 3 \
    http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || true)
fi
case "$PUBLIC_IP" in ''|*[!0-9.]*) PUBLIC_IP="<your-ec2-ip>";; esac

cat <<DONEEOF

────────────────────────────────────────────────────────────────
  Running.

  URL       http://${PUBLIC_IP}:${APP_PORT}
  Password  ${NEW_PASSWORD}

  Last step, in the AWS console: open inbound TCP ${APP_PORT} in this
  instance's security group. Restrict the source to your own IP —
  "My IP" in the console. Do not use 0.0.0.0/0.

  Then open the URL, sign in, and work through Setup: upload your
  resume, confirm your details, pick job titles. Press Start.

  Logs     journalctl -u job-autopilot-worker -f
  Restart  sudo systemctl restart job-autopilot-web job-autopilot-worker
  Update   git pull && npm ci && npm run build && sudo systemctl restart job-autopilot-web job-autopilot-worker

  Note: Naukri/Indeed need a one-off manual login in a visible browser,
  which a headless server cannot show you. The company job boards
  (Greenhouse/Lever/Ashby) need no login and work right away — those
  are enabled by default.
────────────────────────────────────────────────────────────────

DONEEOF
