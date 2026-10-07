#!/usr/bin/env bash
# Rehearses `npm create euterpe@latest` end to end against a fresh local npm registry (Verdaccio), never the
# public one: publishes packages/euterpe and packages/create-euterpe to it, then for each template, in a clean
# folder: npm create, npm install, npm run smoke (dev server), npm run smoke -- --build (static build); and for
# copycat, npx euterpe eject + install + smoke.
#   tools/acceptance/rehearse.sh [template ...]      (default: empty copycat call-response)
# Templates other than empty must answer the smoke check's phrase. Exits 1 on the first failure.
set -euo pipefail

REPO=$(cd "$(dirname "$0")/../.." && pwd)
TEMPLATES=("${@:-empty copycat call-response}")
read -r -a TEMPLATES <<< "${TEMPLATES[*]}"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/euterpe-rehearsal.XXXX")
PORT=4875
REGISTRY="http://localhost:$PORT/"
PIDS=()
PORTS=("$PORT")
# stop everything this script started: the background jobs and whatever listens on its ports (npx children)
cleanup() {
    exec 2> /dev/null # no "Terminated" lines for the jobs stopped here
    for pid in ${PIDS[@]+"${PIDS[@]}"}; do kill "$pid" 2>/dev/null || true; done
    for p in "${PORTS[@]}"; do lsof -ti "tcp:$p" -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null || true; done
}
trap cleanup EXIT
if lsof -ti "tcp:$PORT" -sTCP:LISTEN > /dev/null 2>&1; then echo "port $PORT is in use"; exit 1; fi

# a registry that serves our two packages and proxies everything else from npmjs
cat > "$WORK/verdaccio.yaml" <<EOF
storage: $WORK/storage
uplinks:
  npmjs:
    url: https://registry.npmjs.org/
packages:
  'euterpe':
    access: \$all
    publish: \$anonymous
  'create-euterpe':
    access: \$all
    publish: \$anonymous
  '**':
    access: \$all
    proxy: npmjs
log: {type: stdout, format: pretty, level: warn}
EOF
# Verdaccio itself comes from the public registry
(cd "$WORK" && npx -y verdaccio@6 --config "$WORK/verdaccio.yaml" --listen "$PORT" > "$WORK/verdaccio.log" 2>&1) &
PIDS+=($!)
for _ in $(seq 1 90); do curl -sf "${REGISTRY}-/ping" > /dev/null && break; sleep 1; done
curl -sf "${REGISTRY}-/ping" > /dev/null || { echo "the local registry did not start:"; cat "$WORK/verdaccio.log"; exit 1; }
echo "registry: $REGISTRY  work: $WORK"

# from here on every npm command uses only this config: the local registry and a dummy token
printf 'registry=%s\n//localhost:%s/:_authToken=local-rehearsal\n' "$REGISTRY" "$PORT" > "$WORK/npmrc"
export NPM_CONFIG_USERCONFIG="$WORK/npmrc"
export npm_config_registry="$REGISTRY"
# and an empty cache, like a first-time user (npx would otherwise reuse a create-euterpe of the same version)
export npm_config_cache="$WORK/npm-cache"

for pkg in euterpe create-euterpe; do
    (cd "$REPO/packages/$pkg" && npm publish --registry "$REGISTRY" > "$WORK/publish-$pkg.log" 2>&1) ||
        { echo "publishing $pkg failed:"; tail -20 "$WORK/publish-$pkg.log"; exit 1; }
    echo "published $pkg@$(node -p "require('$REPO/packages/$pkg/package.json').version") to $REGISTRY"
done

for template in "${TEMPLATES[@]}"; do
    echo "== $template"
    dir="$WORK/projects/$template"
    mkdir -p "$WORK/projects"
    (cd "$WORK/projects" && npm create euterpe@latest "$template" -- --template "$template" < /dev/null > /dev/null)
    (cd "$dir" && npm install --no-audit --no-fund > "$WORK/install-$template.log" 2>&1)
    # the commands a user runs: npm run smoke (dev server) and npm run smoke -- --build (static build)
    (cd "$dir" && npm run --silent smoke -- --json > "$WORK/check-dev-$template.json" 2> "$WORK/check-dev-$template.err") ||
        { echo "dev check failed:"; cat "$WORK/check-dev-$template.json" "$WORK/check-dev-$template.err"; exit 1; }
    echo "  dev:    ok $(node -p "JSON.stringify(require('$WORK/check-dev-$template.json').agentNoteOns)")"
    (cd "$dir" && npm run --silent smoke -- --build --json > "$WORK/check-build-$template.json" 2> "$WORK/check-build-$template.err") ||
        { echo "build check failed:"; cat "$WORK/check-build-$template.json" "$WORK/check-build-$template.err"; exit 1; }
    echo "  build:  ok $(node -p "JSON.stringify(require('$WORK/check-build-$template.json').agentNoteOns)") ($(du -sh "$dir/dist" | cut -f1))"
    if [ "$template" = copycat ]; then
        # eject: Euterpe copied into the project, installed from there, still passing
        (cd "$dir" && npx euterpe eject > "$WORK/eject.log" && npm install --no-audit --no-fund >> "$WORK/eject.log" 2>&1 &&
            npm run --silent smoke -- --json > "$WORK/check-eject.json" 2>> "$WORK/eject.log") ||
            { echo "eject check failed:"; cat "$WORK/eject.log" "$WORK/check-eject.json"; exit 1; }
        echo "  eject:  ok (euterpe -> $(node -p "require('$dir/package.json').dependencies.euterpe"))"
    fi
done
echo "all passed"
