FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS migration
WORKDIR /app
ENV NODE_ENV=development
COPY package*.json ./
RUN npm ci
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/seed.ts ./seed.ts
COPY --from=builder /app/src ./src
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
CMD ["sh", "-c", "npm run db:migrate && npm run seed"]

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/index.js"]