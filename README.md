# aws-lambda-effect-runtime

A custom runtime layer that runs "Effectful" lambda functions.
The idea is to have an option to implement lambda functions returning `Effect` type from [effect](https://github.com/Effect-TS/effect) library.

## Setup

First, you will need to deploy the layer to your AWS account. Clone this repository and run the `build-layer` script to prepare the layer for distribution. Then run the `publish-layer` script to publish the layer to your AWS account.

```sh
git clone https://github.com/floydspace/aws-lambda-effect-runtime.git
cd aws-lambda-effect-runtime
pnpm install
pnpm publish-layer
```

## Usage

Once you publish the layer to your AWS account, you can create a Lambda function that uses the layer.

### Step 1: Create a Lambda handler function that returns an `Effect` type

Example of an effectful lambda handler implementing the `EffectHandler` type from [`@effect-aws/lambda`](https://github.com/floydspace/effect-aws/tree/main/packages/lambda):

```typescript
import type { SNSEvent } from "aws-lambda"
import { Effect } from "effect"
import type { EffectHandler } from "@effect-aws/lambda"

// Define your effect handler
export const handler: EffectHandler<SNSEvent, never> = (event, context) => {
  // Your effect logic here
  return Effect.succeed("Hello, World!")
}
```

### Step 2: Build the handler

You can transpile your handler function to JavaScript or bundle it. Here's how you can do it using `esbuild`:

1. Run `esbuild src/handler.ts --bundle --platform=node --target=node22 --outfile=dist/handler.js`
2. Zip the `/dist` folder

### Step 3: Create the Lambda function on AWS

Once you've written your Lambda function, you need to configure a new Lambda function to the layer. The following steps apply to configuring in the console, CloudFormation, CDK, Terraform, or any other configuration management option for AWS:

1. Create the Lambda function
2. Set the Runtime to custom with Amazon Linux 2023
3. Set the handler to `<handler-file-name>.<handler-function-name>` (e.g. `src/handler.effectHandler`)
4. Set the architecture to whichever architecture you configured when you built/deployed the Lambda Layer
5. Attach the Lambda Layer to your new function
6. Upload the zip file from step 2. You can do this in the console directly, upload to S3 and set that as the location for the handler file in Lambda, or use something like CDK to manage this for you.
