#!/usr/bin/env bash
# AutoSEO local agent installer (macOS / Linux).
#
#   curl -fsSL __AUTOSEO_HOST__/install.sh | AUTOSEO_AGENT_TOKEN=<TOKEN> bash -s -- --host __AUTOSEO_HOST__
#
# Options:
#   AUTOSEO_AGENT_TOKEN    Agent token from the dashboard (env var, shown once; `--token` also works)
#   --host <url>           AutoSEO server URL (https; default: __AUTOSEO_HOST__)
#   --runtime <name>       claude | codex | detect (default: detect)
#   --workdir <dir>        Folder for job sessions (default: OS temp dir)
#   --max-parallel <n>     Parallel jobs on this machine (default: server setting)
#   --no-auto-update       Never self-update (update by re-running this installer)
#   --no-autostart         Don't register launchd/systemd autostart (start it yourself)
#   --dir <dir>            Install directory (default: ~/.autoseo-agent)
#   --uninstall            Stop the agent and remove it from this machine
#
# Local security policy (only you decide — the dashboard can never widen it):
#   --allow-full           Full CLI mode for YOUR OWN chats/agentic jobs: exposes your user-scope Claude
#                          Code MCP servers (see --mcp-servers). Jobs of other users always run Lean.
#   --mcp-servers <list>   Which of your MCP servers Full mode exposes: all (default) | none | a,b,c
#   --allow-codex-shell    Let Codex use its (read-only) shell tool for your own jobs
#   --allow-remote-workdir Accept work directories set in the dashboard outside --workdir
#
# The agent only makes outbound HTTPS requests to your AutoSEO server; it opens no ports.
set -euo pipefail

HOST="__AUTOSEO_HOST__"
TOKEN="${AUTOSEO_AGENT_TOKEN:-}"
ALLOW_FULL=0
MCP_SERVERS="all"
ALLOW_CODEX_SHELL=0
ALLOW_REMOTE_WORKDIR=0
RUNTIME=""
WORKDIR=""
MAX_PARALLEL=""
NO_AUTO_UPDATE=0
NO_AUTOSTART=0
UNINSTALL=0
INSTALL_DIR="${AUTOSEO_AGENT_HOME:-$HOME/.autoseo-agent}"
LABEL="com.autoseo.agent"
UNIT="autoseo-agent"

bold=$(printf '\033[1m'); dim=$(printf '\033[2m'); green=$(printf '\033[32m'); red=$(printf '\033[31m'); yellow=$(printf '\033[33m'); reset=$(printf '\033[0m')
info() { printf '%s▸%s %s\n' "$green" "$reset" "$*"; }
warn() { printf '%s!%s %s\n' "$yellow" "$reset" "$*" >&2; }
die() { printf '%s✗ %s%s\n' "$red" "$*" "$reset" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --token) TOKEN="${2:-}"; shift 2 ;;
    --token=*) TOKEN="${1#*=}"; shift ;;
    --host) HOST="${2:-}"; shift 2 ;;
    --host=*) HOST="${1#*=}"; shift ;;
    --runtime) RUNTIME="${2:-}"; shift 2 ;;
    --runtime=*) RUNTIME="${1#*=}"; shift ;;
    --workdir) WORKDIR="${2:-}"; shift 2 ;;
    --workdir=*) WORKDIR="${1#*=}"; shift ;;
    --max-parallel) MAX_PARALLEL="${2:-}"; shift 2 ;;
    --max-parallel=*) MAX_PARALLEL="${1#*=}"; shift ;;
    --no-auto-update) NO_AUTO_UPDATE=1; shift ;;
    --no-autostart) NO_AUTOSTART=1; shift ;;
    --allow-full) ALLOW_FULL=1; shift ;;
    --mcp-servers) MCP_SERVERS="${2:-}"; shift 2 ;;
    --mcp-servers=*) MCP_SERVERS="${1#*=}"; shift ;;
    --allow-codex-shell) ALLOW_CODEX_SHELL=1; shift ;;
    --allow-remote-workdir) ALLOW_REMOTE_WORKDIR=1; shift ;;
    --dir) INSTALL_DIR="${2:-}"; shift 2 ;;
    --dir=*) INSTALL_DIR="${1#*=}"; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    -h|--help) sed -n '2,20p' "$0" 2>/dev/null || true; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done

HOST="${HOST%/}"
OS="$(uname -s)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
UNIT_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/$UNIT.service"

