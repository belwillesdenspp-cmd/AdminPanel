FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY core/ ./core/
COPY gui/ ./gui/
COPY main.py cli.py config.json ./

RUN mkdir -p /app/logs \
    && useradd --create-home --shell /bin/bash cleaner \
    && chown -R cleaner:cleaner /app

USER cleaner

ENV PYTHONUNBUFFERED=1

# По умолчанию — демон по расписанию из config.json
CMD ["python", "cli.py", "--daemon"]
