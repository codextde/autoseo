#!/usr/bin/env bash
# AutoSEO self-hosting installer (Linux / macOS).
#
#   curl -fsSL https://autoseo.codext.de/install | bash
#
# Downloads deploy/docker-compose.yml + Caddyfile from the AutoSEO repo, writes a .env with your domain
# and a generated Postgres password, then runs `docker compose up -d`. Safe to re-run (keeps your .env).
#
# Options:
#   --domain <host>     Public domain for this instance (skips the prompt), e.g. seo.example.com
#   --dir <path>        Install directory (default: /opt/autoseo, or $AUTOSEO_DIR)
#   --version <tag>      Image tag to run (default: latest)
#   --no-proxy          Skip the bundled Caddy reverse proxy; publish the app on 127.0.0.1:3000 instead
#   --yes, -y            Don't prompt (e.g. to install Docker) — assume yes
#   --update             Pull the latest image and recreate containers, then exit
#   --uninstall           Stop and remove the AutoSEO containers (asks first; keeps volumes unless --purge)
#   --purge               With --uninstall, also delete the data volumes (IRREVERSIBLE)
#   -h, --help            Show this help
#
# Environment:
#   AUTOSEO_DIR           Same as --dir
#
# See docs/SELF_HOSTING.md for the full guide.
set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/codextde/autoseo/main"
AUTOSEO_DIR="${AUTOSEO_DIR:-/opt/autoseo}"
DOMAIN=""
VERSION="latest"
VERSION_SET=0
NO_PROXY=0
ASSUME_YES=0
DO_UPDATE=0
DO_UNINSTALL=0
DO_PURGE=0

# ── output helpers ──────────────────────────────────────────────────────────
if [ -t 1 ]; then
  bold=$(printf '\033[1m'); red=$(printf '\033[31m')
  green=$(printf '\033[32m'); yellow=$(printf '\033[33m'); reset=$(printf '\033[0m')
else
  bold=""; red=""; green=""; yellow=""; reset=""
fi
info()  { printf '%s▸%s %s\n' "$green" "$reset" "$*"; }
warn()  { printf '%s!%s %s\n' "$yellow" "$reset" "$*" >&2; }
die()   { printf '%s✗ %s%s\n' "$red" "$*" "$reset" >&2; exit 1; }
title() { printf '\n%s%s%s\n' "$bold" "$*" "$reset"; }

usage() {
  cat <<'USAGE'
AutoSEO self-hosting installer (Linux / macOS).

  curl -fsSL https://autoseo.codext.de/install | bash

Downloads deploy/docker-compose.yml + Caddyfile from the AutoSEO repo, writes a .env with your domain
and a generated Postgres password, then runs `docker compose up -d`. Safe to re-run (keeps your .env).

Options:
  --domain <host>     Public domain for this instance (skips the prompt), e.g. seo.example.com
  --dir <path>        Install directory (default: /opt/autoseo, or $AUTOSEO_DIR)
  --version <tag>     Image tag to run (default: latest)
  --no-proxy          Skip the bundled Caddy reverse proxy; publish the app on 127.0.0.1:3000 instead
  --yes, -y           Don't prompt (e.g. to install Docker) — assume yes
  --update            Pull the latest image and recreate containers, then exit
  --uninstall         Stop and remove the AutoSEO containers (asks first; keeps volumes unless --purge)
  --purge             With --uninstall, also delete the data volumes (IRREVERSIBLE)
  -h, --help          Show this help

Environment:
  AUTOSEO_DIR         Same as --dir

See docs/SELF_HOSTING.md for the full guide.
USAGE
}

# ── args ─────────────────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --domain=*) DOMAIN="${1#*=}"; shift ;;
    --dir) AUTOSEO_DIR="${2:-}"; shift 2 ;;
    --dir=*) AUTOSEO_DIR="${1#*=}"; shift ;;
    --version) VERSION="${2:-}"; VERSION_SET=1; shift 2 ;;
    --version=*) VERSION="${1#*=}"; VERSION_SET=1; shift ;;
    --no-proxy) NO_PROXY=1; shift ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    --update) DO_UPDATE=1; shift ;;
    --uninstall) DO_UNINSTALL=1; shift ;;
    --purge) DO_PURGE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $1 (see --help)" ;;
  esac
