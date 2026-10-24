#!/usr/bin/env bash
# engine
cd ~/software/imagegen
IMAGEGEN_API_KEYS="sk-studio-test" \
  IMAGEGEN_PORT=9090 \
  uv run imagegen serve --config config/service.toml &

# studio
cd ~/software/llmimage
LLMIMAGE_BASE_URL="http://127.0.0.1:9090/v1" LLMIMAGE_ALLOWED_HOSTS="127.0.0.1,localhost,api.openai.com" \
  uv run llmimage serve --host 0.0.0.0 --port 8765
