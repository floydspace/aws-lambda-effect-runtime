import { type EffectHandler, makeLambda } from "@effect-aws/lambda";
import type { Layer } from "effect";

let requestId: string | undefined;
let traceId: string | undefined;
let functionArn: string | undefined;

function reset(): void {
  requestId = undefined;
  traceId = undefined;
}

function exit(...cause: Array<any>): never {
  console.error(...cause);
  process.exit(1);
}

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback ?? null;
  if (value === null) {
    exit(`Runtime failed to find the '${name}' environment variable`);
  }
  return value;
}

const runtimeUrl = new URL(
  `http://${env("AWS_LAMBDA_RUNTIME_API")}/2018-06-01/`
);

async function fetch(
  url: string,
  options?: RequestInit
): ReturnType<typeof globalThis.fetch> {
  const { href } = new URL(url, runtimeUrl);
  const response = await globalThis.fetch(href, {
    ...options,
    timeout: false,
  } as any);
  if (!response.ok) {
    exit(
      `Runtime failed to send request to Lambda [status: ${response.status}]`
    );
  }
  return response;
}

type LambdaError = {
  readonly errorType: string;
  readonly errorMessage: string;
  readonly stackTrace?: Array<string>;
};

function formatError(error: unknown): LambdaError {
  if (error instanceof Error) {
    return {
      errorType: error.name,
      errorMessage: error.message,
      stackTrace: error.stack
        ?.split("\n")
        .filter((line) => !line.includes(" /opt/runtime.ts")),
    };
  }
  return {
    errorType: "Error",
    errorMessage: (error as any)?.message ?? "An unknown error occurred",
  };
}

async function sendError(type: string, cause: unknown): Promise<void> {
  console.error(cause);
  await fetch(
    requestId === undefined
      ? "runtime/init/error"
      : `runtime/invocation/${requestId}/error`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/vnd.aws.lambda.error+json",
        "Lambda-Runtime-Function-Error-Type": `EffectRuntime.${type}`,
      },
      body: JSON.stringify(formatError(cause)),
    }
  );
}

async function throwError(type: string, cause: unknown): Promise<never> {
  await sendError(type, cause);
  exit();
}

async function init(): Promise<
  [EffectHandler<any, never, never, any>, Layer.Layer<any, any> | undefined]
> {
  const handlerName = env("_HANDLER");
  const index = handlerName.lastIndexOf(".");
  const fileName = handlerName.substring(0, index);
  const functionName = handlerName.substring(index + 1);
  const filePath = `${env("LAMBDA_TASK_ROOT")}/${fileName}.js`;
  let file;
  try {
    file = require(filePath);
  } catch (cause) {
    if (
      cause instanceof Error &&
      cause.message.startsWith("Cannot find module")
    ) {
      return throwError(
        "FileDoesNotExist",
        `Did not find a file named '${filePath}'`
      );
    }
    return throwError("InitError", cause);
  }
  const handler = file[functionName];
  const layer = file["globalLayer"];

  if (typeof handler !== "function") {
    return throwError(
      handler === undefined ? "HandlerDoesNotExist" : "HandlerIsNotAFunction",
      `${fileName} does not have an exported function named 'handler'`
    );
  }
  return [handler, layer];
}

type LambdaRequest<E = any> = {
  readonly requestId: string;
  readonly traceId: string;
  readonly functionArn: string;
  readonly deadlineMs: number | null;
  readonly event: E;
};

async function receiveRequest(): Promise<LambdaRequest> {
  const response = await fetch("runtime/invocation/next");
  requestId =
    response.headers.get("Lambda-Runtime-Aws-Request-Id") ?? undefined;
  if (requestId === undefined) {
    exit("Runtime received a request without a request ID");
  }
  traceId = response.headers.get("Lambda-Runtime-Trace-Id") ?? undefined;
  if (traceId === undefined) {
    exit("Runtime received a request without a trace ID");
  }
  process.env["_X_AMZN_TRACE_ID"] = traceId;
  functionArn =
    response.headers.get("Lambda-Runtime-Invoked-Function-Arn") ?? undefined;
  if (functionArn === undefined) {
    exit("Runtime received a request without a function ARN");
  }
  const deadlineMs =
    parseInt(response.headers.get("Lambda-Runtime-Deadline-Ms") ?? "0") || null;
  let event;
  try {
    event = await response.json();
  } catch (cause) {
    exit("Runtime received a request with invalid JSON", cause);
  }
  return {
    requestId,
    traceId,
    functionArn,
    deadlineMs,
    event,
  };
}