done

# ── interactive input (works under `curl | bash`, where stdin is the script) ─
TTY="/dev/tty"
INTERACTIVE=0
if [ "$ASSUME_YES" -ne 1 ] && [ -r "$TTY" ] && [ -w "$TTY" ]; then
  INTERACTIVE=1
fi

ask() { # ask "prompt" varname [default]
  local __prompt="$1" __var="$2" __default="${3:-}" __reply=""
  if [ "$INTERACTIVE" -eq 1 ]; then
    if [ -n "$__default" ]; then
      printf '%s [%s]: ' "$__prompt" "$__default" > "$TTY"
    else
      printf '%s: ' "$__prompt" > "$TTY"
    fi
    IFS= read -r __reply < "$TTY" || true
  fi
  [ -n "$__reply" ] || __reply="$__default"
  printf -v "$__var" '%s' "$__reply"
}

confirm() { # confirm "question" -> 0=yes 1=no
  local __reply=""
  [ "$ASSUME_YES" -eq 1 ] && return 0
  if [ "$INTERACTIVE" -ne 1 ]; then
    warn "$1 — non-interactive shell, assuming yes (pass --yes to silence this)"
    return 0
  fi
  printf '%s [Y/n]: ' "$1" > "$TTY"
  IFS= read -r __reply < "$TTY" || true
  case "$__reply" in
    ""|y|Y|yes|Yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

# ── platform checks ──────────────────────────────────────────────────────────
OS="$(uname -s)"
case "$OS" in
  Linux) PLATFORM=linux ;;
  Darwin) PLATFORM=macos ;;
  *) die "Unsupported OS: $OS (AutoSEO's installer supports Linux and macOS)" ;;
esac

SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
  else
    die "Run this installer as root, or install sudo first."
  fi
fi
run_priv() { if [ -n "$SUDO" ]; then sudo "$@"; else "$@"; fi; }

# ── docker ────────────────────────────────────────────────────────────────
ensure_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    return 0
  fi
  if [ "$PLATFORM" = macos ]; then
    die "Docker (with Compose v2) is required. Install Docker Desktop for Mac: https://www.docker.com/products/docker-desktop/ and re-run this installer."
  fi
  warn "Docker was not found."
  if ! confirm "Install Docker now via get.docker.com?"; then
    die "Docker is required. Install it yourself and re-run this installer."
  fi
  info "Installing Docker (get.docker.com)…"
  curl -fsSL https://get.docker.com | run_priv sh
  run_priv systemctl enable --now docker >/dev/null 2>&1 || true
  command -v docker >/dev/null 2>&1 || die "Docker install appears to have failed."
  docker compose version >/dev/null 2>&1 || die "Docker Compose v2 plugin missing after install."
}

docker_compose() { run_priv docker compose --project-directory "$AUTOSEO_DIR" -f "$AUTOSEO_DIR/docker-compose.yml" --env-file "$AUTOSEO_DIR/.env" "$@"; }

# ── uninstall ─────────────────────────────────────────────────────────────
if [ "$DO_UNINSTALL" -eq 1 ]; then
  [ -f "$AUTOSEO_DIR/docker-compose.yml" ] || die "No AutoSEO install found at $AUTOSEO_DIR"
  command -v docker >/dev/null 2>&1 || die "Docker not found."
  if [ "$DO_PURGE" -eq 1 ]; then
    confirm "This stops AutoSEO AND permanently deletes its data volumes (database, uploads, secret keys). Continue?" \
      || die "Aborted."
  else
    confirm "Stop AutoSEO and remove its containers? (data volumes are kept — pass --purge to also delete them)" \
      || die "Aborted."
  fi
  if [ "$DO_PURGE" -eq 1 ]; then
    docker_compose --profile proxy down -v
  else
    docker_compose --profile proxy down
  fi
  info "AutoSEO stopped. Files remain in $AUTOSEO_DIR (remove manually if you no longer need them)."
  exit 0
