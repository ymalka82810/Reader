# Workflow

- `main` is protected and auto-deploys to the live site (GitHub Pages) used by real users. Never push directly to `main`.
- For every change: create a branch, commit, push, open a PR (`gh pr create --fill`), wait for the CI check `check` to pass, then merge (`gh pr merge --squash --delete-branch`).
- Run `npm run lint`, `npm run build`, `npm run knip` and `npm test` locally before opening the PR.
- Stage only the files you changed; the working tree may hold the user's uncommitted work. Never use `git add -A`.
- The Android APK is built manually (`android.yml`, workflow_dispatch) and is independent of merges.
