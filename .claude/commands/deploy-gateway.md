Deploy the gateway Docker container on the router.

Usage: /deploy-gateway [dev]

If argument is "dev", deploy to the dev instance. Otherwise deploy to the stable instance.

## Instance Configuration

| Instance | Repo Path | Project Name | Env File | Port |
|----------|-----------|-------------|----------|------|
| stable | `/root/data/my-claudia/` | `claudia-gateway` | `gateway/.env` | 3200 |
| dev | `/root/data/my-claudia-dev/` | `claudia-gateway-dev` | `gateway/.env` | 3201 |

## Steps

1. Determine which instance to deploy based on argument: `$ARGUMENTS`
   - If empty or "stable": use stable config
   - If "dev": use dev config

2. Pull latest code and run deploy script:
   ```
   # Stable:
   ssh router "cd /root/data/my-claudia && git pull && ./scripts/deploy-gateway.sh"

   # Dev:
   ssh router "cd /root/data/my-claudia-dev && git pull && ./scripts/deploy-gateway.sh -p claudia-gateway-dev"
   ```

3. Verify output shows "Gateway is healthy" and "Deploy complete".

4. If issues, check logs:
   ```
   # Stable:
   ssh router "cd /root/data/my-claudia && docker compose -f gateway/docker-compose.yml -p claudia-gateway logs --tail=30"

   # Dev:
   ssh router "cd /root/data/my-claudia-dev && docker compose -f gateway/docker-compose.yml -p claudia-gateway-dev logs --tail=30"
   ```

## SSH

- Host alias: `router` (OpenWrt, 192.168.2.1)
- Docker build needs `--network host` for DNS resolution
