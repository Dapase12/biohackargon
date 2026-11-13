# Dockerfile for Argon Sleep Staging API
# Deploy to Railway, Fly.io, Cloud Run, etc.

FROM python:3.11-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Install Python dependencies
COPY pyproject.toml .
COPY argon_algorithms/ ./argon_algorithms/
RUN pip install --no-cache-dir -e .

# Copy the FastAPI app
COPY main.py .

# Expose port (Railway uses PORT env var)
EXPOSE 8000

# Run with uvicorn
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]