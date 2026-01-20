# Public domain setup (Nginx)

This folder contains a host-level Nginx config for `copilot.stratospace.fun`.
It assumes the Docker services are running on the same machine and exposing:
- frontend container on port 8080
- backend container on port 8000

## Steps
1. Point DNS A record for `copilot.stratospace.fun` to your server IP.
2. Run the app with Docker (from the `copilot/` folder):
   ```bash
   docker-compose up -d --build
   ```
3. Install a TLS certificate (example with certbot):
   ```bash
   certbot --nginx -d copilot.stratospace.fun
   ```
4. Copy `deploy/nginx-host.conf` to your Nginx sites config (for example
   `/etc/nginx/sites-enabled/copilot.conf`), then run `nginx -t` and reload Nginx.

## Notes
- The backend needs access to CRM snapshot CSV files. `docker-compose.yml` mounts `../voicebot/downloads` read-only into the backend container.
- If you do not have TLS yet, remove the 443 server block and keep only the 80 block.
- If your certificate is issued for a different name, update the `ssl_certificate` paths.
- The SPA itself already shows the domain name as a placeholder page.
