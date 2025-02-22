#!/bin/bash

# Set variables
LAYER_NAME="aws-lambda-effect-runtime"
LAYER_DESCRIPTION="Effect AWS Lambda Runtime"
LAYER_ARCH="x86_64"
LAYER_ZIP="aws-lambda-effect-runtime.zip"    
REGION="eu-west-1"

sh "$(dirname "$0")/build-layer.sh"

# Publish the layer
echo "Publishing $LAYER_NAME..."
aws lambda publish-layer-version \
  --layer-name $LAYER_NAME \
  --region $REGION \
  --description "$LAYER_DESCRIPTION" \
  --license-info "MIT" \
  --compatible-architectures $LAYER_ARCH \
  --compatible-runtimes provided.al2023 provided.al2 provided \
  --zip-file fileb://$LAYER_ZIP \
  --output json
