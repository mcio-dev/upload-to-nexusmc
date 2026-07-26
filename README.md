# Upload to NexusMC

A GitHub Action for creating resources, updating existing resources, publishing versions, and converting GitHub Markdown to NexusMC TipTap JSON through the current Personal API.

The action follows the official two-stage workflow: upload local files first, then submit the returned URL, original filename, size, and hashes to the resource API.

## Requirements

- A runner with Node.js 20 or later.
- A NexusMC Personal API Token with only the scopes needed by the selected operation:
  - `upload:file` for local files or cover images.
  - `resource:create` for creating resources.
  - `resource:update:self` for updating your resources or publishing versions.
- `resource:read:self` is not required by this action. Version Tag discovery is public.

Store the token as an Actions secret such as `NEXUSMC_API_TOKEN`. Store an existing resource ID as a repository variable such as `NEXUSMC_RESOURCE_ID`.

## Operations

| Operation | API | Required values |
|---|---|---|
| `auto` | Creates without `resource_id`; updates with it | Depends on resolved operation |
| `create` | `POST /api/resources` | `title`, `category`, `content` |
| `update` | `PATCH /api/resources/{id}` | `resource_id` and at least one update field |
| `publish-version` | `POST /api/resources/{id}/versions` | `resource_id`, `version` |

`auto` is the default and preserves the old update usage when `resource_id` is supplied.

## Update An Existing Resource

```yaml
- uses: mcio-dev/upload-to-nexusmc@v1
  with:
    api_token: ${{ secrets.NEXUSMC_API_TOKEN }}
    resource_id: ${{ vars.NEXUSMC_RESOURCE_ID }}
    file_path: build/libs/MyPlugin-${{ github.ref_name }}.jar
    version: ${{ github.ref_name }}
    version_tag: releases
    version_title: "Release ${{ github.ref_name }}"
    changelog_markdown: ${{ github.event.release.body }}
    publish_version: true
```

The NexusMC API creates a version for a non-draft resource whenever an update contains `files`, even when `publish_version` is omitted or false. `publish_version: true` is an explicit request, not a way to suppress the server's file-triggered version behavior.

## Create A Resource

Without `resource_id`, the default `auto` operation creates a resource:

```yaml
- uses: mcio-dev/upload-to-nexusmc@v1
  with:
    api_token: ${{ secrets.NEXUSMC_API_TOKEN }}
    title: My Plugin
    category: plugin
    platform: java
    content_markdown_path: README.md
    version: 1.0.0
    version_tag: releases
    file_path: build/libs/MyPlugin-1.0.0.jar
    is_draft: true
```

Use `operation: create` when you want an explicit failure instead of accidentally updating a supplied resource ID.

## Publish Through The Independent Version API

```yaml
- uses: mcio-dev/upload-to-nexusmc@v1
  with:
    api_token: ${{ secrets.NEXUSMC_API_TOKEN }}
    operation: publish-version
    resource_id: ${{ vars.NEXUSMC_RESOURCE_ID }}
    version: 2.0.0
    version_tag: beta
    version_title: "NeoForge build"
    changelog: "Supports Minecraft 1.21.1."
    file_path: build/libs/MyPlugin-2.0.0.jar
    mc_versions: '["1.21.1"]'
```

For this operation, `version_title` is mapped to the version endpoint's `title` field. `cover_image_path` is intentionally rejected because the independent version endpoint does not update the resource cover.

## Multiple Files And Per-file Metadata

```yaml
- uses: mcio-dev/upload-to-nexusmc@v1
  with:
    api_token: ${{ secrets.NEXUSMC_API_TOKEN }}
    resource_id: ${{ vars.NEXUSMC_RESOURCE_ID }}
    files: |
      [
        {
          "path": "fabric/build/libs/MyMod-fabric.jar",
          "isPrimary": true,
          "loaderIds": ["fabric"],
          "gameVersions": ["1.21.1"]
        },
        {
          "path": "neoforge/build/libs/MyMod-neoforge.jar",
          "loaderIds": ["neoforge"],
          "gameVersions": ["1.21.1"]
        }
      ]
    version: 2.0.0
    version_tag: releases
```