stop_autostart() {
  case "$OS" in
    Darwin)
      if [ -f "$PLIST" ]; then
        launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || launchctl unload -w "$PLIST" >/dev/null 2>&1 || true
      fi
      ;;
    Linux)
      if command -v systemctl >/dev/null 2>&1 && [ -f "$UNIT_FILE" ]; then
        systemctl --user disable --now "$UNIT" >/dev/null 2>&1 || true
      fi
      if command -v crontab >/dev/null 2>&1 && crontab -l 2>/dev/null | grep -q "autoseo-agent"; then
        crontab -l 2>/dev/null | grep -v "autoseo-agent" | crontab - || true
      fi
      ;;
  esac
  if [ -f "$INSTALL_DIR/agent.pid" ]; then
    local pid
    pid="$(cat "$INSTALL_DIR/agent.pid")"
    if kill "$pid" >/dev/null 2>&1; then
      WAS_RUNNING=1
      # Give it time to stop running jobs gracefully before files are replaced.
      for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do kill -0 "$pid" >/dev/null 2>&1 || break; sleep 1; done
    fi
    rm -f "$INSTALL_DIR/agent.pid"
  fi
}
WAS_RUNNING=0

if [ "$UNINSTALL" = 1 ]; then
  info "Uninstalling the AutoSEO agent from $INSTALL_DIR"
  stop_autostart
  rm -f "$PLIST" "$UNIT_FILE"
  if command -v systemctl >/dev/null 2>&1; then systemctl --user daemon-reload >/dev/null 2>&1 || true; fi
  case "$INSTALL_DIR" in
    */.autoseo-agent|*autoseo-agent*) rm -rf "$INSTALL_DIR" ;;
    *) warn "Not removing unexpected directory $INSTALL_DIR" ;;
  esac
  info "Done. Job folders in your work directory (default: \$TMPDIR/autoseo-agent) can be deleted safely."
  info "Delete the agent in the AutoSEO dashboard to revoke its token."
  exit 0
fi

[ -n "$TOKEN" ] || die "Missing token. Copy the install command from AutoSEO → Local Agents → Install agent."
unset AUTOSEO_AGENT_TOKEN
case "$HOST" in
  https://*) ;;
  http://localhost|http://localhost:*|http://127.0.0.1|http://127.0.0.1:*|http://\[::1\]*|http://*.localhost|http://*.localhost:*|http://*.test|http://*.test:*) ;;
  *) die "--host must use https:// (plain http is only allowed for localhost / *.test)" ;;
esac
RELEASE_KEY="__AUTOSEO_AGENT_PUBKEY__"
if [ -n "$RUNTIME" ]; then
  case "$RUNTIME" in claude|codex|detect) ;; *) die "--runtime must be claude, codex or detect" ;; esac
fi
if [ -n "$MAX_PARALLEL" ]; then
  case "$MAX_PARALLEL" in ''|*[!0-9]*) die "--max-parallel must be a number" ;; esac
fi

# ── Node.js ≥ 20 (Claude Code / Codex users have it) ──
find_node() {
  if command -v node >/dev/null 2>&1; then command -v node; return; fi
  for c in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node "$HOME/.volta/bin/node" "$HOME/.local/bin/node"; do
    [ -x "$c" ] && { echo "$c"; return; }
  done
  if [ -d "$HOME/.nvm/versions/node" ]; then
    local latest
    latest="$(ls -1 "$HOME/.nvm/versions/node" 2>/dev/null | tail -n1)"
    [ -n "$latest" ] && [ -x "$HOME/.nvm/versions/node/$latest/bin/node" ] && { echo "$HOME/.nvm/versions/node/$latest/bin/node"; return; }
  fi
  return 1
}
NODE="$(find_node)" || die "Node.js 20+ is required. Install it from https://nodejs.org (or via your package manager) and re-run."
NODE_MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node.js 20+ is required (found $("$NODE" -v) at $NODE)."

