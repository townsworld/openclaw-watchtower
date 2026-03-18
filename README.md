# openclaw-watchtower

[OpenClaw](https://openclaw.ai) 插件 —— 线上服务异常巡查与根因分析。自动从 Sentry 获取异常数据，结合 `code_agent` 进行代码级根因定位，通过飞书输出分析报告。

支持数据源：**Sentry**（更多数据源如阿里云 SLS 将逐步支持）

---

## 快速开始

### 前置条件

- [OpenClaw](https://openclaw.ai) 已安装并绑定飞书
- [openclaw-agent](https://github.com/townsworld/openclaw-agent) 已安装并配置项目（用于代码分析）
- Sentry Auth Token（Settings > Auth Tokens，需要 `project:read` + `event:read` 权限）
- macOS 或 Linux

### 一键安装

```bash
curl -fsSL https://raw.githubusercontent.com/townsworld/openclaw-watchtower/main/scripts/install.sh | bash
```

安装脚本会交互式引导完成以下步骤：

| 步骤 | 内容 |
|------|------|
| 1. 环境检查 | 确认 OpenClaw Gateway 已就绪 |
| 2. 下载插件 | 从 GitHub Release 获取最新版本 |
| 3. Sentry 配置 | 引导输入 Base URL、Auth Token、Org、Projects，并测试连通性 |
| 4. 写入配置 | 自动更新 `~/.openclaw/openclaw.json` |
| 5. 重启 Gateway | 自动重启以加载插件 |

### 更新插件

```bash
curl -fsSL https://raw.githubusercontent.com/townsworld/openclaw-watchtower/main/scripts/install.sh | bash -s -- --upgrade
```

`--upgrade` 模式只更新插件代码，跳过 Sentry 配置。版本相同时会提示是否重装。

### 一键卸载

```bash
curl -fsSL https://raw.githubusercontent.com/townsworld/openclaw-watchtower/main/scripts/uninstall.sh | bash
```

卸载插件文件、`openclaw.json` 中的相关配置和巡检状态文件。

### 手动安装

```bash
gh release download -R townsworld/openclaw-watchtower -p "*.tgz"
mkdir -p ~/.openclaw/extensions/openclaw-watchtower
tar -xzf openclaw-watchtower-*.tgz -C ~/.openclaw/extensions/openclaw-watchtower --strip-components=1
```

在 `~/.openclaw/openclaw.json` 的 `plugins` 中添加：

```json
{
  "allow": ["openclaw-watchtower"],
  "entries": {
    "openclaw-watchtower": {
      "enabled": true,
      "config": {
        "sentry": {
          "baseUrl": "https://sentry.io",
          "authToken": "sntrys_...",
          "org": "your-org",
          "projects": ["backend", "api-gateway", "web-app"]
        }
      }
    }
  }
}
```

然后重启 Gateway：`openclaw gateway restart`

---

## 使用方式

### Slash 命令

在飞书中向 OpenClaw 发送：

```
/patrol              — 执行一次巡检，检查所有配置项目的新异常
/patrol status       — 查看上次巡检时间
/patrol cleanup      — 清理 7 天前的巡检状态记录
```

### 自然语言触发

插件注册了 `watchtower_sentry` 工具，直接用自然语言提问：

```
查一下线上有没有新的报错
帮我巡检一下最近的异常
看看 sentry 上有没有新问题
```

### 自动巡检（Cron）

配合 OpenClaw Cron 实现定时巡检，在 `~/.openclaw/cron/jobs.json` 中添加：

```json
{
  "id": "watchtower-patrol",
  "schedule": "*/15 * * * *",
  "sessionTarget": "main",
  "payload": {
    "type": "agentTurn",
    "content": "执行线上异常巡检"
  }
}
```

---

## 工作流程

```
Cron/用户触发
    │
    ▼
watchtower_sentry 工具
    │  查询 Sentry API → 获取未解决异常 + 堆栈
    │  去重过滤（已分析的不重复报告）
    │
    ▼
code_agent 工具（由 openclaw-agent 提供）
    │  根据异常堆栈定位代码
    │  分析根因 + 给出修复建议
    │
    ▼
飞书输出巡检报告
```

**关键设计**：
- `watchtower_sentry` 负责数据获取，`code_agent` 负责代码分析，职责分离
- 内置去重机制，同一异常 1 小时内不重复分析
- 每次巡检最多分析 3 个异常，优先 fatal/error 级别
- Sentry project slug 与 `code_agent` 项目名自动匹配

---

## 配置参考

配置位于 `~/.openclaw/openclaw.json` → `plugins.entries.openclaw-watchtower.config`。

### Sentry

| 配置项 | 必填 | 默认值 | 说明 |
|--------|------|--------|------|
| `sentry.baseUrl` | 是 | — | Sentry API 地址（`https://sentry.io` 或自建地址） |
| `sentry.authToken` | 是 | — | Auth Token（需要 `project:read` + `event:read`） |
| `sentry.org` | 是 | — | Organization slug |
| `sentry.projects` | 是 | — | 要监控的 project slug 列表 |
| `sentry.lookbackMinutes` | 否 | `15` | 每次巡检回溯的时间窗口（分钟） |
| `sentry.maxIssuesPerQuery` | 否 | `10` | 每次查询返回的最大 issue 数 |

---

## 扩展数据源

插件采用模块化设计，未来计划支持更多数据源：

| 数据源 | 状态 | 说明 |
|--------|------|------|
| Sentry | ✅ 已支持 | 异常/错误追踪 |
| 阿里云 SLS | 🚧 计划中 | 日志查询与分析 |
| Grafana | 🚧 计划中 | 指标异常检测 |

扩展新数据源只需在插件中添加对应的 Tool（如 `watchtower_sls`），并在 Skill 中补充编排逻辑。

---

## 开发

```bash
npm install       # 安装依赖
npm run dev       # 监听文件变化，自动构建
npm run build     # 单次构建
npm run pack      # 构建并打包 .tgz
npm test          # 运行测试
```

## License

Apache-2.0
