FROM node:24-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM golang:1.24-alpine AS backend-builder
WORKDIR /app/backend
COPY backend/go.mod ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=1 GOOS=linux go build -o /out/minio-manager-web ./cmd/server

FROM alpine:3.21
WORKDIR /app
RUN apk add --no-cache ca-certificates tzdata
COPY --from=backend-builder /out/minio-manager-web /app/minio-manager-web
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist
ENV FRONTEND_DIST_DIR=/app/frontend/dist
EXPOSE 8080
CMD ["/app/minio-manager-web"]