xml_escape() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
systemd_escape() { printf '%s' "$1" | sed -e 's/%/%%/g' -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

fetch() {
  if command -v curl >/dev/null 2>&1; then curl -fsSL --retry 3 "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then wget -q "$1" -O "$2"
  else die "curl or wget is required"; fi
}

info "Installing AutoSEO agent into ${bold}$INSTALL_DIR${reset}"
mkdir -p "$INSTALL_DIR/logs"
chmod 700 "$INSTALL_DIR" "$INSTALL_DIR/logs"
TMP_DL="$(mktemp "${TMPDIR:-/tmp}/autoseo-agent.XXXXXX")"
trap 'rm -f "$TMP_DL" "$TMP_DL.sha" "$TMP_DL.sig"' EXIT
fetch "$HOST/install/agent.mjs" "$TMP_DL" || die "Could not download the agent from $HOST"
fetch "$HOST/install/agent.sha256" "$TMP_DL.sha" || die "Could not download the checksum from $HOST"
fetch "$HOST/install/agent.sig" "$TMP_DL.sig" || die "Could not download the release signature from $HOST"
EXPECTED="$(head -n1 "$TMP_DL.sha" | tr -d '[:space:]')"
ACTUAL="$("$NODE" -e 'process.stdout.write(require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest("hex"))' "$TMP_DL")"
[ -n "$EXPECTED" ] && [ "$EXPECTED" = "$ACTUAL" ] || die "Checksum mismatch for agent.mjs (expected $EXPECTED, got $ACTUAL)"
"$NODE" -e '
const c = require("crypto"), fs = require("fs");
const key = c.createPublicKey({ key: Buffer.from(process.argv[1], "base64"), format: "der", type: "spki" });
const sig = Buffer.from(fs.readFileSync(process.argv[3], "utf8").trim(), "base64");
process.exit(c.verify(null, fs.readFileSync(process.argv[2]), key, sig) ? 0 : 1);
' "$RELEASE_KEY" "$TMP_DL" "$TMP_DL.sig" || die "Release signature check failed for agent.mjs"
VERSION="$(sed -n '2p' "$TMP_DL.sha" | tr -d '[:space:]')"

# Stop a running instance before replacing files (re-install / token rotation).
stop_autostart

mv -f "$TMP_DL" "$INSTALL_DIR/agent.mjs"
chmod 755 "$INSTALL_DIR/agent.mjs"
rm -f "$INSTALL_DIR/agent.mjs.prev" "$INSTALL_DIR/update.json"

AUTOSTART="none"
if [ "$NO_AUTOSTART" = 0 ]; then
  case "$OS" in
    Darwin) AUTOSTART="launchd" ;;
    Linux)
      if command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then AUTOSTART="systemd"
      elif command -v crontab >/dev/null 2>&1; then AUTOSTART="cron"
      else AUTOSTART="none"; fi ;;
  esac
fi

set -- configure --host "$HOST" --autostart "$AUTOSTART" --path "$PATH"
[ -n "$RUNTIME" ] && set -- "$@" --runtime "$RUNTIME"
[ -n "$WORKDIR" ] && set -- "$@" --workdir "$WORKDIR"
[ -n "$MAX_PARALLEL" ] && set -- "$@" --max-parallel "$MAX_PARALLEL"
if [ "$NO_AUTO_UPDATE" = 1 ]; then set -- "$@" --no-auto-update; else set -- "$@" --auto-update; fi
yn() { if [ "$1" = 1 ]; then echo yes; else echo no; fi; }
set -- "$@" --allow-full "$(yn "$ALLOW_FULL")" --mcp-servers "$MCP_SERVERS" --allow-codex-shell "$(yn "$ALLOW_CODEX_SHELL")" --allow-remote-workdir "$(yn "$ALLOW_REMOTE_WORKDIR")"
AUTOSEO_AGENT_TOKEN="$TOKEN" AUTOSEO_AGENT_HOME="$INSTALL_DIR" "$NODE" "$INSTALL_DIR/agent.mjs" "$@" >/dev/null

# Supervisor: restarts the agent after self-updates (exit 75) and crashes; rolls back a broken update.
cat > "$INSTALL_DIR/run.sh" <<RUNSH
#!/usr/bin/env bash
# AutoSEO agent supervisor (generated by install.sh).
DIR=$(printf '%q' "$INSTALL_DIR")
NODE=$(printf '%q' "$NODE")
export PATH=$(printf '%q' "$PATH")
export AUTOSEO_AGENT_HOME="\$DIR"
export AUTOSEO_AGENT_SUPERVISED=1
child=""
stop=0
trap 'stop=1; [ -n "\$child" ] && kill -TERM "\$child" 2>/dev/null' TERM INT HUP
echo \$\$ > "\$DIR/agent.pid"
fails=0
while [ "\$stop" = 0 ]; do
  start=\$(date +%s)
  "\$NODE" "\$DIR/agent.mjs" run "\$@" &
  child=\$!
  wait "\$child"; code=\$?
  if [ "\$stop" = 1 ]; then wait "\$child" 2>/dev/null; break; fi
  child=""
  if [ "\$code" = 75 ]; then fails=0; continue; fi
  if [ \$(( \$(date +%s) - start )) -lt 30 ]; then fails=\$((fails + 1)); else fails=0; fi
  if [ "\$fails" -ge 3 ] && [ -f "\$DIR/update.json" ] && [ -f "\$DIR/agent.mjs.prev" ]; then
    echo "\$(date -u +%FT%TZ) new agent version keeps crashing — rolling back" >> "\$DIR/logs/supervisor.log"
    mv -f "\$DIR/agent.mjs.prev" "\$DIR/agent.mjs"; rm -f "\$DIR/update.json"; fails=0
  fi
  delay=\$(( fails < 6 ? 1 << fails : 60 ))
  sleep "\$delay"
