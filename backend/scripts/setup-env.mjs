import { randomBytes } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { createInterface } from 'readline';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath   = join(__dirname, '..', '.env.development');

if (!existsSync(envPath)) process.exit(0);

const SECRET_KEYS = ['JWT_SECRET', 'JWT_REFRESH_SECRET'];

const lines   = readFileSync(envPath, 'utf8').split('\n');
const missing = SECRET_KEYS.filter((key) => {
  const line = lines.find((l) => l.startsWith(`${key}=`));
  return !line || line.split('=')[1].trim() === '';
});

if (missing.length === 0) process.exit(0);

const rl = createInterface({ input: process.stdin, output: process.stdout });

rl.question(
  `\n\x1b[33m[setup]\x1b[0m Missing secrets: ${missing.join(', ')}. Generate them now? (Y/n) `,
  (answer) => {
    rl.close();
    if (answer.toLowerCase() === 'n') {
      console.log('\x1b[31m[setup]\x1b[0m Secrets not set — server may fail to start.\n');
      process.exit(0);
    }

    let content = readFileSync(envPath, 'utf8');
    for (const key of missing) {
      const secret = randomBytes(32).toString('hex');
      content = content.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${secret}`);
      console.log(`\x1b[32m[setup]\x1b[0m Generated ${key}`);
    }
    writeFileSync(envPath, content);
    console.log('\x1b[32m[setup]\x1b[0m .env.development updated\n');
    process.exit(0);
  }
);