Each item requires a local `path`. Other keys are passed through as NexusMC `files[]` metadata. Supported canonical fields include `isPrimary`, `subcategoryIds`, `gameVersions`, `extractCode`, `sha256`, and `sha1`; documented aliases such as `loaderIds` and `mcVersions` remain supported. Exactly one file may set `isPrimary: true`; the first file becomes primary when none is selected.

Upload response hashes are automatically copied to `files[].sha256` and `files[].sha1` when the selected upload method returns them.

## Complete Resource Fields

`resource_data` accepts a JSON object containing any current resource create/update field. It is the forward-compatible path for less common fields such as `repositoryUrl`, `visibility`, `galleryImages`, `licenseId`, or nullable values. Dedicated Action inputs override matching properties from `resource_data`.

```yaml
- uses: mcio-dev/upload-to-nexusmc@v1
  with:
    api_token: ${{ secrets.NEXUSMC_API_TOKEN }}
    operation: update
    resource_id: ${{ vars.NEXUSMC_RESOURCE_ID }}
    resource_data: |
      {
        "repositoryUrl": "https://github.com/example/project",
        "documentationUrl": null,
        "galleryImages": [],
        "visibility": "public"
      }
    tags: '[]'
    dependencies: '[]'
```

Array fields are sent even when empty, so `[]` clears the existing server value. Omit an input to preserve its current value. Use `resource_data` with `null` to clear nullable URL or image fields.

For `operation: publish-version`, `version_data` provides the same JSON-object escape hatch for independent version fields. Dedicated version inputs override matching values.

## GitHub Markdown To TipTap

NexusMC treats a string passed through `content` as plain text; it does not parse Markdown. This action can convert GitHub Flavored Markdown into a TipTap JSON object before the resource request is sent:

```yaml
- uses: mcio-dev/upload-to-nexusmc@v1
  with:
    api_token: ${{ secrets.NEXUSMC_API_TOKEN }}
    resource_id: ${{ vars.NEXUSMC_RESOURCE_ID }}
    content_markdown_path: README.md
    changelog_markdown: ${{ github.event.release.body }}
```

The converter uses a CommonMark/GFM syntax tree rather than regular expressions. Its mappings include:

| GitHub Markdown | NexusMC TipTap |
|---|---|
| Paragraphs and headings | `paragraph`, `heading` |
| Bold, italic, strike, inline code, links | TipTap marks |
| Quotes and horizontal rules | `blockquote`, `horizontalRule` |
| Ordered, unordered, nested, and task lists | List and task nodes |
| GFM tables | `table`, `tableRow`, `tableHeader`, `tableCell` |
| GitHub footnotes | Superscript references and definition paragraphs |
| Fenced code | `codeBlock`, including supported line metadata |
| `mermaid` fenced code | `mermaidDiagram` |
| GitHub inline/block math | `math` with `inline` and `latex` attrs |
| Images | Block-level `image` nodes |

When running on GitHub Actions, relative links and images are resolved against the current repository commit. Links use the commit's `blob` URL and images use its `raw` URL. For a Markdown file in a subdirectory, the file's directory is included automatically. Override this behavior with `markdown_link_base_url` and `markdown_image_base_url`; both must be absolute HTTP(S) base URLs ending at the desired source directory.

For private repositories, GitHub raw URLs are normally not readable by NexusMC visitors. Point `markdown_image_base_url` at a public CDN or image host, or provide TipTap JSON containing URLs returned by the NexusMC image upload API.

Raw HTML is not inserted into TipTap. Block HTML is preserved as an inert `html` code block, inline HTML is preserved as text, and `<br>` becomes `hardBreak`. Unsafe link and image protocols are removed. GitHub `@name` text cannot become a NexusMC `mention` because Markdown does not contain the required NexusMC user ID. NexusMC-only nodes such as Bilibili embeds, dynamic images, collapse blocks, and link cards require explicit TipTap JSON through `content` or `resource_data`.

`content` cannot be combined with `content_markdown` or `content_markdown_path`. The same exclusivity rule applies to the three changelog inputs.

The converter is also exported for programmatic use:

```js
const { markdownToTiptap } = require('upload-to-nexusmc')

const document = await markdownToTiptap(markdown, {
  linkBaseUrl: 'https://github.com/example/project/blob/main/',
  imageBaseUrl: 'https://github.com/example/project/raw/main/',
})
```

## Upload Strategies

