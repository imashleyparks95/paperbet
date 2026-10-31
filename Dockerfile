FROM node:24-alpine
WORKDIR /app
COPY package.json domain.js store.js provider.js espn.js server.js ./
COPY public ./public
RUN mkdir -p /data && chown node:node /data
USER node
ENV NODE_ENV=production PORT=3000 DATABASE_PATH=/data/paperbet.sqlite
EXPOSE 3000
CMD ["node","server.js"]
