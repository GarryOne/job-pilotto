# The hosted Always on image (spec docs/superpowers/specs/2026-10-16-hosted-always-on.md §1): the public engine as the app runs it, serving `python -m src hosted --serve`.
# Cloudflare Container, instance standard-1; the Worker POSTs /run {site, token} per run. requirements.txt only (AI goes through our route, no Playwright). Build from the repo root: docker build -f hosted/Dockerfile .
FROM python:3.12-slim
WORKDIR /engine
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY src ./src
COPY config ./config
COPY templates ./templates
ENV JOB_PILOTTO_NO_DOTENV=1 PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
EXPOSE 8080
# The run token arrives in the POST body, per run; nothing secret is baked in.
CMD ["python", "-m", "src", "hosted", "--serve"]
