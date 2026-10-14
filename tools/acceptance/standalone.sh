#!/usr/bin/env bash
# Builds apps OUTSIDE the workspace, as their own repos will: packs packages/euterpe, copies each app (its files
# committed at HEAD) into a clean
# temp folder whose package.json depends on the tarball (not workspace:*), npm install, then
# `euterpe smoke --build --expect-answer` (the production build served like a static host, COOP/COEP), and
# reports the build's size and its largest files (GitHub refuses files over 100 MB).
#   tools/acceptance/standalone.sh app[:mode] ...     e.g. bachduet:official bachduet folkduet realchords
# Writes $WORK/<app>[-mode].json (the smoke report) and prints a summary. Exits 1 if any app fails.
set -uo pipefail

REPO=$(cd "$(dirname "$0")/../.." && pwd)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/euterpe-standalone.XXXX")
(cd "$REPO/packages/euterpe" && pnpm pack --pack-destination "$WORK" > /dev/null) || exit 1
TARBALL=$(ls "$WORK"/euterpe-*.tgz)
echo "tarball: $TARBALL ($(du -h "$TARBALL" | cut -f1))"
FAILED=0
for spec in "$@"; do
    app=${spec%%:*}
    mode=$([[ "$spec" == *:* ]] && echo "${spec#*:}" || echo "")
    name=$app${mode:+-$mode}
    dir="$WORK/$name"
    echo "== $name"
    # the app's committed files only (what a clone of its own repo gets; untracked and ignored files stay out)
    mkdir -p "$dir" && git -C "$REPO" archive HEAD "apps/$app" | tar -x -C "$dir" --strip-components=2
    # depend on the tarball; playwright-core for euterpe smoke
    node -e '
        const fs = require("fs"); const [file, tarball] = process.argv.slice(1);
        const p = JSON.parse(fs.readFileSync(file, "utf8"));
        p.dependencies.euterpe = "file:" + tarball;
        p.devDependencies = {...p.devDependencies, "playwright-core": p.devDependencies?.["playwright-core"] ?? "^1.63.0"};
        fs.writeFileSync(file, JSON.stringify(p, null, 2));
    ' "$dir/package.json" "$TARBALL"
    if ! (cd "$dir" && npm install --no-audit --no-fund --loglevel=error > "$WORK/$name.install.log" 2>&1); then
        echo "  ✗ npm install failed (see $WORK/$name.install.log)"; FAILED=1; continue
    fi
    if (cd "$dir" && npx euterpe smoke --build --expect-answer --json ${mode:+--mode=$mode} > "$WORK/$name.json" 2> "$WORK/$name.err"); then
        echo "  ✓ smoke"
    else
        echo "  ✗ smoke (see $WORK/$name.json, $WORK/$name.err)"; FAILED=1
    fi
    node -e '
        const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
        console.log("  crossOriginIsolated:", r.crossOriginIsolated, "| errors:", r.errors.length,
            "| failed requests:", r.failedRequests.length, "| agent notes:", r.agentNoteOns.length);
        for (const e of [...r.errors, ...r.failedRequests].slice(0, 3)) console.log("   ", JSON.stringify(e).slice(0, 200));
    ' "$WORK/$name.json" 2> /dev/null || true
    echo "  build: $(du -sh "$dir/dist" | cut -f1), $(find "$dir/dist" -type f | wc -l | tr -d ' ') files; largest:"
    find "$dir/dist" -type f -size +5M -exec ls -l {} + 2>/dev/null | awk -v d="$dir/dist/" '{sub(d, "", $9); printf "    %6.1f MB  %s\n", $5/1048576, $9}' | sort -rn | head -4
done
echo "work dir: $WORK"
exit $FAILED
