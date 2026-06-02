# ---- Stage 1: Build Vite frontend ----
FROM node:20-slim AS frontend
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- Stage 2: Python runtime ----
FROM python:3.11-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY server/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy server code and built frontend
COPY server/ ./server/
COPY --from=frontend /app/dist ./dist/

WORKDIR /app/server

EXPOSE 8080
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
# Railway overrides CMD with startCommand from railway.json
# The startCommand respects $PORT set by Railway
