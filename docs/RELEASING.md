# Releasing

## How it works

1. Bump `version` in `package.json` and update `CHANGELOG.md`.
2. Commit, then tag and push:
   ```bash
   git tag -a v1.2.3 -m "v1.2.3 — summary"
   git push origin main v1.2.3
   ```
3. `.github/workflows/release.yml` runs automatically:
   - Packages the VSIX with `vsce package`
   - Creates a GitHub Release with the VSIX attached
   - **If `VSCE_PAT` is configured**, also publishes to the VS Code Marketplace

## Enabling Marketplace auto-publish (one-time setup)

The repo has the publish step wired up but it only runs when the `VSCE_PAT` secret is set. To enable:

### 1. Get an Azure DevOps Personal Access Token

- Sign in at <https://dev.azure.com>
- Profile menu → **Personal access tokens** → **New Token**
- Settings:
  - **Organization**: *All accessible organizations*
  - **Scope**: Custom defined → **Marketplace** → **Manage**
  - **Expiration**: choose a duration (1 year max)
- Copy the token (you only see it once)

### 2. Add as GitHub secret

- Go to <https://github.com/INNO-HI-Inc/md-viewer/settings/secrets/actions>
- **New repository secret**
  - Name: `VSCE_PAT`
  - Value: paste the token

### 3. Verify

Push a new tag. The Release workflow's last step (`Publish to VS Code Marketplace`) will run instead of being skipped.

## Manual publish (one-off)

If you need to publish without going through CI:

```bash
vsce publish -p <your-pat>
```

Run from the repo root. Reads `package.json` for version and publisher.

## Testing before release

The test workflow runs on every push and PR — it must be green before tagging.

```bash
# Run the same checks locally
python3 tests/verify.py
```
