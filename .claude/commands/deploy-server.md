Deploy the backend server on coder-server via systemd.

Usage: /deploy-server [dev]

If argument is "dev", deploy the dev instance. Otherwise deploy the stable instance.

## Instance Configuration

| Instance | Repo Path | Service Name | Data Dir | Port |
|----------|-----------|-------------|----------|------|
| stable | `/home/zhvala/code/my-claudia/` | `my-claudia-server` | `~/.my-claudia/` | 3100 |
| dev | `/home/zhvala/code/my-claudia-dev/` | `my-claudia-server-dev` | `~/.my-claudia-dev/` | 3101 |

## Steps

1. Determine which instance to deploy based on argument: `$ARGUMENTS`
   - If empty or "stable": use stable config
   - If "dev": use dev config

2. SSH to coder-server, pull latest code, and run deploy script:
   ```
   # Stable:
   ssh coder-server "cd /home/zhvala/code/my-claudia && git pull && ./scripts/deploy-server.sh"

   # Dev:
   ssh coder-server "cd /home/zhvala/code/my-claudia-dev && git pull && ./scripts/deploy-server.sh --service my-claudia-server-dev --data-dir ~/.my-claudia-dev"
   ```

   The deploy script handles: pnpm install, build shared + server, create/update systemd service, restart.

3. Verify the service is running:
   ```
   # Stable:
   ssh coder-server "systemctl --no-pager status my-claudia-server"

   # Dev:
   ssh coder-server "systemctl --no-pager status my-claudia-server-dev"
   ```

4. If issues, check logs:
   ```
   # Stable:
   ssh coder-server "journalctl -u my-claudia-server --no-pager -n 30"

   # Dev:
   ssh coder-server "journalctl -u my-claudia-server-dev --no-pager -n 30"
   ```

## Important Notes

- The deploy script needs `sudo` for systemctl operations (coder-server user has passwordless sudo)
- Dev instance uses `MY_CLAUDIA_DATA_DIR=~/.my-claudia-dev` (set in systemd unit) for data isolation
- Dev .env at `~/.my-claudia-dev/.env` must have a different PORT (e.g., 3101) and appropriate GATEWAY_URL

## SSH

- Host alias: `coder-server` (192.168.2.135, user: zhvala)
