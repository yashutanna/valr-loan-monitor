# Deployment Guide

## Quick Start on Remote Machine

### 1. Clone or transfer the repository
```bash
git clone <your-repo> loan-monitor
cd loan-monitor
```

### 2. Create .env file
```bash
cp .env.example .env
nano .env  # Edit with your actual credentials
```

### 3. Setup volume directories (IMPORTANT!)
```bash
npm run setup
# Or manually: bash setup-volumes.sh
```

### 4. Start the services
```bash
npm run docker:up
# Or manually: docker compose up -d
```

### 5. Check logs
```bash
npm run docker:logs
# Or check individual services:
# npm run docker:logs:monitor
# npm run docker:logs:grafana
# npm run docker:logs:prometheus
```

## Accessing the Services

- **Loan Monitor API**: http://localhost:3030
- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3031 (admin/admin)

## Troubleshooting

### Permission Issues
If you see "permission denied" errors:

```bash
# Stop all services
npm run docker:down

# Fix permissions
chmod -R 777 volumes/

# Start again
npm run docker:up
```

### Containers Keep Restarting
```bash
# Check logs for specific service
npm run docker:logs:prometheus
npm run docker:logs:grafana

# Common fix: recreate volumes
npm run docker:clean  # WARNING: This deletes all data
npm run setup
npm run docker:up
```

### Port Already in Use
Edit `docker-compose.yml` and change the port mappings:
```yaml
ports:
  - "3030:3000"  # Change 3030 to another port
```

## Updating the Application

```bash
# Pull latest changes
git pull

# Rebuild and reload
npm run docker:rebuild
```

## Stopping the Services

```bash
# Stop but keep data
npm run docker:down

# Stop and remove all data
npm run docker:clean
```