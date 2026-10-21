#!/usr/bin/env bash
# Put Job Autopilot behind the nginx that is already running on port 80.
#
#   sudo bash deploy/nginx-setup.sh
#
# The app keeps listening on 127.0.0.1:3000; nginx handles port 80. Nothing
# else nginx serves is touched, except that the stock "Welcome to nginx"
# default site is disabled if it is still enabled.

set -euo pipefail
say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m    %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31mx %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run with sudo."
command -v nginx >/dev/null || die "nginx is not installed."

SRC="${BASH_SOURCE[0]:-}"
DIR="$([ -n "$SRC" ] && cd "$(dirname "$SRC")" && pwd || echo "$PWD/deploy")"
CONF="$DIR/nginx-job-autopilot.conf"
[ -f "$CONF" ] || die "Cannot find $CONF"

say "Making sure the app is back on port 3000"
UNIT=/etc/systemd/system/job-autopilot-web.service
if [ -f "$UNIT" ]; then
  sed -i 's/-p 80 /-p 3000 /' "$UNIT"
  sed -i '/^AmbientCapabilities=CAP_NET_BIND_SERVICE$/d' "$UNIT"
  systemctl daemon-reload
  systemctl restart job-autopilot-web
  sleep 4
  systemctl is-active --quiet job-autopilot-web && echo "    app: running on 3000" || warn "app did not start — journalctl -u job-autopilot-web -n 30"
fi

say "Installing the nginx site"
install -m 644 "$CONF" /etc/nginx/sites-available/job-autopilot
ln -sfn /etc/nginx/sites-available/job-autopilot /etc/nginx/sites-enabled/job-autopilot
if [ -L /etc/nginx/sites-enabled/default ]; then
  rm -f /etc/nginx/sites-enabled/default
  echo "    disabled the stock default site"
fi

say "Testing the nginx config"
nginx -t || die "nginx rejected the config; nothing was reloaded."

# nginx is not always a systemd service here: a box where someone ran `sudo
# nginx` by hand has a live master process while nginx.service reads inactive,
# and `systemctl reload` then fails with "cannot reload". Handle all three
# states, and prefer leaving it under systemd so it survives a reboot.
say "Reloading nginx"
if systemctl is-active --quiet nginx; then
  systemctl reload nginx
  echo "    reloaded via systemd"
elif pgrep -x nginx >/dev/null 2>&1; then
  warn "nginx is running outside systemd — adopting it so it restarts on boot"
  nginx -s quit 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do pgrep -x nginx >/dev/null 2>&1 || break; sleep 1; done
  pgrep -x nginx >/dev/null 2>&1 && { nginx -s reload; echo "    reloaded in place"; } \
    || { systemctl enable --now nginx >/dev/null 2>&1 && echo "    now managed by systemd"; }
else
  systemctl enable --now nginx >/dev/null 2>&1 || nginx
  echo "    started"
fi

say "Checking it end to end"
sleep 2
DIRECT=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:3000/login || echo 000)
VIA=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1/login || echo 000)
echo "    app direct on 3000 : HTTP $DIRECT  (want 200)"
echo "    through nginx on 80 : HTTP $VIA  (want 200)"

IMDS_TOKEN=$(curl -sS -X PUT --max-time 3 -H "X-aws-ec2-metadata-token-ttl-seconds: 60" http://169.254.169.254/latest/api/token 2>/dev/null || true)
IP=$(curl -sS --max-time 3 ${IMDS_TOKEN:+-H "X-aws-ec2-metadata-token: $IMDS_TOKEN"} http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || true)
case "$IP" in ''|*[!0-9.]*) IP="<your-ec2-ip>";; esac

if [ "$VIA" = "200" ]; then
  printf '\n\033[1;32m  Ready: http://%s   (no port number)\033[0m\n' "$IP"
  printf '  Open inbound TCP 80 in the security group, source = My IP.\n\n'
else
  warn "nginx did not return 200 — check: journalctl -u nginx -n 30"
fi
