#!/bin/bash

pnpm esbuild src/runtime.ts --bundle \
  --platform=node \
  --target=node22 \
  --external:@effect/platform \
  --external:effect \
  --outdir=build

pnpm esbuild src/extension.ts --bundle \
  --platform=node \
  --target=node22 \
  --external:@effect/platform \
  --external:effect \
  --outdir=build