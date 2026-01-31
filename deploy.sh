#!/bin/bash

# Ensure pm2 and yarn are available
# Ensure yarn is available
if ! command -v npm &> /dev/null
then
    echo "npm could not be found, please install it first."
    exit 1
fi

# Ensure pm2 is available
if ! command -v systemctl &> /dev/null
then
    echo "systemctl could not be found, please install it first."
    exit 1
fi

SERVICE_NAME="socketfi-server"
cd /home/tinkerpal/socketfi-server
echo "📥 Pulling latest changes..."
git pull origin main
echo "Restarting ${SERVICE_NAME}.service"
sudo systemctl restart ${SERVICE_NAME}.service
echo "✅ Deployment complete!"