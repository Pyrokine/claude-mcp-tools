# claude-mcp-tools 发版规范

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
feat: 新增 xxx 功能
fix: 修复 xxx 问题
refactor: 重构 xxx 模块
docs: 更新 xxx 文档
chore: 更新版本号
```

## 6. 版本号更新

所有改动完成后，统一更新版本号：

**TypeScript 项目 (mcp-ssh)**
- 修改 `package.json` 中的 `version` 字段

**Rust 项目 (mcp-claude-history)**
- 修改 `Cargo.toml` 中的 `version` 字段

版本号遵循语义化版本（SemVer）：
- 主版本号：不兼容的 API 变更
- 次版本号：向下兼容的功能新增
- 修订号：向下兼容的问题修复

## 7. 发布

### TypeScript 项目 (mcp-ssh)

```bash
cd mcp-ssh
npm run build
npm publish --access public
```

### Rust 项目 (mcp-claude-history)

```bash
cd mcp-claude-history
cargo build --release --target x86_64-unknown-linux-musl
```

编译产物：`target/x86_64-unknown-linux-musl/release/mcp-claude-history`

## 8. 推送与 Release

```bash
git push origin main
git tag vX.Y.Z
git push origin vX.Y.Z
```

创建 Release（使用 gh 命令）：

```bash
# Rust 项目需上传二进制文件
gh release create vX.Y.Z \
  --title "vX.Y.Z" \
  --notes-file CHANGELOG.md \
  mcp-claude-history/target/x86_64-unknown-linux-musl/release/mcp-claude-history

# TypeScript 项目无需上传文件
gh release create vX.Y.Z \
  --title "vX.Y.Z" \
  --notes-file CHANGELOG.md
```

### 更新日志模板

```markdown
## What's Changed

### Features
- Add xxx feature

### Bug Fixes
- Fix xxx issue

### Documentation
- Update xxx documentation

---

## 更新内容

### 新功能
- 新增 xxx 功能

### 问题修复
- 修复 xxx 问题

### 文档
- 更新 xxx 文档

**Full Changelog**: https://github.com/Pyrokine/claude-mcp-tools/compare/vX.Y.Z-1...vX.Y.Z
```