| Strategy | Behavior |
|---|---|
| `auto` | Preferred direct upload, then ordinary upload, then chunk upload when the ordinary endpoint rejects file size |
| `direct` | Direct initialization, temporary-address transfer, and confirmation only |
| `standard` | `POST /api/upload` only |
| `chunk` | Session initialization, bounded chunks, asynchronous merge polling, and failed-session cancellation |

`auto` is the default. Files are uploaded individually so each file can use the official fallback flow independently. `chunk_size_mb` defaults to 8 and cannot exceed the API limit of 20 MB. `request_timeout_seconds` defaults to 900.

When local resource files are uploaded, `downloadType` defaults to `local`. Set `download_type: external` only when supplying external download fields through `resource_data` or `version_data`.

Cover images use `POST /api/upload/image` with `purpose=cover`.

## Inputs

| Input | Required | Description |
|---|---|---|
| `api_token` | Yes | NexusMC Personal API Token |
| `operation` | No | `auto`, `create`, `update`, or `publish-version`; default `auto` |
| `resource_id` | Conditional | Required for update and version publishing |
| `resource_data` | No | Complete resource fields as a JSON object |
| `version_data` | No | Independent version fields as a JSON object |
| `title` | Create | Resource title |
| `description` | No | Resource description |
| `content` | Create | TipTap JSON or plain string content |
| `content_markdown` | Create | Inline GitHub Markdown converted to TipTap |
| `content_markdown_path` | Create | UTF-8 GitHub Markdown file converted to TipTap |
| `category` | Create | Resource category ID or value |
| `platform` | No | Resource platform |
| `file_path` | No | One exact local file path; legacy-compatible input |
| `files` | No | JSON array of local paths and per-file metadata |
| `if_no_files_found` | No | `error` (default), `warn`, or `ignore` |
| `upload_strategy` | No | `auto` (default), `direct`, `standard`, or `chunk` |
| `chunk_size_mb` | No | Chunk size, default 8, maximum 20 |
| `request_timeout_seconds` | No | Request and merge polling timeout, default 900 |
| `version` | Version publish | Version number |
| `version_tag` | No | Enabled Tag key, dynamically validated against NexusMC |
| `version_title` | No | Version title |
| `changelog` | No | TipTap JSON or plain string changelog |
| `changelog_markdown` | No | Inline GitHub Markdown converted to a TipTap changelog |
| `changelog_markdown_path` | No | UTF-8 GitHub Markdown file converted to a TipTap changelog |
| `markdown_link_base_url` | No | Explicit base URL for relative Markdown links |
| `markdown_image_base_url` | No | Explicit base URL for relative Markdown images |
| `publish_version` | No | Explicitly request a version during resource update |
| `download_type` | No | `local` or `external` |
| `mc_versions` | No | JSON array; `[]` clears it |
| `tags` | No | JSON array; `[]` clears it |
| `official_tags` | No | JSON array; `[]` clears it |
| `cover_image_path` | No | Local cover image path |
| `tutorial_post_ids` | No | JSON array; `[]` clears it |
| `documentation_post_refs` | No | JSON array; `[]` clears it |
| `documentation_url` | No | External documentation URL |
| `dependencies` | No | JSON array; `[]` clears it |
| `is_draft` | No | Draft state; omit to preserve it on update |

Invalid JSON inputs fail the Action instead of being silently ignored.

## Outputs

| Output | Description |
|---|---|
| `operation` | Resolved operation |
| `resource_id` | Created or updated resource ID |
| `resource_url` | Public NexusMC resource URL |
| `status` | Status returned by NexusMC |
| `version_id` | Created version ID when returned |

## Official API Documentation

- [Resource upload and publishing flow](https://docs.nexusmc.cn/docs/api/personal-api-resource-upload-flow)
- [Resource API](https://docs.nexusmc.cn/docs/api/personal-api-resources)
- [Resource files and versions](https://docs.nexusmc.cn/docs/api/personal-api-resource-files)
- [File upload API](https://docs.nexusmc.cn/docs/api/personal-api-uploads)
- [TipTap content format](https://docs.nexusmc.cn/docs/api/tiptap-content-format)
- [TipTap node reference](https://docs.nexusmc.cn/docs/api/tiptap-content-reference)
- [TipTap examples](https://docs.nexusmc.cn/docs/api/tiptap-content-examples)

## License

MIT
