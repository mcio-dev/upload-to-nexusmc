# Upload to NexusMC

A GitHub Action to upload files to NexusMC and update resources.

> LLM Generated

## Best Practices

Go to `https://github.com/${user}/${repository}/settings/secrets/actions` and setup environments below:
+ Set secret `NEXUSMC_API_TOKEN` to your API token
  - You can get it [here](https://www.nexusmc.cn/settings?tab=api).
+ Set variable `NEXUSMC_RESOURCE_ID` to your resource id
  - You can get resource id in url when you edit it.
  - e.g. `9a4949f8-6d42-45bb-8480-0bab00c9732e`

Then add the workflow file below into `.github/workflows/release.yml` (or whatever filename you want). It will be triggered after you published a release.

```yaml
name: Build and upload Release

on:
  release:
    types: [ published ]

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - name: Checkout
        uses: actions/checkout@v6

      - name: Validate Gradle wrapper
        uses: gradle/actions/wrapper-validation@v4
      - name: Setup Gradle
        uses: gradle/actions/setup-gradle@v4

      - name: Setup Java 25
        uses: actions/setup-java@v3
        with:
          distribution: temurin
          java-version: 25

        # Example for build Gradle project
      - name: Build plugin
        run: ./gradlew build -Pversion="${{ github.event.release.tag_name }}"

        # Optional: Upload file to release, requires 'contents: write' permission above
      - name: Upload to Release
        uses: softprops/action-gh-release@v3
        continue-on-error: true
        with:
          # The single file you want to upload
          files: build/libs/PluginName-${{ github.event.release.tag_name }}.jar
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

        # Important: Actual step to upload file for update resource
      - uses: mcio-dev/upload-to-nexusmc@v1
        with:
          api_token: ${{ secrets.NEXUSMC_API_TOKEN }}
          resource_id: ${{ vars.NEXUSMC_RESOURCE_ID }}
          # The single file you want to upload
          file_path: build/libs/PluginName-${{ github.event.release.tag_name }}.jar
          version: ${{ github.event.release.tag_name }}
```

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `api_token` | Yes | NexusMC Personal API Token |
| `resource_id` | Yes | NexusMC Resource ID |
| `file_path` | No | Path to one file to upload. Kept for compatibility and converted to one primary `files` item. |
| `files` | No | Resource files as JSON array. Each item requires `path` and may include `isPrimary`, `subcategoryIds`, `loaderIds`, `gameVersions`, `mcVersions`, `extractCode`, or other NexusMC file fields. |
| `if_no_files_found` | No | Behavior when `file_path` or `files` is provided but no matching local files exist. Options: `error` (default), `warn`, `ignore`. |
| `version` | No | Resource version number |
| `version_title` | No | Version title |
| `changelog` | No | Changelog for the new version |
| `publish_version` | No | Whether to publish as a new version. Omit it when only patching metadata, docs, or tutorials. (default: true) |
| `mc_versions` | No | Supported Minecraft versions (JSON array, e.g. '["1.20.1"]') |
| `tags` | No | Custom tags (JSON array) |
| `official_tags` | No | Official tags (JSON array) |
| `cover_image_path` | No | Path to cover image file |
| `tutorial_post_ids` | No | Tutorial post IDs (JSON array) |
| `documentation_post_refs` | No | Documentation post references (JSON array) |
| `documentation_url` | No | External documentation URL |
| `dependencies` | No | Dependencies (JSON array) |
| `is_draft` | No | Save as draft. Omit it to leave the current draft/publish state unchanged. |

## Outputs

| Output | Description |
|--------|-------------|
| `resource_id` | The updated resource ID |
| `resource_url` | URL to the resource |
| `status` | Resource status |

## Getting Your API Token

1. Go to [NexusMC](https://www.nexusmc.cn)
2. Navigate to Settings → API Tokens
3. Create a new token with the following scopes:
   - `upload:file` - Upload files
   - `resource:update:self` - Update your resources

## Examples

### Basic Usage

```yaml
- uses: mcio-dev/upload-to-nexusmc@v1
  with:
    api_token: ${{ secrets.NEXUSMC_API_TOKEN }}
    resource_id: ${{ vars.NEXUSMC_RESOURCE_ID }}
    file_path: dist/my-plugin.jar
    version: 1.2.0
```

### Multiple Files With Per-File Metadata

```yaml
- uses: mcio-dev/upload-to-nexusmc@v1
  with:
    api_token: ${{ secrets.NEXUSMC_API_TOKEN }}
    resource_id: ${{ vars.NEXUSMC_RESOURCE_ID }}
    files: |
      [
        {
          "path": "dist/plugin-forge.jar",
          "isPrimary": true,
          "loaderIds": ["forge"],
          "gameVersions": ["1.20.1", "1.21"]
        },
        {
          "path": "dist/plugin-fabric.jar",
          "loaderIds": ["fabric"],
          "gameVersions": ["1.20.1", "1.21"]
        }
      ]
    if_no_files_found: error
    version: 1.2.0
    version_title: "Support Minecraft 1.21"
    changelog: |
      - Fixed bug #123
      - Improved performance
    publish_version: true
    mc_versions: '["1.20.1", "1.21"]'
    tags: '["auto-sync", "feature"]'
```

The action uploads local files through NexusMC first, then sends the returned `url`, `filename`, and `size` as the resource update API's `files` array. This matches the current `PATCH /api/resources/{id}` recommendation and lets each file keep its own loader, version, subcategory, or extract-code metadata. Because `file_path` and `files[].path` are exact paths, any missing specified file triggers `if_no_files_found`: `error` fails the action, `warn` warns and uploads existing files, and `ignore` silently uploads existing files.

### Patch Documentation Or Tutorials Only

```yaml
- uses: mcio-dev/upload-to-nexusmc@v1
  with:
    api_token: ${{ secrets.NEXUSMC_API_TOKEN }}
    resource_id: ${{ vars.NEXUSMC_RESOURCE_ID }}
    documentation_url: https://docs.example.com/my-plugin
    tutorial_post_ids: '["tutorial_post_id"]'
    documentation_post_refs: |
      [
        {
          "id": "getting-started",
          "title": "Getting Started",
          "items": [
            { "id": "doc_install_post_id", "type": "install" }
          ]
        }
      ]
```

### Single File Compatibility With Full Options

```yaml
- uses: mcio-dev/upload-to-nexusmc@v1
  with:
    api_token: ${{ secrets.NEXUSMC_API_TOKEN }}
    resource_id: ${{ vars.NEXUSMC_RESOURCE_ID }}
    file_path: dist/my-plugin.jar
    cover_image_path: dist/cover.png
    version: 1.2.0
    version_title: "Support Minecraft 1.21"
    changelog: |
      - Fixed bug #123
      - Improved performance
    publish_version: true
    mc_versions: '["1.20.1", "1.21"]'
    tags: '["auto-sync", "feature"]'
    documentation_url: https://docs.example.com
    is_draft: false
```

### Update Version Only (No File Upload)

```yaml
- uses: mcio-dev/upload-to-nexusmc@v1
  with:
    api_token: ${{ secrets.NEXUSMC_API_TOKEN }}
    resource_id: ${{ vars.NEXUSMC_RESOURCE_ID }}
    version: 1.2.0
    changelog: "Updated changelog"
```

## License

MIT
