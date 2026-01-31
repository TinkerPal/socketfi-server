#!/bin/bash

SERVICE_NAME="socketfi-server"
APP_DIR="/home/tinkerpal/socketfi-server"
REPO_URL="git@github.com:TinkerPal/socketfi-server.git"
DOCKER_BIN="/usr/bin/docker"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

if [ ! -d "$APP_DIR" ]; then
  echo "❌ Error: App directory $APP_DIR does not exist."
  exit 1
fi

if [ ! -x "$DOCKER_BIN" ]; then
  echo "❌ Error: Docker not found at $DOCKER_BIN"
  exit 1
fi

echo "🧼 Cleaning up unused Docker resources..."
docker system prune -f

echo "🔄 Pulling latest changes..."
cd "$APP_DIR"
git pull origin main || echo "⚠️ Git pull failed or not a git repo, continuing..."

echo "🔧 Creating systemd service file at $SERVICE_FILE..."

# Properly write the service file with variables expanded
sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Unit]
Description=Docker Compose App - $SERVICE_NAME
Requires=docker.service
After=docker.service

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStartPre=$DOCKER_BIN build -t socket-server .
ExecStart=$DOCKER_BIN compose up
ExecStop=$DOCKER_BIN compose down
Restart=always
RestartSec=5
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

echo "🔄 Reloading systemd and enabling service..."
sudo systemctl daemon-reload
sudo systemctl enable ${SERVICE_NAME}.service

echo "✅ Systemd service '$SERVICE_NAME' has been created and enabled."
read -p "🚀 Do you want to start the app now? (y/n): " choice

if [[ "$choice" =~ ^[Yy]$ ]]; then
  sudo systemctl start ${SERVICE_NAME}.service
  echo "✅ Service started. You can run: sudo systemctl status ${SERVICE_NAME}.service"
else
  echo "ℹ️ You can start it manually with: sudo systemctl start ${SERVICE_NAME}.service"
fi