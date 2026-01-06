# Tavily MCP Load Balancer

[![Docker Hub](https://img.shields.io/docker/pulls/yatotm1994/tavily-mcp-loadbalancer?style=flat-square)](https://hub.docker.com/r/yatotm1994/tavily-mcp-loadbalancer)
[![Docker Image Size](https://img.shields.io/docker/image-size/yatotm1994/tavily-mcp-loadbalancer?style=flat-square)](https://hub.docker.com/r/yatotm1994/tavily-mcp-loadbalancer)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Language / 语言**: [English](./README_EN.md) | [中文](./README.md)

A Tavily MCP server with multi-API key load balancing, providing SSE and streamableHTTP interfaces with automatic key rotation for high availability.

<details>
<summary>Changelog</summary>

### v3.0.0 (2025-01-06)
- **Official MCP Parity**: Fully aligned with tavily-mcp v0.2.12 tool schemas
- **Smart Error Handling**: Differentiates quota exhaustion, rate limits, and network errors
- **Persistent Storage**: SQLite for keys, quotas, and request logs
- **Web Admin UI**: Visual management for keys, stats, logs, settings
- **Auto Quota Refresh**: Monthly UTC quota reset handling

### v2.2.0 (2025-08-15)
- Multi-arch images: linux/amd64 and linux/arm64

### v2.1.0 (2025-08-14)
- streamableHTTP support: HTTP POST /mcp endpoint
- Multi-protocol compatibility: SSE + streamableHTTP

### v2.0.0 (2025-08-12)
- Architecture refactor: Native SSE implementation
- Tool updates: Added tavily-crawl and tavily-map
- Security improvements: Response data cleaning and encoding handling

### v1.0.0 (2025-08-05)
- Initial release: Multi-API key load balancing

</details>

## Features

- **Smart Load Balancing** — Weighted rotation for multi-key high availability
- **Error Classification** — Precise handling for rate limits, quota exhaustion, and auth errors
- **Multi-Protocol Support** — MCP stdio / SSE / streamableHTTP
- **Persistent Storage** — SQLite-backed keys, quotas, and logs
- **Web Admin UI** — Dashboard, key management, stats, logs, settings
- **Real-time Updates** — WebSocket push for stats refresh
- **Data Security** — Encrypted key storage with masked display

---

## Quick Start

### Docker Deployment (Recommended)

```bash
docker run -d \
  --name tavily-mcp-lb \
  -p 60002:60002 \
  -e DATABASE_ENCRYPTION_KEY="your-32-byte-random-key" \
  -e ADMIN_PASSWORD="optional-admin-password" \
  -e TAVILY_API_KEYS="your-key1,your-key2,your-key3" \
  yatotm1994/tavily-mcp-loadbalancer:latest
```

> Supports amd64 / arm64. Docker automatically selects the appropriate architecture.

### Local Development

```bash
# 1. Clone and install
git clone https://github.com/yatotm/tavily-mcp-loadbalancer.git
cd tavily-mcp-loadbalancer
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env: set DATABASE_ENCRYPTION_KEY (required) and ADMIN_PASSWORD (optional)

# 3. Start service
npm run build-and-start
```

**After startup, access:**

| Endpoint | URL |
|----------|-----|
| Admin UI | `http://localhost:60002` |
| SSE | `http://localhost:60002/sse` |
| streamableHTTP | `http://localhost:60002/mcp` |
| API | `http://localhost:60002/api` |
| WebSocket | `ws://localhost:60002/ws` |

> After first launch, add API keys in the Admin UI. `TAVILY_API_KEYS` is only used for initial seeding.

<details>
<summary>More Deployment Options</summary>

#### Docker Compose

```bash
git clone https://github.com/yatotm/tavily-mcp-loadbalancer.git
cd tavily-mcp-loadbalancer
cp .env.example .env
docker-compose up -d
docker-compose logs -f
```

#### Custom Build

```bash
docker build -t tavily-mcp-loadbalancer .
docker run -d --name tavily-mcp-lb -p 60002:60002 \
  -e TAVILY_API_KEYS="key1,key2" tavily-mcp-loadbalancer
```

#### Development Mode

```bash
npm run start-gateway   # HTTP + UI
npm run dev             # MCP stdio
./start.sh              # Script startup
```

</details>

---

## Available Tools

| Tool Name | Description | Main Parameters |
|-----------|-------------|-----------------|
| `search` / `tavily-search` | Web search | query, max_results, search_depth |
| `tavily-extract` | Web content extraction | urls, extract_depth, format |
| `tavily-crawl` | Website crawler | url, max_depth, limit |
| `tavily-map` | Website sitemap generation | url, max_depth, max_breadth |

<details>
<summary>Detailed Tool Documentation</summary>

### Endpoints

| Interface | URL |
|-----------|-----|
| SSE | `http://localhost:60002/sse` |
| Message | `http://localhost:60002/message` |
| streamableHTTP | `http://localhost:60002/mcp` |
| Health Check | `http://localhost:60002/health` |

#### streamableHTTP Examples

```bash
# Initialize
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

# Get tool list
curl -X POST http://localhost:60002/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "id": 2, "method": "tools/list"}'

# Call search
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

### Tool Parameters

**search / tavily-search**
```json
{
  "query": "OpenAI GPT-4",
  "search_depth": "basic",
  "topic": "general",
  "max_results": 10,
  "country": "US"
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

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Service port | 60002 |
| `HOST` | Bind host | 0.0.0.0 |
| `DATABASE_PATH` | Database path | ./data/tavily.db |
| `DATABASE_ENCRYPTION_KEY` | Encryption key (required) | - |
| `ADMIN_PASSWORD` | Admin UI password | - |
| `ENABLE_WEB_UI` | Enable Web UI | true |
| `MAX_CONCURRENT_REQUESTS` | Max concurrency | 4 |
| `REQUEST_TIMEOUT` | Request timeout (ms) | 30000 |
| `MAX_KEY_ERRORS` | Max errors before disabling | 5 |
| `LOG_RETENTION_DAYS` | Log retention days | 30 |
| `LOG_LEVEL` | Log level | info |
| `TAVILY_API_KEYS` | Seed keys (comma-separated) | - |

### Configuration Example

```bash
# .env
PORT=60002
DATABASE_ENCRYPTION_KEY=your-32-byte-random-key
ADMIN_PASSWORD=optional-password
TAVILY_API_KEYS=tvly-key1,tvly-key2
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| No available API keys | Check key status and quota in Admin UI |
| Connection timeout | Check network and firewall settings |
| Port occupied | `lsof -i :60002` to check port usage |

```bash
# Health check
curl http://localhost:60002/health

# View logs
docker logs tavily-mcp-lb
```

> Use the Web Admin UI to view request stats, error logs, and key status.

---

## License

MIT License

---

If this project helps you, please give it a Star ⭐
