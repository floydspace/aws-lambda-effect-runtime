#!/bin/bash

# Set variables
NODE_VERSION="v22.14.0"  # Change to desired version
ARCH="linux-x64"        # Change according to your system
NODE_DIST="node-$NODE_VERSION-$ARCH"
NODE_TAR="$NODE_DIST.tar.xz"
NODE_URL="https://nodejs.org/dist/$NODE_VERSION/$NODE_TAR"
OUTPUT_ZIP="aws-lambda-effect-runtime.zip"
TEMP_DIR=$(mktemp -d)

# Download Node.js tar.xz
echo "Downloading $NODE_TAR..."
curl -o "$TEMP_DIR/$NODE_TAR" $NODE_URL

# Extract the archive
echo "Extracting $NODE_TAR..."
tar -xf "$TEMP_DIR/$NODE_TAR" -C $TEMP_DIR

# Sync $NODE_DIST/bin/node to dist/
echo "Copying $NODE_DIST/bin/node to dist/..."
mkdir -p dist/$NODE_DIST/bin
cp "$TEMP_DIR/$NODE_DIST/bin/node" dist/$NODE_DIST/bin/node
cp -r node_modules dist/
cp build/runtime.js dist/
cp bootstrap dist/

# Create a zip archive of the dist/ directory
echo "Creating $OUTPUT_ZIP archive..."
cd dist && zip -r ../$OUTPUT_ZIP . && cd ..

# Cleanup
rm -rf "$TEMP_DIR"

echo "Done! $OUTPUT_ZIP is ready."