fi

# ── update ────────────────────────────────────────────────────────────────
if [ "$DO_UPDATE" -eq 1 ]; then
  [ -f "$AUTOSEO_DIR/.env" ] || die "No existing install found at $AUTOSEO_DIR (run without --update first)."
  ensure_docker
  if [ "$VERSION_SET" -eq 1 ] && [ -f "$AUTOSEO_DIR/.env" ]; then
    if grep -q '^AUTOSEO_VERSION=' "$AUTOSEO_DIR/.env"; then
      sed -i.bak "s|^AUTOSEO_VERSION=.*|AUTOSEO_VERSION=$VERSION|" "$AUTOSEO_DIR/.env" && rm -f "$AUTOSEO_DIR/.env.bak"
    else
      printf 'AUTOSEO_VERSION=%s\n' "$VERSION" >> "$AUTOSEO_DIR/.env"
    fi
    info "Pinned AUTOSEO_VERSION=$VERSION in $AUTOSEO_DIR/.env"
  fi
  info "Pulling latest images and recreating containers…"
  docker_compose pull
  docker_compose up -d --remove-orphans
  info "Updated. Recent logs:"
  docker_compose logs --tail 20 app || true
  exit 0
fi

# ── fresh install / re-run ───────────────────────────────────────────────────
title "AutoSEO installer"

ensure_docker

run_priv mkdir -p "$AUTOSEO_DIR"
[ -n "$SUDO" ] && run_priv chown "$(id -u)":"$(id -g)" "$AUTOSEO_DIR" 2>/dev/null || true

info "Installing into $AUTOSEO_DIR"
curl -fsSL "$REPO_RAW/deploy/docker-compose.yml" -o "$AUTOSEO_DIR/docker-compose.yml"
curl -fsSL "$REPO_RAW/deploy/Caddyfile" -o "$AUTOSEO_DIR/Caddyfile"

ENV_FILE="$AUTOSEO_DIR/.env"
EXISTING_DOMAIN=""
EXISTING_PASSWORD=""
if [ -f "$ENV_FILE" ]; then
  info "Found existing $ENV_FILE — keeping your settings (re-running is safe)."
  EXISTING_DOMAIN="$(grep -E '^DOMAIN=' "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"
  EXISTING_PASSWORD="$(grep -E '^POSTGRES_PASSWORD=' "$ENV_FILE" | tail -1 | cut -d= -f2- || true)"
fi

if [ -z "$DOMAIN" ]; then
  DOMAIN="$EXISTING_DOMAIN"
  ask "Domain for this AutoSEO instance (e.g. seo.example.com)" DOMAIN "$EXISTING_DOMAIN"
fi
[ -n "$DOMAIN" ] || die "A domain is required. Pass --domain <host> or run this interactively."
DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN%/}"

POSTGRES_PASSWORD="$EXISTING_PASSWORD"
if [ -z "$POSTGRES_PASSWORD" ]; then
  if command -v openssl >/dev/null 2>&1; then
    POSTGRES_PASSWORD="$(openssl rand -hex 24)"
  else
    POSTGRES_PASSWORD="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  fi
  info "Generated a Postgres password."
fi

