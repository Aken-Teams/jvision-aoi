FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 DATA_DIR=/data YOLO_CONFIG_DIR=/data/ultralytics
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libglib2.0-0 libgl1 ffmpeg && rm -rf /var/lib/apt/lists/*
COPY requirements*.txt ./
ARG INSTALL_AI=true
RUN if [ "$INSTALL_AI" = "true" ]; then pip install --no-cache-dir -r requirements-ai.txt; else pip install --no-cache-dir -r requirements.txt; fi
COPY app ./app
RUN useradd --uid 10001 --create-home aoi && mkdir /data && chown aoi:aoi /data
USER aoi
CMD ["uvicorn","app.main:app","--host","0.0.0.0","--port","8000"]
