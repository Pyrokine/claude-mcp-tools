# claude-mcp-tools 发版规范

## 版本策略

**子模块独立版本**：每个子模块独立维护版本号，互不影响。

- 新项目第一版从 `1.0.0` 开始
- **Git tag 是仓库级发版序号**（v1.0.0, v1.1.0, ...），不与任何子模块版本绑定
- 每次 release 在 notes 中列出各子模块的版本变化
- npm/cargo 包版本独立维护，与主版本无强关联

## 1. 自评与改动清单

在修改代码前，先进行自我评审：
- 列出所有计划修改的文件
- 说明每个修改的目的和预期影响
- 确认修改是否与现有代码逻辑一致

修改完成后，整理详细的改动清单供 GPT review：
- 按文件列出所有改动
- 每个改动附上简要说明
- 标注改动类型（feat/fix/refactor/docs）

## 2. README 同步更新

- 同时更新英文版（README.md）和中文版（README_zh.md）
- 新增功能需在两个版本中同步添加说明
- 保持两个版本内容一致
- 新增子模块需更新主 README 的工具列表

## 3. MCP 接口暴露检查

- 确认新实现的函数/接口已在 MCP 层正确暴露
- TypeScript 项目：检查 `index.ts` 中的 tool 定义
- Rust 项目：检查 MCP server 的工具注册

## 4. 脱敏检查

发版前检查以下内容是否包含敏感信息：
- 代码中的 IP 地址、域名
- 注释中的内部信息
- 文档中的示例数据
- 配置文件中的凭证

敏感信息需替换为：
- IP：使用 `192.168.x.x` 或 `10.0.0.x`
- 域名：使用 `example.com`
- 凭证：使用占位符如 `xxx`、`your-password`

## 5. 提交规范

按功能或修复进行提交，每次发版可包含多个提交：

```
feat(mcp-xxx): 新增 xxx 功能
fix(mcp-xxx): 修复 xxx 问题
refactor(mcp-xxx): 重构 xxx 模块
docs(mcp-xxx): 更新 xxx 文档
chore: bump version to X.Y.Z
```

## 6. 版本号更新

**子模块独立版本**，各自更新：

**TypeScript 项目**
- 修改 `package.json` 中的 `version` 字段

**Rust 项目**
- 修改 `Cargo.toml` 中的 `version` 字段

版本号遵循语义化版本（SemVer）：
- 主版本号：不兼容的 API 变更
- 次版本号：向下兼容的功能新增
- 修订号：向下兼容的问题修复

## 7. 发布

### TypeScript 项目

```bash
cd mcp-xxx
npm run build
npm publish --access public --registry https://registry.npmjs.org
```

**注意**：
- 必须加 `--registry https://registry.npmjs.org`，否则可能走错 registry
- 网络超时（ETIMEDOUT）是正常的（npmjs.org 不稳定），失败后直接重试
- publish 后必须检查输出中的 `+ @pyrokine/xxx@x.y.z` 确认成功，不能只看 exit code

### Rust 项目

Rust 项目由 GitHub Actions 自动编译（`.github/workflows/release.yml`），push tag 后自动构建 4 个平台并上传到 Release：
- `x86_64-unknown-linux-musl`（Linux 静态链接）
- `x86_64-apple-darwin`（macOS Intel）
- `aarch64-apple-darwin`（macOS ARM）
- `x86_64-pc-windows-msvc`（Windows）

无需手动编译和上传二进制文件。

## 8. 推送与 Release

**重要：打 tag 是最后一步，必须在所有改动（包括 README、npm publish）完成后执行。**

```bash
# 1. 推送所有改动
git push origin main

# 2. 查看当前最新 tag
git tag --sort=-v:refname | head -5

# 3. 在最新 tag 基础上递增
git tag vX.Y.Z
git push origin vX.Y.Z
```

创建 Release（使用 gh 命令）：

```bash
# 不带文件（CI 会自动上传 Rust 二进制产物）
gh release create vX.Y.Z \
  --title "vX.Y.Z" \
  --notes "..."
```

**CI 自动构建**：push tag 后 GitHub Actions 自动触发，编译 mcp-claude-history 的 4 个平台二进制并上传到对应 Release。用 `gh run list` 检查 CI 状态。

### 更新日志模板

Release notes 采用双语格式（英文在前，中文在后），子模块按字母顺序排列：

```markdown
## Versions

- mcp-claude-history: 1.0.0
- mcp-chrome: 1.0.0 (new)
- mcp-ssh: 1.0.0 → 1.1.0

## What's Changed

### mcp-chrome (new)

- feat: Add Chrome browser automation MCP Server

### mcp-ssh

- fix: Load user shell profile for environment variables

---

## 版本

- mcp-claude-history: 1.0.0
- mcp-chrome: 1.0.0 (新增)
- mcp-ssh: 1.0.0 → 1.1.0

## 更新内容

### mcp-chrome (新增)

- feat: 新增 Chrome 浏览器自动化 MCP 服务器

### mcp-ssh

- fix: 加载用户 shell profile 以获取环境变量

**Full Changelog**: https://github.com/Pyrokine/claude-mcp-tools/compare/vX.Y.Z-1...vX.Y.Z
```
