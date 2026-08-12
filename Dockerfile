# Railway-ready. The Playwright base image ships Chromium + all system deps,
# so the headless scanner works in production (a plain Node buildpack will not).
FROM mcr.microsoft.com/playwright:v1.61.0-jammy

WORKDIR /app

# Install deps first for layer caching
COPY package*.json ./
RUN npm ci

# App source + build
COPY . .
RUN npm run build

ENV NODE_ENV=production
# Railway provides $PORT at runtime; Next's `start` honors it.
EXPOSE 3000
CMD npm run start -- -p ${PORT:-3000}