type LambdaResponse = {
  readonly statusCode: number;
  readonly headers?: Record<string, string>;
  readonly isBase64Encoded?: boolean;
  readonly body?: string;
  readonly multiValueHeaders?: Record<string, Array<string>>;
  readonly cookies?: Array<string>;
};

async function formatResponse(response: Response): Promise<LambdaResponse> {
  const statusCode = response.status;
  const headers = response.headers as unknown as Record<string, string>; // .toJSON();
  const mime = headers["content-type"];
  const isBase64Encoded =
    !mime ||
    (!mime.startsWith("text/") && !mime.startsWith("application/json"));
  const body = isBase64Encoded
    ? Buffer.from(await response.arrayBuffer()).toString("base64")
    : await response.text();
  // delete headers["set-cookie"];
  // const cookies = response.headers.getAll("Set-Cookie");
  // if (cookies.length === 0) {
  //   return {
  //     statusCode,
  //     headers,
  //     isBase64Encoded,
  //     body,
  //   };
  // }
  return {
    statusCode,
    headers,
    // cookies,
    // multiValueHeaders: {
    //   "Set-Cookie": cookies,
    // },
    isBase64Encoded,
    body,
  };
}

async function sendResponse(response: unknown): Promise<void> {
  if (requestId === undefined) {
    exit("Runtime attempted to send a response without a request ID");
  }
  await fetch(`runtime/invocation/${requestId}/response`, {
    method: "POST",
    body:
      response === null
        ? null
        : typeof response === "string"
        ? response
        : JSON.stringify(response),
  });
}

class LambdaServer {
  #lambda: EffectHandler<any, never, never, any>;
  #layer?: Layer.Layer<unknown, unknown>;
  pendingRequests: number;
  pendingWebSockets: number;
  port: number;
  hostname: string;
  development: boolean;

  constructor(
    lambda: EffectHandler<any, never, never, any>,
    layer?: Layer.Layer<unknown, unknown>
  ) {
    this.#lambda = lambda;
    this.#layer = layer;
    this.pendingRequests = 0;
    this.pendingWebSockets = 0;
    this.port = 80;
    this.hostname = "lambda";
    this.development = false;
  }

  async accept(request: LambdaRequest): Promise<unknown> {
    const deadlineMs =
      request.deadlineMs === null ? Date.now() + 60_000 : request.deadlineMs;
    const durationMs = Math.max(1, deadlineMs - Date.now());
    let response: unknown;
    try {
      response = await Promise.race([
        new Promise<undefined>((resolve) =>
          setTimeout(() => resolve(undefined), durationMs)
        ),
        this.#acceptRequest(request),
      ]);
    } catch (cause) {
      await sendError("RequestError", cause);
      return;
    }
    if (response === undefined) {
      await sendError("TimeoutError", "Function timed out");
      return;
    }
    return response;
  }

  async #acceptRequest(event: LambdaRequest): Promise<unknown> {
    // const request = formatRequest(event);
    let response: any | undefined;
    if (event !== undefined) {
      response = await this.fetch(event);
    }
    if (response === undefined) {
      return {
        statusCode: 200,
      };
    }
    return formatResponse(response);
  }

  async fetch({ event, ...context }: LambdaRequest): Promise<any> {
    this.pendingRequests++;
    try {
      const handler =
        this.#layer !== undefined
          ? makeLambda(this.#lambda.bind(this), this.#layer)
          : makeLambda(this.#lambda.bind(this));
      const response = await handler(event, context as any);
      // if (response instanceof Response) {
      //   return response;
      // }
      return response;
    } catch (cause) {
      console.error(cause);
      return { status: 500 };
    } finally {
      this.pendingRequests--;
    }
  }
}

async function main() {
  const [lambda, layer] = await init();
  const server = new LambdaServer(lambda, layer);
  while (true) {
    try {
      const request = await receiveRequest();
      const response = await server.accept(request);
      if (response !== undefined) {
        await sendResponse(response);
      }
    } finally {
      reset();
    }
  }
}

main();
