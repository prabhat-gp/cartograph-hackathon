# Cartograph: the map desk, landing page, MCP server and POST /run.
#   docker build -t cartograph .
#   docker run -p 8787:8787 -e SAMPLE_MODE=true cartograph     # no keys needed
#   docker run -p 8787:8787 --env-file .env cartograph          # live agents
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY site/package.json site/package-lock.json site/
RUN npm ci --no-audit --no-fund && npm --prefix site ci --no-audit --no-fund
COPY . .
RUN npm run build
ENV PORT=8787 CARTOGRAPH_DATA_DIR=/data
EXPOSE 8787
CMD ["npx", "tsx", "src/server/index.ts"]
