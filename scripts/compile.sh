#!/bin/bash

pnpm esbuild src/runtime.ts --bundle \
  --platform=node \
  --target=node22 \
  --external:effect \
  --external:@effect/platform \
  --external:@effect-aws/lambda \
  --outdir=build

pnpm esbuild src/extension.ts --bundle \
  --platform=node \
  --target=node22 \
  --external:effect \
  --external:@effect/platform \
  --outdir=build