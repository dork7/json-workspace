import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, 'public');

const app = express();
app.use(express.static(ROOT));

const PORT = Number(process.env.PORT) || 4020;
const server = http.createServer(app);
server.listen(PORT, () => {
  console.log(`JSON workspace: http://127.0.0.1:${PORT}`);
});
