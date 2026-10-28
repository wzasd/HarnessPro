# HarnessPro

HarnessPro 是一个本地 Orca 插件，包含共享预算策略、检查协调器，以及 OpenCode 2、Codex、Pi 适配器。

本项目是第三方插件，不由 HarnessPro 论文作者维护。当前版本不支持自动模型路由和多 Agent 自动进化。

## 功能

| 组件 | 当前功能 |
| --- | --- |
| Orca 插件 | 运行检查、查看状态、停止检查、显示完成通知 |
| 共享策略 | 提供 Lite、Medium、Heavy 3 档工具预算 |
| OpenCode 2 | 工具提醒、超限阻断、重复日志折叠 |
| Codex | 工具提醒、超限阻断、并行调用计数 |
| Pi | 工具提醒、超限阻断、重复日志折叠、会话内切换档位 |

Codex 官方 Hook 不支持改写工具结果，因此 Codex 适配器不折叠日志。

## 环境要求

- Linux。
- Node.js 22 或更高版本。
- Python 3.12 或更高版本。
- Orca 1.4.0 或更高版本。
- 按需安装 OpenCode 2、Codex 或 Pi。

## 本地安装

1. 克隆项目并安装测试依赖：

   ```bash
   git clone git@github.com:wzasd/HarnessPro.git
   cd HarnessPro
   npm install
   ```

2. 链接插件和适配器：

   ```bash
   npm run install:local
   ```

3. 打开 Orca 的“设置 → Plugins”。
4. 刷新插件并查看 HarnessPro 权限说明。
5. 启用 HarnessPro。

安装脚本会备份已有文件，再创建符号链接。备份后缀为 `.backup-before-project` 和 `.backup-before-harnesspro-project`。

## 使用预算档位

启动 Agent 前选择档位：

```bash
harnesspro lite opencode2 --standalone
harnesspro medium codex
harnesspro heavy pi
```

Pi 会话内也可以切换：

```text
/harnesspro lite
/harnesspro medium
/harnesspro heavy
/harnesspro off
```

未选择档位时，预算限制默认关闭。

## 使用 Orca 检查

HarnessPro 面板提供“运行检查”“查看状态”“停止检查”。

终端也可以执行：

```bash
harnesspro checks start
harnesspro checks status
harnesspro checks stop
```

检查在独立进程中运行。关闭面板不会停止检查。

状态和日志位于：

```text
~/.local/state/harnesspro/checks.json
~/.local/state/harnesspro/checks.log
```

## 修改共享策略

策略文件位于项目根目录：

```text
policy.json
```

| 档位 | Economy | Convergence | 工具上限 |
| --- | ---: | ---: | ---: |
| Lite | 8 | 14 | 22 |
| Medium | 14 | 26 | 44 |
| Heavy | 20 | 36 | 60 |

这些数值是本地初始值，不是论文推荐值。修改前宜记录真实任务的通过率和成本。

## 通过 Marketplace 安装

1. 打开 Orca 的“设置 → Plugins → Marketplace sources”。
2. 添加 Git 地址：

   ```text
   https://github.com/wzasd/HarnessPro.git
   ```

3. 将 ref 设为 `main`。
4. 安装 `harnesspro.orca`。
5. 查看权限说明并启用插件。

Marketplace 当前指向 `v0.1.0`。Orca 的插件 API 仍处于实验阶段。

## 更新

本地链接安装只需要拉取新代码：

```bash
git pull
npm install
npm test
```

符号链接会继续指向项目目录。无需重复运行安装脚本。

Marketplace 安装需要在 Orca 的 Plugins 页面确认更新。插件版本使用不可变目录，策略和任务记录不会随版本切换删除。

## 开发与测试

主要文件：

```text
orca-plugin.json       Orca 插件清单
main.mjs              Orca worker
panel.html            Orca 面板
coordinator.mjs       独立检查进程
core.mjs              OpenCode 2 和 Pi 共用逻辑
policy.json           共享预算
adapters/             OpenCode 2、Codex、Pi 适配器
scripts/              本地安装和注册脚本
```

运行全部检查：

```bash
npm test
```

安装脚本会修改以下配置：

- Orca 的 `settings.devPluginPaths`。
- Pi 的扩展列表。
- Codex 的 `PreToolUse` 和 `PostToolUse` Hook。

## 发布新版本

1. 更新 `package.json` 和 `orca-plugin.json` 的版本号。
2. 更新 `orca-marketplace.json` 中的 ref。
3. 运行 `npm test`。
4. 提交变更并创建同名 Git 标签。
5. 将提交和标签推送到 GitHub。

## 当前边界

- 当前版本不支持自动模型路由。
- 当前版本不支持多 Agent 自动进化。
- 候选策略不会自动替换当前策略。
- Orca 插件接口仍可能变化。

## License

MIT，见 [LICENSE](LICENSE)。