# ── DNS sanity check (non-fatal) ─────────────────────────────────────────────
check_dns() {
  local server_ip domain_ip
  server_ip="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
  [ -n "$server_ip" ] || { warn "Could not determine this server's public IP; skipping DNS check."; return 0; }
  if command -v getent >/dev/null 2>&1; then
    domain_ip="$(getent hosts "$DOMAIN" 2>/dev/null | awk '{print $1}' | head -1)"
  elif command -v dig >/dev/null 2>&1; then
    domain_ip="$(dig +short A "$DOMAIN" 2>/dev/null | head -1)"
  else
    domain_ip="$(host "$DOMAIN" 2>/dev/null | awk '/has address/{print $4; exit}')"
  fi
  if [ -z "$domain_ip" ]; then
    warn "$DOMAIN doesn't resolve yet. Point its DNS A record at $server_ip before Caddy can issue a certificate."
  elif [ "$domain_ip" != "$server_ip" ]; then
    warn "$DOMAIN resolves to $domain_ip, but this server's public IP is $server_ip. Automatic HTTPS will fail until DNS points here."
  else
    info "DNS check: $DOMAIN → $server_ip ✓"
  fi
}
[ "$NO_PROXY" -eq 1 ] || check_dns

# ── write .env ────────────────────────────────────────────────────────────
COMPOSE_PROFILES_VALUE="proxy"
[ "$NO_PROXY" -eq 1 ] && COMPOSE_PROFILES_VALUE=""

umask 077
cat > "$ENV_FILE" <<EOF
# Generated by install.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ). Safe to hand-edit; re-running install.sh keeps it.
DOMAIN=$DOMAIN
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
AUTOSEO_VERSION=$VERSION
COMPOSE_PROFILES=$COMPOSE_PROFILES_VALUE
#APP_PORT=3000
#AUTOSEO_OWNER_EMAIL=
#AUTOSEO_OWNER_NAME=
#AUTOSEO_WORKSPACE_NAME=
#AUTOSEO_SMTP_URL=
#AUTOSEO_MAIL_FROM=
EOF
chmod 600 "$ENV_FILE"
info "Wrote $ENV_FILE (mode 600)."

# ── start ─────────────────────────────────────────────────────────────────
info "Pulling images…"
docker_compose pull
info "Starting AutoSEO…"
docker_compose up -d --remove-orphans

# ── wait for health ───────────────────────────────────────────────────────
APP_PORT_VALUE="$(grep -E '^APP_PORT=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true)"
APP_PORT_VALUE="${APP_PORT_VALUE:-3000}"
info "Waiting for the app to become healthy…"
healthy=0
for _ in $(seq 1 60); do
  if curl -fsS --max-time 3 "http://127.0.0.1:$APP_PORT_VALUE/api/health" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  sleep 2
done
[ "$healthy" -eq 1 ] || warn "App did not report healthy within 2 minutes — check 'docker compose logs app' in $AUTOSEO_DIR."

# ── setup code ────────────────────────────────────────────────────────────
title "AutoSEO is running"
if [ "$NO_PROXY" -eq 1 ]; then
  info "Reachable at http://127.0.0.1:$APP_PORT_VALUE — point your reverse proxy at this host/port for https://$DOMAIN"
else
  info "Once DNS + the certificate are ready: https://$DOMAIN"
fi

SETUP_LINE="$(docker_compose logs app 2>/dev/null | grep -o 'Setup code: [0-9A-Za-z-]*' | tail -1 || true)"
if [ -n "$SETUP_LINE" ]; then
  printf '\n  %sOpen%s https://%s/setup\n  %s%s%s\n\n' "$bold" "$reset" "$DOMAIN" "$bold" "$SETUP_LINE" "$reset"
else
  info "No setup code found in the logs — this instance may already be set up, or is still booting."
  info "Check later with: docker compose -f $AUTOSEO_DIR/docker-compose.yml --env-file $AUTOSEO_DIR/.env logs app"
fi

echo
info "Manage this install:"
echo "  Update:      curl -fsSL https://autoseo.codext.de/install | bash -s -- --dir $AUTOSEO_DIR --update"
echo "  Uninstall:   curl -fsSL https://autoseo.codext.de/install | bash -s -- --dir $AUTOSEO_DIR --uninstall"
echo "  Logs:        docker compose -f $AUTOSEO_DIR/docker-compose.yml --env-file $AUTOSEO_DIR/.env logs -f app"
echo "  Config:      $ENV_FILE"
