# Tavily MCP Load Balancer

[![Docker Hub](https://img.shields.io/docker/pulls/yatotm1994/tavily-mcp-loadbalancer?style=flat-square)](https://hub.docker.com/r/yatotm1994/tavily-mcp-loadbalancer)
[![Docker Image Size](https://img.shields.io/docker/image-size/yatotm1994/tavily-mcp-loadbalancer?style=flat-square)](https://hub.docker.com/r/yatotm1994/tavily-mcp-loadbalancer)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Language / 语言**: [English](./README_EN.md) | [中文](./README.md)

一个支持多 API 密钥负载均衡的 Tavily MCP 服务器，提供 SSE 和 streamableHTTP 接口，自动轮询多个 API 密钥以实现高可用性。

<details>
<summary>更新日志</summary>

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
