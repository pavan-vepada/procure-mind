# Stage 1: build the React app into static files.
FROM node:20-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Stage 2: the Python server, which also serves the built web app.
FROM python:3.12-slim
# Tesseract is the OCR engine used as a second opinion on images.
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY app/ app/
COPY data/seed/ data/seed/
COPY data/accuracy.json data/accuracy.json
COPY --from=web /web/dist web/dist

# RFx databases and uploads go here. Mount a volume at /data to keep them across restarts.
ENV DATA_DIR=/data
# The host tells the app which port to listen on through PORT.
CMD ["sh", "-c", "uv run --no-sync uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
