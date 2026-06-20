#!/usr/bin/env node
import { main } from '../dist/cli.js';

main(process.argv)
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    // Last-resort guard; commands map their own errors to exit codes.
    process.stderr.write(`mcp-vitals: ${err?.stack ?? err}\n`);
    process.exitCode = 1;
  });
