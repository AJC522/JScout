#!/bin/sh
# Starts JScout. macOS: double-click JScout.command. Linux: run ./jscout.sh in a terminal, or
# right-click it in the file manager and choose "Run as a Program".
# The first run installs what JScout needs and builds it (scripts/start.mjs does the work); then
# JScout opens in your browser. Close the window, or press Ctrl+C in it, to stop JScout.

cd "$(dirname "$0")" || exit 1

have_node() { command -v node >/dev/null 2>&1; }

# A window opened from the file manager does not have the PATH a terminal has, so Node.js installed
# with nvm, fnm, Homebrew and the like is not found there: ask your own shell for its PATH.
if ! have_node && [ -n "$SHELL" ]; then
  shell_path=$("$SHELL" -lic 'printf "\n<path>%s</path>\n" "$PATH"' </dev/null 2>/dev/null | sed -n 's|^<path>\(.*\)</path>$|\1|p' | tail -n 1)
  [ -n "$shell_path" ] && PATH=$shell_path
fi
if ! have_node; then
  for dir in /opt/homebrew/bin /usr/local/bin "$HOME/.volta/bin"; do
    if [ -x "$dir/node" ]; then
      PATH="$dir:$PATH"
      break
    fi
  done
fi

if have_node; then
  node scripts/start.mjs "$@"
  status=$?
else
  echo "JScout needs Node.js, which was not found on this computer."
  echo "Install the LTS version from https://nodejs.org/ and start JScout again."
  status=1
fi

# Started by double-click, the window would close before the message above could be read.
if [ "$status" -ne 0 ] && [ -t 0 ] && [ -t 1 ]; then
  printf '\nPress Enter to close. '
  read -r _
fi
exit "$status"
