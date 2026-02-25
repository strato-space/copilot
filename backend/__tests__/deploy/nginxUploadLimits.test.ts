import fs from 'node:fs';
import path from 'node:path';

describe('nginx host upload limits', () => {
  it('sets body size + timeouts suitable for 600MB voice uploads', () => {
    const confPath = path.resolve(process.cwd(), '../deploy/nginx-host.conf');
    const source = fs.readFileSync(confPath, 'utf8');

    expect(source).toContain('client_max_body_size 700m;');
    expect(source).toContain('client_body_timeout 600s;');

    expect(source).toContain('location /api/');
    expect(source).toContain('proxy_read_timeout 600s;');
    expect(source).toContain('proxy_send_timeout 600s;');

    expect(source).toContain('location = /api/voicebot/upload_audio');
    expect(source).toContain('proxy_intercept_errors on;');
    expect(source).toContain('error_page 502 503 504 = @voice_upload_backend_unavailable;');
    expect(source).toContain('location @voice_upload_backend_unavailable');
  });
});
