#!/bin/bash

# 启动Tavily MCP负载均衡服务器的脚本

# 检查环境变量
if [ -z "$DATABASE_ENCRYPTION_KEY" ]; then
    echo "错误: 请设置 DATABASE_ENCRYPTION_KEY 环境变量"
    echo "示例: export DATABASE_ENCRYPTION_KEY=$(openssl rand -hex 32)"
    exit 1
fi

# 默认配置
PORT=${PORT:-60002}

echo "正在启动 Tavily MCP 负载均衡服务器..."
echo "端口: $PORT"

# 构建项目（如果需要）
if [ ! -d "dist" ]; then
    echo "构建项目..."
    npm run build
fi

# 启动SSE服务器
exec node dist/start.js
