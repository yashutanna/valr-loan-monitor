#!/bin/bash

# Setup script to create volume directories with proper permissions
# Run this before starting docker-compose on a new machine

set -e

echo "Creating volume directories..."

# Create directories
mkdir -p volumes/prometheus
mkdir -p volumes/grafana

# Set permissions (writable by all)
chmod -R 777 volumes/

echo "✓ Volume directories created successfully"
echo ""
echo "You can now run: docker compose up -d"