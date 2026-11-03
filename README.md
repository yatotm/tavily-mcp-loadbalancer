# Tavily MCP Load Balancer

[![Docker Hub](https://img.shields.io/docker/pulls/yatotm1994/tavily-mcp-loadbalancer?style=flat-square)](https://hub.docker.com/r/yatotm1994/tavily-mcp-loadbalancer)
[![Docker Image Size](https://img.shields.io/docker/image-size/yatotm1994/tavily-mcp-loadbalancer?style=flat-square)](https://hub.docker.com/r/yatotm1994/tavily-mcp-loadbalancer)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Language / 语言**: [English](./README_EN.md) | [中文](./README.md)

一个支持 Tavily 与 Exa 多 API 密钥负载均衡的 MCP 网关，提供 SSE 和 streamableHTTP 接口，自动轮询多个 API 密钥以实现高可用性。

## v4.1.2：逐个测试密钥

密钥池每行操作列增加「测试」。Tavily 使用已有低频队列校验该 Key 并同步配额，页面显示等待及完成结果；Exa 使用所选 Key 发起一次 Lite 搜索（1 个结果，按当前官方价格约 $0.004），测试费用进入账本。测试不切换到其他 Key，不自动重试 Exa 请求；重复点击合并，错误原因及测试记录可查看。测试通过不会自动启用失效或手动停用的密钥。

## v4.1.1：密钥批量删除

在密钥池勾选当前页的密钥，点击「批量删除」，确认渠道和数量后删除。Tavily、Exa 均支持；翻页或切换渠道会清除选择。整批删除在同一事务中完成，删除后自动刷新，末页清空时返回上一页。历史请求日志及 Exa 费用账本保留，关联的待同步任务一并取消。

## v4.1：额度看板、分页与 Exa 计费（2026-11-03）

- 恢复总览与统计页的 Tavily 当月已用量、总额度、剩余额度、可用额度及进度；可用额度只统计启用中的密钥，未知上限单独提示。Exa 美元费用独立展示。
- 删除装饰性小标题，统一中文分页。密钥按渠道、状态和关键词在服务端筛选后分页；日志与统计列表可切换页码和每页条数，翻页清除当前选择。
- 数据库新增独立费用账本，日志清理或删除密钥不清空历史费用。升级前产生的 Exa 请求不倒推计价。

### Exa 费用与恢复规则

按 [Exa 官方价格](https://exa.ai/docs/admin/pricing) 和官方 MCP 实际请求构造计算：搜索按类型、结果数量及摘要选项估算，抓取按请求 URL 数量估算。响应包含 `costDollars` 时优先记录该值；未包含时明确标为估算，实际返回数量、企业折扣等可能造成差异。研究任务按任务 ID 记账，轮询只更新原费用；动态计费缺少权威金额时显示“待确认”，不把费用上限当实际消费。费用在结果审查前记账。

在 Exa 密钥的「费用」中可选配同团队的 **Service Key + publicId**，接入官方 [Key 用量接口](https://exa.ai/docs/reference/team-management/get-api-key-usage) 与 [Key 预算状态](https://exa.ai/docs/reference/team-management/get-api-key)。需要开通 Team Management，普通搜索 Key 不能使用。配置后每 6 小时同步，也可手动同步。月用量包含该 Key 的其他客户端调用，与本地账本分开展示，不重复相加；月用量查询区间不等于团队预算账期。Service Key 加密落库，接口中的历史明文凭据字段不会保存或返回。

依据 [Exa 错误定义](https://exa.ai/docs/admin/error-codes)，HTTP 错误和 MCP/HTTP 200 错误内容都会分类：无余额、Key/团队预算超限暂停；无效 Key 或被封团队停止自动轮询；限流按 Retry-After 冷却；功能权限和内容策略错误不会封禁 Key；URL 抓取失败不会当成整个账号故障。未知错误保守处理。可能已创建的研究任务不会因超时重放；仅明确未处理的 SERVICE_OVERLOADED 可以安全重试。

Exa 恢复规则可选自动、每月指定日期（UTC）、手动。自动模式只对 `NO_MORE_CREDITS` 在下月初恢复一次轮询资格，适用于领取月度免费额度的首个团队；不是每个 Key 都有独立免费余额，非此类账户可选手动。Key/团队预算超限默认不猜测账期；可配置日期，或通过官方接口确认 Key 预算恢复。账户余额按 [官方团队账单规则](https://exa.ai/docs/admin/billing-and-rate-limits) 共享，本地不伪造余额。失效与手动停用状态不会被月度任务恢复。

Tavily 按 [官方月重置规则](https://help.tavily.com/articles/6846808029-understanding-api-credits-reset) 恢复额度暂停 Key，`432/433` 按额度耗尽处理，`401` 按失效处理；用量同步确认已用尽时也暂停。额度恢复只改变额度暂停状态，不启用失效或手动停用的密钥。

## v4.0：多渠道搜索网关

当前源码已扩展为 Tavily + Exa 网关。原有数据库会自动增加渠道字段，旧 Key 和历史日志均归属 Tavily；原地址继续有效。请使用 `docker compose up -d --build` 构建此版本，远程 `latest` 镜像不代表本地修改已经发布。

| 渠道 | SSE | Streamable HTTP |
| --- | --- | --- |
| Tavily（兼容原地址） | `/sse` | `/mcp` |
| Tavily | `/tavily/sse` | `/tavily/mcp` |
| Exa | `/exa/sse` | `/exa/mcp` |

SSE 的消息地址由服务自动返回，分别为 `/message`、`/tavily/message`、`/exa/message`。HTTP 为无状态 MCP；GET/DELETE 返回 405。stdio 使用 `MCP_PROVIDER=exa npm start` 选择 Exa，默认 Tavily。

### 官方更新核对

核对来源：[Tavily 官方源码](https://github.com/tavily-ai/tavily-mcp)、[Tavily MCP 文档](https://docs.tavily.com/documentation/mcp)、[Exa 官方源码](https://github.com/exa-labs/exa-mcp-server)、[Exa MCP 文档](https://exa.ai/docs/get-started/exa-mcp)。工具定义快照保存在 `src/providers/*-tools.json`。

- Tavily：现有四个工具以外，新增 `tavily_research` 和 `tavily_feedback`；保留连字符旧名称与 `search` 调用别名。补入 `exact_match`、发布日期过滤、研究附件等官方字段，并保留 `include_answer`、`auto_parameters`、`chunks_per_source` 等 REST 扩展。托管 MCP 当次返回 5 个工具，开源版本额外提供 feedback；feedback 直接调用官方 REST。
- Exa：12 个官方工具完整透传，包括 `web_search_exa`、`web_fetch_exa`、`web_search_advanced_exa`、`agent_run`，以及 8 个兼容工具。托管版 `web_search_exa` 当前要求 `objective`。使用官方托管 MCP 执行，无需手工重写工具字段或研究流程；快照会随上游变更需要重新核对。
- 两个渠道各有独立的加权轮询密钥池；限流暂时冷却，鉴权/额度错误切换 Key。研究任务 ID 与创建它的 Key 持久绑定；非幂等研究任务遇到网络故障不自动重放，避免重复收费。若超时发生在收到任务 ID 之前，无法自动恢复该任务。
- Exa 使用独立的费用账本与可选的官方用量同步，不使用 Tavily 的额度接口。多 Key 分配、计费和故障切换通过本地模拟测试验证；本轮计费升级没有追加真实搜索调用。

### 决策模型审查

在「系统设置」填写 Base URL、API Key、模型 ID（默认 `decision-model-preview`）。接口使用百炼官方 [System One 协议](https://help.aliyun.com/zh/model-studio/decision-model-api)，不是 chat completions。API Key 使用数据库已有 AES-GCM 加密，页面不回传明文；留空保留旧密钥。可先用「测试连接」发送一条普通文本。

同时打开总开关和对应渠道开关后，每次输出在下发前进行审查：

1. 将搜索条目、摘要、图片描述、结构化输出和普通文本分组，每批最多 16 个问题；长条目带重叠完整分片，不会只检查前缀。
2. 使用 `noul` 概率判断风险；超过阈值时删除对应条目，不在返回值中复述被删除内容。
3. 上游明确返回内容审查拒绝时，二分批次定位异常条目。鉴权错误、限流、网络错误、格式异常不视为内容证据，直接返回审查不可用错误。
4. 总时限、并发和调用次数均有上限。超过预算时不转发未审查内容；非文本 MCP 图片/音频/资源块无法由文本决策模型审查，启用时会被移除。
5. 文字与 `structuredContent` 都会处理，防止另一个表示泄漏原内容。结构化结果中的任意嵌套文本会审查，必要时整块移除；剔除可能导致返回对象不再满足上游声明的输出 schema，因此网关不宣告上游 outputSchema（审查开关可随时改变），输入 schema 保持完整。

默认总开关关闭；Tavily/Exa 可分别启用。审查会增加延迟和 token 费用。模型可能误判或漏判，不能承诺「完全无毒」或绕过所有下游拒答。日志中的 `moderation` 只记录数量、调用次数和耗时，不记录被筛除正文；响应 `_meta.gateway_review` 提供本次审查摘要。

### 稳定性与运维改进

本次升级前检查了现网保留的 14,778 条日志和 50 个 Tavily Key（40 个 active、10 个 banned）。错误记录主要来自配额同步：1,220 条，占全部 1,440 条错误的约 85%；搜索失败 214 条、提取失败 6 条。数据库约 646 MB，旧版长响应正文占用了大量空间。这些数据反映当前保留期内的记录，不能当作全生命周期统计，也不代表搜索结果质量。

- 更新 MCP SDK，修复 SSE 重复转义、未知会话仍执行计费请求、跨渠道会话串用、通知响应不规范和空闲连接被定时关闭。
- 加入参数验证、全局有界并发/排队与请求总时限；保留 false、0 和空数组，修复原先白名单静默丢字段。
- 修正 `rate limit exceeded` 被误识别为额度耗尽、失效 Key 不故障切换、未知额度在同月被错误恢复等问题；后台配额同步跳过已禁用或鉴权失效的 Key，仍可手动同步全部。
- 工具成功率和延迟排除配额同步及审查；请求日志列表不再加载响应大字段。新请求默认不保存正文，可在设置中打开脱敏、限长记录。历史日志按原保留规则清理，不主动清空历史数据；SQLite 已分配空间不会因此立刻缩小。
- 后台采用响应式中文界面；渠道地址可复制、工具定义可展开、Key 可筛选和批量管理、权重可编辑；连接状态来源于真实 WebSocket。

### 验证与回滚

```bash
npm ci
npm run build
npm test -- --runInBand
npm run test:integration  # 本地模拟，覆盖两个传输和三个地址前缀；不消耗上游额度
cd web && npm ci && npm test && npm run build
```

升级前用 SQLite backup API（或 `.backup`）备份 `data/tavily.db`，保留原加密密钥和旧容器镜像。运行中的 WAL 数据库不能只拷贝 `.db` 文件。迁移是增加列/表；回滚时停止服务、恢复备份并用旧镜像启动。不要在服务运行时执行 VACUUM 或覆盖数据库。

<details>
<summary>更新日志</summary>

### v3.1.0 (2026-07-24)
- **低频配额队列**：所有 `/usage` 请求统一排队、去重并遵守 Tavily 独立限流
- **双同步入口**：支持同步过期 Key 和后台同步全部 Key
- **异步 Key 测试**：勾选测试进入高优先级队列，成功后同时更新额度
- **额度显示修复**：免费账户正确同步 1000 上限，未知额度不再显示为无限

### v3.0.0 (2025-01-06)
- **官方 MCP 对齐**：完整适配 tavily-mcp v0.2.12 工具参数与行为
- **智能错误处理**：精细区分配额耗尽、速率限制与网络问题
- **持久化存储**：SQLite 存储 API Key、配额与请求日志
- **Web 管理后台**：可视化管理 Key、统计、日志与设置
- **自动配额刷新**：UTC 自然月自动更新配额状态

### v2.2.0 (2025-08-15)
- 多架构镜像：linux/amd64 与 linux/arm64

### v2.1.0 (2025-08-14)
- streamableHTTP 支持：HTTP POST /mcp 端点
- 多协议兼容：SSE + streamableHTTP

### v2.0.0 (2025-08-12)
- 架构重构：原生 SSE 实现
- 工具更新：新增 tavily-crawl 和 tavily-map
- 安全改进：响应数据清理和字符编码处理

### v1.0.0 (2025-08-05)
- 初始版本：多 API 密钥负载均衡

</details>

## 功能特性

- **智能负载均衡** — 轮询 + 权重调度，多 Key 高可用
- **错误分级处理** — 速率限制 / 配额耗尽 / 鉴权错误精确识别
- **多协议支持** — MCP stdio / SSE / streamableHTTP 全覆盖
- **数据持久化** — SQLite 存储 Key、配额与日志
- **Web 管理后台** — Dashboard、Key 管理、统计、日志、设置
- **实时更新** — WebSocket 推送统计刷新
- **数据安全** — Key 加密存储 + 脱敏展示

---

## 快速开始

### Docker 部署（推荐）

```bash
docker run -d \
  --name tavily-mcp-lb \
  -p 60002:60002 \
  -e DATABASE_ENCRYPTION_KEY="your-32-byte-random-key" \
  -e ADMIN_PASSWORD="optional-admin-password" \
  -e TAVILY_API_KEYS="your-key1,your-key2,your-key3" \
  yatotm1994/tavily-mcp-loadbalancer:latest
```

> 镜像支持 amd64 / arm64，Docker 会自动匹配本机架构。

### 本地开发

```bash
# 1. 克隆并安装
git clone https://github.com/yatotm/tavily-mcp-loadbalancer.git
cd tavily-mcp-loadbalancer
npm install

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，设置 DATABASE_ENCRYPTION_KEY（必填）与 ADMIN_PASSWORD（可选）

# 3. 启动服务
npm run build-and-start
```

**服务启动后访问：**

| 端点 | 地址 |
|------|------|
| 管理后台 | `http://localhost:60002` |
| SSE 接口 | `http://localhost:60002/sse` |
| streamableHTTP | `http://localhost:60002/mcp` |
| API | `http://localhost:60002/api` |
| WebSocket | `ws://localhost:60002/ws` |

> 首次启动后在管理后台添加 API Key。环境变量 `TAVILY_API_KEYS` 仅用于初始导入。

<details>
<summary>更多部署方式</summary>

#### Docker Compose

```bash
git clone https://github.com/yatotm/tavily-mcp-loadbalancer.git
cd tavily-mcp-loadbalancer
cp .env.example .env
docker-compose up -d
docker-compose logs -f
```

#### 自定义构建

```bash
docker build -t tavily-mcp-loadbalancer .
docker run -d --name tavily-mcp-lb -p 60002:60002 \
  -e TAVILY_API_KEYS="key1,key2" tavily-mcp-loadbalancer
```

#### 开发模式

```bash
npm run start-gateway   # HTTP + UI
npm run dev             # MCP stdio
./start.sh              # 脚本启动
```

</details>

---

## 可用工具

| 工具名称 | 功能描述 | 主要参数 |
|---------|---------|---------|
| `search` / `tavily-search` | 网络搜索 | query, max_results, search_depth |
| `tavily-extract` | 网页内容提取 | urls, extract_depth, format |
| `tavily-crawl` | 网站爬虫 | url, max_depth, limit |
| `tavily-map` | 网站地图生成 | url, max_depth, max_breadth |

<details>
<summary>详细工具文档</summary>

### 接口说明

| 接口 | 地址 |
|------|------|
| SSE | `http://localhost:60002/sse` |
| 消息 | `http://localhost:60002/message` |
| streamableHTTP | `http://localhost:60002/mcp` |
| 健康检查 | `http://localhost:60002/health` |

#### streamableHTTP 示例

```bash
# 初始化
curl -X POST http://localhost:60002/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {"name": "test-client", "version": "1.0.0"}
    }
  }'

# 获取工具列表
curl -X POST http://localhost:60002/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "id": 2, "method": "tools/list"}'

# 调用搜索
curl -X POST http://localhost:60002/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "search",
      "arguments": {"query": "OpenAI GPT-4", "max_results": 3}
    }
  }'
```

### 工具参数

**search / tavily-search**
```json
{
  "query": "OpenAI GPT-4",
  "search_depth": "basic",
  "topic": "general",
  "max_results": 10,
  "country": "united states"
}
```

**tavily-extract**
```json
{
  "urls": ["https://example.com/article"],
  "extract_depth": "basic",
  "format": "markdown"
}
```

**tavily-crawl**
```json
{
  "url": "https://example.com",
  "max_depth": 2,
  "limit": 50,
  "extract_depth": "basic"
}
```

**tavily-map**
```json
{
  "url": "https://example.com",
  "max_depth": 1,
  "limit": 50
}
```

</details>

---

## 配置

### 环境变量

| 变量名 | 描述 | 默认值 |
|--------|------|--------|
| `PORT` | 服务端口 | 60002 |
| `HOST` | 绑定地址 | 0.0.0.0 |
| `DATABASE_PATH` | 数据库路径 | ./data/tavily.db |
| `DATABASE_ENCRYPTION_KEY` | 加密密钥（必填） | - |
| `ADMIN_PASSWORD` | 管理后台密码 | - |
| `ENABLE_WEB_UI` | 启用 Web UI | true |
| `MAX_CONCURRENT_REQUESTS` | 最大并发 | 4 |
| `REQUEST_TIMEOUT` | 请求超时（ms） | 30000 |
| `MAX_KEY_ERRORS` | Key 最大错误次数 | 5 |
| `USAGE_SYNC_MIN_INTERVAL_MS` | `/usage` 队列请求最小间隔（ms） | 75000 |
| `USAGE_SYNC_RETRY_DELAY_MS` | 上游未返回 `retry-after` 时的全局冷却（ms） | 600000 |
| `USAGE_SYNC_STALE_AFTER_MS` | 配额数据过期时间（ms） | 21600000 |
| `USAGE_SYNC_SCHEDULE_INTERVAL_MS` | 自动扫描过期 Key 的间隔（ms） | 21600000 |
| `LOG_RETENTION_DAYS` | 日志保留天数 | 30 |
| `LOG_LEVEL` | 日志级别 | info |
| `TAVILY_API_KEYS` | 初始 Key（逗号分隔） | - |

### 配置示例

```bash
# .env
PORT=60002
DATABASE_ENCRYPTION_KEY=your-32-byte-random-key
ADMIN_PASSWORD=optional-password
TAVILY_API_KEYS=tvly-key1,tvly-key2
```

---

## 故障排除

| 问题 | 解决方案 |
|------|---------|
| 无可用 API 密钥 | 在管理后台检查 Key 状态和配额 |
| 连接超时 | 检查网络和防火墙设置 |
| 端口被占用 | `lsof -i :60002` 检查端口占用 |

```bash
# 健康检查
curl http://localhost:60002/health

# 查看日志
docker logs tavily-mcp-lb
```

> 建议在 Web 管理后台查看请求统计、错误日志与 Key 状态。

---

## 许可证

MIT License

---

如果这个项目对你有帮助，欢迎 Star ⭐
