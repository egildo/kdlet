# Notes for Claude

## Versions move in lockstep

`kdlet`, `kdlet-html` and `kdlet-guards` always carry the same version number, and that number is the repository's own. A change to any one of them bumps all three together, even when two of them change nothing of their own. The changelog has one heading per version, not one per package. Git tags are `vX.Y.Z` for the whole repository.

To release: bump `version` in the three `package.json` files, add the changelog heading, run `pnpm install --lockfile-only`, `pnpm test` (it builds first) and a dry run with `pnpm -r publish --dry-run --no-git-checks`, commit, push, then publish with `pnpm -r publish --access public` and tag after it succeeds. Publishing needs the owner's approval in the browser, so Claude hands over the command and does not run it.