done
rm -f "\$DIR/agent.pid"
exit 0
RUNSH
chmod 755 "$INSTALL_DIR/run.sh"

info "Checking connection and local CLIs"
if ! AUTOSEO_AGENT_HOME="$INSTALL_DIR" "$NODE" "$INSTALL_DIR/agent.mjs" doctor; then
  die "The agent could not connect. Check the token/host and re-run the installer."
fi

case "$AUTOSTART" in
  launchd)
    mkdir -p "$HOME/Library/LaunchAgents"
    cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$(xml_escape "$INSTALL_DIR/run.sh")</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Background</string>
  <key>ExitTimeOut</key><integer>30</integer>
  <key>StandardOutPath</key><string>$(xml_escape "$INSTALL_DIR/logs/launchd.log")</string>
  <key>StandardErrorPath</key><string>$(xml_escape "$INSTALL_DIR/logs/launchd.log")</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$(xml_escape "$PATH")</string><key>AUTOSEO_AGENT_HOME</key><string>$(xml_escape "$INSTALL_DIR")</string></dict>
</dict>
</plist>
PLIST
    launchctl bootstrap "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || launchctl load -w "$PLIST"
    launchctl kickstart -k "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
    info "Autostart: launchd LaunchAgent ${dim}$PLIST${reset}"
    ;;
  systemd)
    mkdir -p "$(dirname "$UNIT_FILE")"
    cat > "$UNIT_FILE" <<UNITFILE
[Unit]
Description=AutoSEO local agent (Claude Code / Codex)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/bin/bash "$(systemd_escape "$INSTALL_DIR/run.sh")"
Restart=always
RestartSec=5
KillMode=mixed
TimeoutStopSec=30
Environment="PATH=$(systemd_escape "$PATH")"
Environment="AUTOSEO_AGENT_HOME=$(systemd_escape "$INSTALL_DIR")"

[Install]
WantedBy=default.target
UNITFILE
    systemctl --user daemon-reload
    systemctl --user enable --now "$UNIT" >/dev/null
    systemctl --user restart "$UNIT"
    info "Autostart: systemd user unit ${dim}$UNIT_FILE${reset}"
    if command -v loginctl >/dev/null 2>&1 && [ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null || echo no)" != "yes" ]; then
      warn "To keep the agent running while you are logged out, enable lingering once:  sudo loginctl enable-linger $USER"
    fi
    ;;
  cron)
    ( crontab -l 2>/dev/null | grep -v "autoseo-agent"; echo "@reboot /bin/bash $INSTALL_DIR/run.sh >> $INSTALL_DIR/logs/launchd.log 2>&1 # autoseo-agent" ) | crontab -
    nohup /bin/bash "$INSTALL_DIR/run.sh" >> "$INSTALL_DIR/logs/launchd.log" 2>&1 &
    info "Autostart: crontab @reboot (systemd user session not available)"
    ;;
  none)
    info "Autostart skipped (--no-autostart). Start the agent with: ${bold}$INSTALL_DIR/run.sh${reset}"
    [ "$WAS_RUNNING" = 1 ] && warn "The previously running agent was stopped — start it again with the command above."
    ;;
esac

echo
printf '%s✓ AutoSEO agent %s installed.%s It shows up as online in your dashboard within a few seconds.\n' "$green$bold" "${VERSION:-}" "$reset"
printf '  Logs:      tail -f %s/logs/agent.log\n' "$INSTALL_DIR"
printf '  Status:    %s %s/agent.mjs status\n' "$NODE" "$INSTALL_DIR"
printf '  Uninstall: curl -fsSL %s/install.sh | bash -s -- --uninstall\n' "$HOST"
