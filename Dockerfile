FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV PORT=3789
EXPOSE 3789

CMD ["node", "server.js"]
