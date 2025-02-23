#!/bin/bash

# Set variables
LAYER_NAME="aws-lambda-effect-runtime"
LAYER_DESCRIPTION="Effect AWS Lambda Runtime"
LAYER_ARCH="x86_64"
LAYER_ZIP="aws-lambda-effect-runtime.zip"    
REGION="eu-west-1"

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text --no-cli-pager)
BUCKET_NAME=$LAYER_NAME-$REGION-$ACCOUNT_ID

aws s3api create-bucket \
  --bucket $BUCKET_NAME \
  --region $REGION \
  --create-bucket-configuration LocationConstraint=$REGION \
  --no-cli-pager

aws s3 cp $LAYER_ZIP s3://$BUCKET_NAME/$LAYER_ZIP --no-cli-pager

# Publish the layer
echo "Publishing $LAYER_NAME..."
aws lambda publish-layer-version \
  --layer-name $LAYER_NAME \
  --region $REGION \
  --description "$LAYER_DESCRIPTION" \
  --license-info "MIT" \
  --compatible-architectures $LAYER_ARCH \
  --compatible-runtimes provided.al2023 provided.al2 provided \
  --content "S3Bucket=$BUCKET_NAME,S3Key=$LAYER_ZIP" \
  --query LayerVersionArn \
  --output text \
  --no-cli-pager
