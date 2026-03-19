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

# Environment variables (override at deploy time via Railway)
ENV WOODS_MODE=demo
ENV TZ=Australia/Sydney

# Default: run the scheduler
CMD ["python", "runner.py", "schedule"]
