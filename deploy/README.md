# Public domain setup (Nginx)

This folder contains a host-level Nginx config for `copilot.stratospace.fun`.
It assumes the Finance Ops backend is running locally on port 3002 and the frontend build is in `app/dist`.

## Steps
1. Point DNS A record for `copilot.stratospace.fun` to your server IP.
2. Build the frontend (from the `copilot/` folder):
   ```bash
   cd app && npm install && npm run build
   ```
   Ensure the backend is running (see `backend/package.json` scripts).
3. Install a TLS certificate (example with certbot):
   ```bash
   certbot --nginx -d copilot.stratospace.fun
   ```
4. Copy `deploy/nginx-host.conf` to your Nginx sites config (for example
   `/etc/nginx/sites-enabled/copilot.conf`), then run `nginx -t` and reload Nginx.

## Notes
- If you do not have TLS yet, remove the 443 server block and keep only the 80 block.
- If your certificate is issued for a different name, update the `ssl_certificate` paths.
