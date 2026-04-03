import fs from 'fs';
import os from 'os';
import path from 'path';

if (!process.env.MY_CLAUDIA_DATA_DIR) {
  process.env.MY_CLAUDIA_DATA_DIR = fs.mkdtempSync(
    path.join(os.tmpdir(), 'my-claudia-gateway-vitest-'),
  );
}
