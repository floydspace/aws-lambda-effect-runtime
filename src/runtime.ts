import type { EffectHandler } from "@effect-aws/lambda";
import { HttpClientError } from "@effect/platform";
import { Cause, Config, Console, Effect, Layer } from "effect";
import {
  getExportedHandler,
  getExportedLayer,
  importHandler,
} from "./handlerUtil";
import { LambdaRequest, RuntimeApiService } from "./runtimeApi";

let requestId: string | undefined;
let traceId: string | undefined;
let functionArn: string | undefined;

const GLOBAL_LAYER_EXPORT_NAME = "globalLayer";

function reset(): void {
  requestId = undefined;
  traceId = undefined;
  functionArn = undefined;
}

const sendError = (type: string, cause: unknown) =>
  Effect.gen(function* () {
    const service = yield* RuntimeApiService;

    yield* Console.error(cause);

    yield* requestId === undefined
      ? service.initError(type, cause)
      : service.invocationError(requestId, type, cause);
  });

const receiveRequest = () =>
  Effect.gen(function* () {
    const response = yield* RuntimeApiService.nextInvocation();
    requestId = response.requestId;
    traceId = response.traceId;
    process.env["_X_AMZN_TRACE_ID"] = traceId;
    functionArn = response.functionArn;
    return response;
  });

const receiveRequestScoped = Effect.acquireRelease(receiveRequest(), () =>
  Effect.sync(() => reset())
);

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

const sendResponse = (response: unknown) =>
  Effect.gen(function* () {
    if (requestId === undefined) {
      return yield* Effect.dieMessage(
        "Runtime attempted to send a response without a request ID"
      );
    }

    yield* RuntimeApiService.invocationResponse(requestId, response);
  });

class LambdaServer {
  #lambda: EffectHandler<any, never, never, any>;
  #layer: Layer.Layer<unknown, unknown> | null;
  pendingRequests: number;

  constructor(
    lambda: EffectHandler<any, never, never, any>,
    layer: Layer.Layer<unknown, unknown> | null
  ) {
    this.#lambda = lambda;
    this.#layer = layer;
    this.pendingRequests = 0;
  }

  accept(
    request: LambdaRequest
  ): Effect.Effect<
    LambdaResponse | void,
    HttpClientError.HttpClientError,
    RuntimeApiService
  > {
    const deadlineMs =
      request.deadlineMs === null ? Date.now() + 60_000 : request.deadlineMs;
    const durationMs = Math.max(1, deadlineMs - Date.now());

    return this.#acceptRequest(request).pipe(
      Effect.timeout(durationMs),
      Effect.catchTag("TimeoutException", () =>
        sendError("TimeoutError", "Function timed out")
      ),
      Effect.catchAll((cause) => sendError("RequestError", cause.cause))
    );
  }

  #acceptRequest(
    event: LambdaRequest
  ): Effect.Effect<LambdaResponse, Cause.UnknownException> {
    return Effect.fromNullable(event).pipe(
      Effect.andThen((e) => this.fetch(e)),
      Effect.andThen(Effect.fromNullable),
      Effect.andThen(formatResponse),
      Effect.catchTag("NoSuchElementException", () =>
        Effect.succeed({ statusCode: 200 })
      )
    );
  }

  fetch({ event, ...context }: LambdaRequest) {
    return this.#lambda(event, context as any).pipe(
      Effect.provide(
        (this.#layer as unknown as Layer.Layer<never>) ?? Layer.empty
      ),
      Effect.catchAllDefect((cause) => {
        console.error(cause);
        return Effect.succeed({ status: 500 });
      })
    );
  }
}

const program = Effect.gen(function* () {
  const handlerName = yield* Config.nonEmptyString("_HANDLER");
  const rootPath = yield* Config.nonEmptyString("LAMBDA_TASK_ROOT");
  const index = handlerName.lastIndexOf(".");
  const fileName = handlerName.substring(0, index);
  const functionName = handlerName.substring(index + 1);
  const file = yield* importHandler(`${rootPath}/${fileName}.js`);
  const lambda = yield* getExportedHandler(file, functionName);
  const layer = yield* getExportedLayer(file, GLOBAL_LAYER_EXPORT_NAME);

  const server = new LambdaServer(lambda, layer);

  return yield* receiveRequestScoped.pipe(
    Effect.andThen((request) => server.accept(request)),
    Effect.andThen((response) =>
      response !== undefined ? sendResponse(response) : Effect.void
    ),
    Effect.scoped,
    Effect.forever
  );
}).pipe(
  Effect.catchTag("ConfigError", (cause) =>
    Effect.dieMessage(
      `Runtime failed to find the '${
        (cause as any).path[0]
      }' environment variable`
    )
  ),
  Effect.catchAll((cause) => sendError(cause._tag, cause.cause)),
  Effect.provide(RuntimeApiService.Default)
);

Effect.runFork(program);
