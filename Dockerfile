FROM node:18-alpine
WORKDIR /app
COPY package*.json ./

# Cambia "RUN npm install" por esto:
RUN npm install --legacy-peer-deps

COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
