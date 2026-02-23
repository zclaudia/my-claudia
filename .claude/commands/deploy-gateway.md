Deploy the latest gateway code to the router (claudia.zhvala.space).

The gateway repo is cloned at `/root/data/my-claudia/` on the OpenWrt router.

Steps:
1. Pull latest code and run deploy script:
   ```
   ssh router "cd /root/data/my-claudia && git pull && ./scripts/deploy-gateway.sh"
   ```
2. Verify output shows "Gateway is healthy" and "Deploy complete".
3. If issues, check logs:
   ```
   ssh router "docker compose -f /root/data/my-claudia/gateway/docker-compose.yml logs --tail=30"
   ```

SSH config: `Host router` → `zhvala.space:29951` (root, key: `~/.ssh/zoom_rsa`)
Docker compose: port 3200, volume `claudia-gateway_gateway-data:/data`
