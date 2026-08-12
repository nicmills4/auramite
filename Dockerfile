# Railway-ready. The Playwright base image ships Chromium + all system deps,
# so the headless scanner works in production (a plain Node buildpack will not).
FROM mcr.microsoft.com/playwright:v1.61.0-jammy

WORKDIR /app

# Install deps first for layer caching. The schema is copied before `npm ci`
# because the postinstall hook runs `prisma generate` and needs it present.
COPY package*.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci

# App source + build
COPY . .
RUN npm run build

ENV NODE_ENV=production
# Railway provides $PORT at runtime; Next's `start` honors it.
EXPOSE 3000
# Apply any pending migrations before serving, so a deploy can never bring up an
# app whose code expects columns the database does not have yet.
CMD npx prisma migrate deploy && npm run start -- -p ${PORT:-3000}
