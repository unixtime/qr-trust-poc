FROM node:22-alpine AS build

WORKDIR /app/network

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app/network

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/network/dist ./dist

# Drop root before the worker starts. Everything above runs as root because the
# install and the copy need to write into /app/network; the worker itself only
# reads them, so it has no reason to keep the privilege. `node` (uid 1000) ships
# with the official image, so this needs no useradd.
USER node

CMD ["npm", "run", "event-outbox:worker"]
