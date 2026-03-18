FROM python:3.12-slim

WORKDIR /app

# Install dependencies
COPY woods_system/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY woods_system/ ./woods_system/

# Create data directory
RUN mkdir -p /app/woods_system/data

WORKDIR /app/woods_system

# Environment variables (override at deploy time)
ENV WOODS_MODE=demo
ENV WOODS_SCAN_TIME=17:00
ENV WOODS_RESULTS_TIME=23:30
ENV WOODS_LOG_LEVEL=INFO
ENV TZ=America/New_York

# Health check
HEALTHCHECK --interval=60s --timeout=10s --retries=3 \
    CMD python -c "import main; print('OK')" || exit 1

# Default: run the scheduler
CMD ["python", "runner.py", "schedule"]
