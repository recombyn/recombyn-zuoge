FROM python:3.12-slim

WORKDIR /app

# Install wire contract package (recombyn-protocol). Pin via build-args.
ARG PROTOCOL_GIT_URL=https://github.com/recombyn/recombyn.git
ARG PROTOCOL_GIT_REF=main

COPY pyproject.toml ./
COPY configs ./configs
COPY src ./src

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git \
        libgomp1 \
        libglib2.0-0 \
        libsm6 \
        libxext6 \
        libxrender1 \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir -i https://mirrors.aliyun.com/pypi/simple --trusted-host mirrors.aliyun.com \
         "git+${PROTOCOL_GIT_URL}@${PROTOCOL_GIT_REF}#subdirectory=packages/protocol" \
    && pip install --no-cache-dir -i https://mirrors.aliyun.com/pypi/simple --trusted-host mirrors.aliyun.com ".[queue,ocr]"

ENV PYTHONUNBUFFERED=1 \
    INTELLIGENCE_SERVICE_HOST=0.0.0.0 \
    INTELLIGENCE_SERVICE_PORT=8091 \
    ILP_WORKSPACE=/data/vision

EXPOSE 8091

CMD ["sh", "-c", "uvicorn recombyn_intelligence_service.app:app --host ${INTELLIGENCE_SERVICE_HOST:-0.0.0.0} --port ${INTELLIGENCE_SERVICE_PORT:-8091}"]
