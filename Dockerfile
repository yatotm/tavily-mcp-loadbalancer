# 使用官方Node.js LTS版本作为基础镜像
FROM node:20-alpine AS builder

# 设置工作目录
WORKDIR /app

# 复制package文件
COPY package*.json ./

# 安装构建依赖（better-sqlite3 需要编译）
RUN apk add --no-cache --virtual .build-deps python3 make g++

# 安装所有依赖（包括开发依赖用于构建）
RUN npm ci

# 复制源代码
COPY . .

# 构建TypeScript后端
RUN npm run build

# 构建前端 Vue 项目
WORKDIR /app/web
RUN npm ci && npm run build

# 回到主目录并裁剪为生产依赖
WORKDIR /app
RUN npm prune --omit=dev && npm cache clean --force && apk del .build-deps

# 运行时镜像
FROM node:20-alpine AS runtime

# 设置工作目录
WORKDIR /app

# 创建非root用户
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs

# 仅复制运行时所需内容
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/web/public ./web/public

# 切换用户
USER nodejs

# 暴露端口（从README看默认是60002）
EXPOSE 60002

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const http = require('http'); const options = { host: 'localhost', port: process.env.PORT || 60002, path: '/health', timeout: 2000 }; const req = http.request(options, (res) => { process.exit(res.statusCode === 200 ? 0 : 1); }); req.on('error', () => process.exit(1)); req.end();"

# 启动命令
CMD ["node", "dist/start.js"]
