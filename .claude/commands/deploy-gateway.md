Deploy the latest gateway code to the router (claudia.zhvala.space).

The gateway runs as a Docker container on the router at `/root/data/claudia-gateway/`.

Steps:
1. Build the shared package first: `pnpm --filter @my-claudia/shared run build`
2. Create a tarball with the required build files:
   ```
   tar czf /tmp/gateway-build.tar.gz \
     package.json pnpm-workspace.yaml pnpm-lock.yaml \
     shared/package.json shared/src shared/tsconfig.json \
     gateway/package.json gateway/src gateway/tsconfig.json gateway/Dockerfile
   ```
3. Upload the tarball to the router:
   ```
   scp /tmp/gateway-build.tar.gz router:/root/data/claudia-gateway/gateway-build.tar.gz
   ```
4. SSH to the router, extract, and build the Docker image:
   ```
   ssh router "cd /root/data/claudia-gateway && \
     rm -rf gateway-build && mkdir gateway-build && \
     tar xzf gateway-build.tar.gz -C gateway-build"
   ```
5. IMPORTANT: The router's Docker cannot access apt repos (deb.debian.org) or npm mirrors (npmmirror.com).
   Before building, patch the Dockerfile on the router to:
   - Remove all `--registry=https://registry.npmmirror.com` flags
   - Remove `pnpm config set registry https://registry.npmmirror.com &&` lines
   - Remove the `apt-get` step entirely (better-sqlite3 uses prebuild binaries, no need for python3/make/g++)
   ```
   ssh router "sed -i \
     -e 's|--registry=https://registry.npmmirror.com||g' \
     -e 's|pnpm config set registry https://registry.npmmirror.com && ||g' \
     -e '/apt-get/d' \
     /root/data/claudia-gateway/gateway-build/gateway/Dockerfile"
   ```
6. Build with `--network host` (required for DNS resolution on the router):
   ```
   ssh router "cd /root/data/claudia-gateway/gateway-build && \
     docker build --network host -t my-claudia-gateway:latest -f gateway/Dockerfile ."
   ```
7. Restart the gateway container:
   ```
   ssh router "cd /root/data/claudia-gateway && docker-compose down && docker-compose up -d"
   ```
8. Wait ~10 seconds, then verify the gateway is healthy:
   ```
   ssh router "docker-compose -f /root/data/claudia-gateway/docker-compose.yml ps && \
     docker-compose -f /root/data/claudia-gateway/docker-compose.yml logs --tail=10"
   ```
   Confirm: status is `healthy`, backends are registered, no errors.

SSH config: `Host router` → `zhvala.space:29951` (root, key: `~/.ssh/zoom_rsa`)
Docker compose: uses `image: my-claudia-gateway:latest`, port 3200, volume `gateway-data:/data`
