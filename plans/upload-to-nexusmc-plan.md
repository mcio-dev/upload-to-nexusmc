# GitHub Action：NexusMC 资源创建、更新与版本发布

## 1. 当前目标

本项目提供可复用的 TypeScript GitHub Action，并对齐 NexusMC 当前个人 API：

- 创建新资源：`POST /api/resources`
- 局部更新已有资源：`PATCH /api/resources/{id}`
- 独立发布资源版本：`POST /api/resources/{id}/versions`
- 动态读取版本 Tag：`GET /api/resources/version-tags`
- 按官方推荐流程上传普通文件、多个文件、封面和大文件

## 2. 操作模式

| `operation` | 行为 |
|---|---|
| `auto` | 有 `resource_id` 时更新，否则创建 |
| `create` | 显式创建资源 |
| `update` | 显式更新已有资源 |
| `publish-version` | 调用独立版本接口 |

旧版的 `resource_id + file_path` 用法仍会解析为更新操作。

## 3. 上传流程

默认 `upload_strategy=auto`：

1. 调用 `/api/upload/direct/init` 初始化直传。
2. 按响应中的临时地址、方法和请求头上传文件。
3. 调用 `/api/upload/direct/complete` 确认。
4. 直传不可用时降级到 `/api/upload`。
5. 普通上传因文件大小被拒绝时，改用 `/api/upload/session/...` 分块上传并轮询合并状态。

每个文件独立执行上述流程。上传返回的 `url`、`filename`、`size`、`sha256` 和 `sha1` 会映射到资源 `files[]`。

封面使用 `/api/upload/image`，并明确传递 `purpose=cover`。

## 4. 数据契约

- 常用字段使用独立 Action input。
- `resource_data` 接受完整资源创建或更新 JSON，可传官方文档中的其他字段及 `null`。
- `version_data` 接受独立版本接口的完整 JSON。
- 独立 input 覆盖 JSON 对象中的同名字段。
- 数组 `[]` 必须原样发送，用于清空服务端已有关系或标签。
- 省略字段表示保留原值。
- 上传本地文件且未指定 `downloadType` 时自动使用 `local`。

## 5. 发布语义

更新非草稿资源时，NexusMC 在以下任一条件成立时创建版本记录：

- `publishVersion=true`
- 请求包含 `files` 或其他文件相关字段

因此 `publishVersion=false` 不能阻止包含新文件的请求创建版本。Action 在这种组合下输出警告。

`versionTag` 在写入前通过 `/api/resources/version-tags` 获取当前启用值并验证，不在客户端固定枚举。

## 6. GitHub Markdown 转换

NexusMC API 不会把字符串解析成 Markdown，因此 Action 在发送请求前提供独立转换层：

- `content_markdown` / `content_markdown_path` 转换资源正文。
- `changelog_markdown` / `changelog_markdown_path` 转换版本说明。
- 使用 CommonMark、GFM 和数学扩展生成 MDAST，再映射到 NexusMC TipTap JSON。
- 支持标题、文本 marks、链接、图片、引用、列表、任务列表、表格、代码、Mermaid 和数学公式。
- GitHub Actions 环境下，相对链接和图片固定到当前仓库提交；可通过两个 base URL input 覆盖。
- 原始 HTML 不直接注入 TipTap；危险 URL 协议会被移除。
- NexusMC 特有且无法从标准 Markdown 推导的节点继续通过显式 TipTap JSON 提供。

## 7. 工程约束

- Node.js 20 或更高版本。
- 资源创建、更新和版本发布请求不自动重试，避免重复创建内容。
- 上传和只读请求只对网络错误、限流和临时服务错误进行有限重试。
- 所有网络请求都有超时。
- 分块上传失败时尝试取消服务端会话。
- API 非 JSON 错误响应也必须保留状态码和正文。

## 8. 验证

- `npm run build`：TypeScript 严格模式编译。
- `npm test`：构建并运行 Node.js 单元测试。
- push 和 pull request 自动运行构建与测试。
- 真实 NexusMC 集成测试仅通过 `workflow_dispatch` 手动执行。
