# Build context: repository root (npm workspaces share one lockfile).
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN npm ci -w apps/api --include=dev --ignore-scripts && npm rebuild onnxruntime-node esbuild
COPY apps/api apps/api
WORKDIR /app/apps/api
EXPOSE 4000
# tsx runs the TypeScript directly; migrations run on boot.
CMD ["npx", "tsx", "src/server.ts"]
