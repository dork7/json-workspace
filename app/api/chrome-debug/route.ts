import { NextResponse } from 'next/server';
import { spawn } from 'child_process';

export const runtime = 'nodejs';

export async function POST() {
  spawn(
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ['--remote-debugging-port=9222', '--user-data-dir=/tmp/chrome-debug'],
    { detached: true, stdio: 'ignore' }
  ).unref();

  return NextResponse.json({ ok: true });
}
