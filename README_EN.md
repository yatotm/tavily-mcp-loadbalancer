# Tavily MCP Load Balancer

[![Docker Hub](https://img.shields.io/docker/pulls/yatotm1994/tavily-mcp-loadbalancer?style=flat-square)](https://hub.docker.com/r/yatotm1994/tavily-mcp-loadbalancer)
[![Docker Image Size](https://img.shields.io/docker/image-size/yatotm1994/tavily-mcp-loadbalancer?style=flat-square)](https://hub.docker.com/r/yatotm1994/tavily-mcp-loadbalancer)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Language / 语言**: [English](./README_EN.md) | [中文](./README.md)

A Tavily MCP server with multi-API key load balancing support, providing both SSE and streamableHTTP interfaces for automatic API key rotation, high availability, and increased request limits.

<details>
<summary>📋 Changelog</summary>


### v3.0.0 (2025-12-30)
- 🧩 **Official MCP parity**: Fully aligned with tavily-mcp v0.2.12 tool schemas & behavior
- 🧠 **Smart error handling**: Differentiates quota exhaustion, rate limits, and network errors
- 🗄️ **Persistent storage**: SQLite for keys, quotas, and request logs
- 🖥️ **Web Admin UI**: Dashboard, key management, stats, logs, settings
- 🔁 **Auto quota refresh**: Monthly UTC quota reset handling

### v2.2.0 (2025-08-15)
- 🧬 Multi-arch images: released linux/amd64 and linux/arm64; `latest` now points to `2.2.0`

### v2.1.0 (2025-08-14)
- 🌐 **streamableHTTP Support**: Added HTTP POST /mcp endpoint for direct MCP request-response mode
- 🔄 **Multi-Protocol Compatibility**: Simultaneous support for SSE and streamableHTTP to meet different client needs
- 📝 **Documentation Updates**: Added streamableHTTP interface usage instructions and examples

### v2.0.0 (2025-08-12)
- 🔄 **Architecture Refactor**: Migrated from supergateway dependency to native SSE implementation
- 🛠️ **Tool Updates**: Synced with latest Tavily MCP toolset, added tavily-crawl and tavily-map
- 📊 **Enhanced Monitoring**: Added detailed API key usage logs and rotation status
- 🔒 **Security Improvements**: Enhanced response data cleaning and character encoding handling
- 📝 **Documentation Rewrite**: Complete README rewrite with optimized project structure

### v1.0.0 (2025-08-05)
- 🚀 **Initial Release**: Supergateway-based Tavily MCP load balancer
- 🔄 **Load Balancing**: Implemented multi-API key rotation mechanism
- 🛡️ **Failover**: Automatic disabled key detection and failover

</details>

## ✨ Features

- 🔄 **Smart Load Balancing**: Weighted rotation for high availability
- 🧠 **Error Classification**: Precise handling for rate-limit vs quota exhaustion
- 🌐 **Multi-Protocol Support**: MCP stdio + SSE + streamableHTTP
- 🗄️ **Persistent Storage**: SQLite-backed keys, quotas, logs
- 🖥️ **Web Admin UI**: Visual management for keys, stats, logs, settings
- 📊 **Real-time Updates**: WebSocket push for stats refresh
- 🔒 **Data Security**: Encrypted key storage with masked display

## 🚀 Quick Start

### Docker Deployment (Recommended)

```bash
# Quick start with Docker Hub image (auto-selects native platform: amd64/arm64)
docker run -d \
  --name tavily-mcp-lb \
  -p 60002:60002 \
  -e DATABASE_ENCRYPTION_KEY="your-32-byte-random-key" \
  -e ADMIN_PASSWORD="optional-admin-password" \
  -e TAVILY_API_KEYS="your-key1,your-key2,your-key3" \
  yatotm1994/tavily-mcp-loadbalancer:latest
```

### Local Development

```bash
# 1. Clone and install
git clone https://github.com/yatotm/tavily-mcp-loadbalancer.git
cd tavily-mcp-loadbalancer
npm install

# 2. Configure environment variables
cp .env.example .env
# Edit .env: set DATABASE_ENCRYPTION_KEY (required), ADMIN_PASSWORD (optional)

# 3. Start service (HTTP + Admin UI)
npm run build-and-start
```

**After startup, access:**
- Admin UI: `http://localhost:60002`
- SSE: `http://localhost:60002/sse`
- streamableHTTP: `http://localhost:60002/mcp`
- API: `http://localhost:60002/api`
- WebSocket: `ws://localhost:60002/ws`

> After first launch, add/manage API keys in the Admin UI. `TAVILY_API_KEYS` is only used as an initial seed.

<details>
<summary>📦 More Deployment Options</summary>

#### Docker Compose Deployment

```bash
# 1. Clone project
git clone https://github.com/yatotm/tavily-mcp-loadbalancer.git
cd tavily-mcp-loadbalancer

# 2. Configure environment variables
cp .env.example .env
# Edit .env: set DATABASE_ENCRYPTION_KEY (required)

# 3. Start service
docker-compose up -d

# 4. View logs
docker-compose logs -f
```

#### Custom Docker Build

```bash
# Build image
docker build -t tavily-mcp-loadbalancer .

# Run container
docker run -d \
  --name tavily-mcp-lb \
  -p 60002:60002 \
  -e TAVILY_API_KEYS="your-key1,your-key2,your-key3" \
  tavily-mcp-loadbalancer
```

#### Development Mode

```bash
# Development mode (HTTP + UI)
npm run start-gateway

# MCP stdio mode (tools only)
npm run dev

# Using script
./start.sh
```

</details>

## 🛠️ Available Tools

This server provides 5 Tavily tools supporting search, content extraction, web crawling, and more:

| Tool Name | Description | Main Parameters |
|-----------|-------------|-----------------|
| `search` / `tavily-search` | Web search | query, max_results, search_depth |
| `tavily-extract` | Web content extraction | urls, extract_depth, format |
| `tavily-crawl` | Website crawler | url, max_depth, limit |
| `tavily-map` | Website sitemap generation | url, max_depth, max_breadth |

<details>
<summary>📖 Detailed Tool Documentation</summary>

### Interface Description

**SSE Interface**: `http://localhost:60002/sse`
**Message Interface**: `http://localhost:60002/message`
**streamableHTTP Interface**: `http://localhost:60002/mcp`
**Health Check**: `http://localhost:60002/health`

#### streamableHTTP Usage Examples

```bash
# Initialize connection
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

# Call search tool
curl -X POST http://localhost:60002/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "search",
      "arguments": {
        "query": "OpenAI GPT-4",
        "max_results": 3
      }
    }
  }'
```

### Tool Parameter Details

#### 1. search / tavily-search - Web Search
```json
{
  "name": "search",
  "arguments": {
    "query": "OpenAI GPT-4",
    "search_depth": "basic",
    "topic": "general",
    "max_results": 10,
    "start_date": "2024-01-01",
    "end_date": "2024-12-31",
    "country": "US",
    "include_favicon": false
  }
}
```

#### 2. tavily-extract - Web Content Extraction
```json
{
  "name": "tavily-extract",
  "arguments": {
    "urls": ["https://example.com/article"],
    "extract_depth": "basic",
    "format": "markdown",
    "include_favicon": false
  }
}
```

#### 3. tavily-crawl - Website Crawler
```json
{
  "name": "tavily-crawl",
  "arguments": {
    "url": "https://example.com",
    "max_depth": 2,
    "max_breadth": 20,
    "limit": 50,
    "instructions": "Focus on technical content",
    "select_paths": ["/docs", "/api"],
    "select_domains": ["example.com"],
    "allow_external": false,
    "categories": ["technology"],
    "extract_depth": "basic",
    "format": "markdown",
    "include_favicon": false
  }
}
```

#### 4. tavily-map - Website Sitemap Generation
```json
{
  "name": "tavily-map",
  "arguments": {
    "url": "https://example.com",
    "max_depth": 1,
    "max_breadth": 20,
    "limit": 50,
    "instructions": "Map the main structure",
    "select_paths": ["/"],
    "select_domains": ["example.com"],
    "allow_external": false,
    "categories": ["general"]
  }
}
```

### Direct MCP Usage

```bash
# Direct MCP protocol usage (stdio)
node dist/index.js
```

</details>

## 📊 Monitoring and Testing

### Quick Testing

```bash
# Test server status
./manage.sh stats

# Test all tools
./manage.sh test

# Batch test API keys
./manage.sh weather
```

<details>
<summary>🔧 Detailed Testing and Monitoring</summary>

### Management Scripts

```bash
# Test server connection status
./manage.sh stats

# Test all tool functionality
./manage.sh test

# Batch weather search test (test all API keys)
./manage.sh weather

# Show help information
./manage.sh help
```

### Node.js Test Scripts

```bash
# Test server connection
node check_stats_direct.cjs

# Run tool tests
node test_tools_direct.cjs

# Batch weather search test
node test_weather_search.cjs

# Test SSE connection and data security
node test_sse_validation.cjs
```

### Monitoring Output Examples

#### Server Status Check
```
✅ Connection successful
📊 Tavily MCP Load Balancer Status:
✅ Search function normal
Search result length: 2847 characters
```

#### API Key Rotation Logs
```
[INFO] Using API key: tvly-dev-T... (Key 1/10)
[INFO] API key tvly-dev-T... request successful
[INFO] Using API key: tvly-dev-Y... (Key 2/10)
[INFO] API key tvly-dev-Y... request successful
```

</details>

## ⚙️ Configuration

### Environment Variables

| Variable Name | Description | Default Value |
|---------------|-------------|---------------|
| `PORT` | Service port | 60002 |
| `HOST` | Bind host | 0.0.0.0 |
| `DATABASE_PATH` | SQLite database path | ./data/tavily.db |
| `DATABASE_ENCRYPTION_KEY` | DB encryption key (required) | - |
| `ADMIN_PASSWORD` | Admin UI password (optional) | - |
| `ENABLE_WEB_UI` | Enable Web UI | true |
| `MAX_CONCURRENT_REQUESTS` | Max concurrency | 4 |
| `REQUEST_TIMEOUT` | Request timeout (ms) | 30000 |
| `MAX_KEY_ERRORS` | Max errors before disabling | 5 |
| `LOG_RETENTION_DAYS` | Log retention days | 30 |
| `LOG_LEVEL` | Log level | info |
| `LOG_FORMAT` | Log format | json |
| `TAVILY_API_KEYS` | Seed API keys (comma-separated) | Optional |
| `TAVILY_API_KEY` | Single seed API key | Optional |

### Configuration Example

```bash
# .env file
PORT=60002
DATABASE_ENCRYPTION_KEY=your-32-byte-random-key
ADMIN_PASSWORD=optional-password
TAVILY_API_KEYS=tvly-dev-key1,tvly-dev-key2
```

<details>
<summary>🔧 Advanced Configuration</summary>

### Docker Environment Variables

```bash
# Docker runtime settings
docker run -e "DATABASE_ENCRYPTION_KEY=your-key" \
           -e "PORT=60002" \
           -e "TAVILY_API_KEYS=key1,key2,key3" \
           yatotm1994/tavily-mcp-loadbalancer:latest
```

### Development Environment Configuration

```bash
# Development environment variables
export DATABASE_ENCRYPTION_KEY="your-key"
export TAVILY_API_KEYS="tvly-dev-key1,tvly-dev-key2"
export PORT=60002

# Or use .env file
cp .env.example .env
# Edit .env file
```

### SSE Connection Testing

Verify SSE connection and data security:

```bash
# Run SSE connection test
node test_sse_validation.cjs
```

Test content:
- ✅ SSE connection establishment and session management
- ✅ JSON-RPC message sending and receiving
- ✅ Response data security validation
- ✅ Control character and special character handling
- ✅ Large data response processing
- ✅ Error handling and logging

</details>

## 🔧 Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| No available API keys | Check `TAVILY_API_KEYS` environment variable |
| Connection timeout | Check network and firewall settings |
| Port occupied | Use `lsof -i :60002` to check port |
| SSE connection failed | Run `node test_sse_validation.cjs` |

### Quick Diagnosis

```bash
# Check service status
curl http://localhost:60002/health

# Test connection
node check_stats_direct.cjs

# View logs
docker logs tavily-mcp-lb
```

<details>
<summary>🔍 Detailed Troubleshooting</summary>

### Local Runtime Issues

1. **No available API keys**
   - Check environment variables: `echo $TAVILY_API_KEYS`
   - Ensure key format is correct (should start with `tvly-`)
   - Use `node check_stats_direct.cjs` to test connection

2. **API key errors or disabled**
   - Check error information in server logs
   - Use `./manage.sh weather` to batch test all keys
   - Check if key quota is exhausted

3. **Connection timeout or network issues**
   - Check network connection and firewall settings
   - Confirm Tavily API service is normal
   - Try reducing concurrent request count

4. **SSE connection issues**
   - Use `node test_sse_validation.cjs` to test SSE connection
   - Check if port 60002 is occupied: `lsof -i :60002`
   - Confirm server has started normally

### Docker Related Issues

| Issue | Solution |
|-------|----------|
| Build failed | `docker system prune -f` to clean cache |
| Container startup failed | `docker logs tavily-mcp-lb` to view logs |
| Environment variables invalid | Check `.env` file format |
| Health check failed | `curl http://localhost:60002/health` |

### Docker Debug Commands

```bash
# View container logs
docker logs -f tavily-mcp-lb

# Enter container for debugging
docker exec -it tavily-mcp-lb sh

# Check environment variables
docker exec tavily-mcp-lb env | grep TAVILY
```

</details>

## 📄 License

MIT License

---

**⭐ If this project helps you, please give it a Star!**
