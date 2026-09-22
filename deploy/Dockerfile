# Multi-stage Dockerfile for Production Deployment
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source code and build static site
COPY . .
RUN npm run build

# Production static serving stage
FROM nginx:alpine

# Copy custom Nginx server configuration
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf

# Copy compiled static files
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
