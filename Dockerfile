# syntax=docker/dockerfile:1

# ---- 1) bog'liqliklarni o'rnatish va test bosqichi ----
FROM node:22-alpine AS test
WORKDIR /app
ENV NODE_ENV=test
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY src ./src
COPY public ./public
COPY scripts ./scripts
COPY tests ./tests
COPY Dockerfile docker-compose.yml .dockerignore .gitignore .env.example ./
RUN npm test && npm prune --omit=dev

# ---- 2) ishchi image: faqat production bog'liqliklar va kerakli fayllar ----
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
  PORT=3000 \
  DB_PATH=/app/data/app.db
COPY --from=test /app/package.json ./
COPY --from=test /app/node_modules ./node_modules
COPY --from=test /app/src ./src
COPY --from=test /app/public ./public
COPY --from=test /app/scripts ./scripts
# DB papkasi non-root foydalanuvchiga tegishli bo'lishi shart (named volume shu huquqni meros qiladi)
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
VOLUME ["/app/data"]
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD ["node", "scripts/healthcheck.js"]
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
