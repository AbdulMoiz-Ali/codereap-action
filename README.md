# VibeAudit Security Scan — GitHub Action

> Catch the vulnerabilities **Copilot, Cursor, and Claude routinely leak** — directly on every pull request.

This action runs your changed files through [VibeAudit](https://vibe-audit-hazel.vercel.app) and posts a single, readable security report on the pull request with a grade (A–F), severity counts, and direct links to every finding.

It is **free**, requires **no signup**, and works on public and private repositories.

---

## What it catches

- Hardcoded API keys (OpenAI, Anthropic, Stripe, AWS, GitHub, Google)
- SQL injection (template literals, f-strings, `.format()`)
- Plain-text passwords saved to a database without bcrypt / argon2
- Weak JWT (`algorithm: "none"`, missing expiry, hardcoded secret)
- `eval()` / `exec()` / `os.system()` with user input
- Hallucinated package imports (npm / PyPI names attackers register)
- Missing rate limiting on auth endpoints

Languages: **JavaScript · TypeScript · JSX · TSX · Python**.

---

## Quick start

Add `.github/workflows/vibeaudit.yml`:

```yaml
name: Security Scan

on:
  pull_request:
    branches: [main]

permissions:
  contents: read
  pull-requests: write

jobs:
  vibeaudit:
    runs-on: ubuntu-latest
    steps:
      - uses: AbdulMoiz-Ali/vibeaudit-action@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

That's it. Open a pull request and a VibeAudit comment will appear within seconds.

---

## Configuration

All inputs are optional except `github-token`.

| Input | Default | Description |
| --- | --- | --- |
| `github-token` | — | Required. Use `${{ secrets.GITHUB_TOKEN }}`. |
| `api-url` | `https://vibe-audit-hazel.vercel.app/api/scan` | Override only if you self-host the scanner. |
| `fail-on` | `critical` | Fail the workflow when findings reach this severity. One of: `none`, `low`, `medium`, `high`, `critical`. |
| `comment` | `true` | Whether to post a PR comment. Set to `false` to use outputs only. |
| `max-files` | `50` | Cap on number of changed files scanned. The rest are listed as "skipped". |
| `skip-paths` | `node_modules/`, `dist/`, `build/`, `.next/`, `out/`, `coverage/`, `venv/`, `__pycache__/`, `vendor/` | Newline-separated path prefixes to ignore. |
| `report-base-url` | `https://vibe-audit-hazel.vercel.app` | Base URL used for the public report link. |

### Outputs

| Output | Example |
| --- | --- |
| `grade` | `B` |
| `total-issues` | `7` |
| `critical` | `2` |
| `high` | `3` |
| `medium` | `1` |
| `low` | `1` |
| `report-url` | `https://vibe-audit-hazel.vercel.app/r?g=B&...` |

---

## Recipes

### Block PRs with critical issues

```yaml
- uses: AbdulMoiz-Ali/vibeaudit-action@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    fail-on: critical
```

### Be advisory only — never fail the build

```yaml
- uses: AbdulMoiz-Ali/vibeaudit-action@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    fail-on: none
```

### Use the outputs in another step

```yaml
- id: vibeaudit
  uses: AbdulMoiz-Ali/vibeaudit-action@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    comment: false

- name: Print grade
  run: echo "VibeAudit grade was ${{ steps.vibeaudit.outputs.grade }} with ${{ steps.vibeaudit.outputs.total-issues }} issues."
```

### Skip specific folders

```yaml
- uses: AbdulMoiz-Ali/vibeaudit-action@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    skip-paths: |
      tests/
      examples/
      legacy-code/
```

---

## Permissions

The action needs:

- `contents: read` — to fetch file contents from the PR head.
- `pull-requests: write` — to post / update the comment.

If your workflow uses the default `GITHUB_TOKEN`, those are typically already granted. If your repository has restricted defaults, add the `permissions:` block as shown in the Quick start.

---

## Privacy

When the action runs, the contents of changed files are POSTed to the configured `api-url`. **Nothing is stored** — VibeAudit holds no scan history, no telemetry, no account data.

If you want full control, point `api-url` at your own self-hosted scanner.

---

## Local development

```sh
cd VibeAudit-action
npm install
npm run build      # bundles src/main.ts → dist/index.js
```

The bundled `dist/` directory **must be committed** — that's how GitHub Actions executes the code.

---

## Releasing a new version

```sh
npm run build
git add dist action.yml package.json
git commit -m "Release v1.x.x"
git tag v1.x.x
git tag -f v1
git push origin main --tags --force
```

The floating `v1` tag is what users pin to in their workflows.

---

## License

MIT
