import { fromLayer, type EffectHandler } from "@effect-aws/lambda";
import { Effect, Fiber } from "effect";
import { loadHandlerWithLayer } from "./handlerUtil";
import { LambdaRequest, RuntimeApiService } from "./runtimeApi";

const handleLambdaFunction = (
  lambda: EffectHandler<any, never, never, any>,
  request: LambdaRequest
) => {
  const deadlineMs =
    request.deadlineMs === null ? Date.now() + 60_000 : request.deadlineMs;
  const durationMs = Math.max(1, deadlineMs - Date.now());

  return Effect.fromNullable(request).pipe(
    Effect.andThen(({ event, ...context }) => lambda(event, context as any)),
    Effect.andThen(Effect.fromNullable),
    Effect.catchTag("NoSuchElementException", () =>
      Effect.succeed({ statusCode: 200 })
    ),
    Effect.catchAllDefect((cause) => {
      console.error(cause);
      return Effect.succeed({ statusCode: 500 });
    }),
    Effect.timeout(durationMs),
    Effect.catchTag("TimeoutException", () =>
      RuntimeApiService.invocationError(
        request.requestId,
        "TimeoutError",
        "Function timed out"
      )
    ),
    Effect.catchAll((cause) =>
      RuntimeApiService.invocationError(
        request.requestId,
        "RequestError",
        cause.cause
      )
    )
  );
};

const forwardInvocationToHandler = (
  lambda: EffectHandler<any, never, never, any>
) =>
  Effect.gen(function* () {
    const request = yield* RuntimeApiService.nextInvocation();
    process.env["_X_AMZN_TRACE_ID"] = request.traceId;

    const response = yield* handleLambdaFunction(lambda, request);
    if (response !== undefined) {
      yield* RuntimeApiService.invocationResponse(request.requestId, response);
    }
  });

const [lambda, GlobalRuntime] = loadHandlerWithLayer.pipe(
  Effect.map(({ handler, layer }) => [handler, fromLayer(layer)] as const),
  Effect.catchTag("ConfigError", (cause) =>
    Effect.dieMessage(
      `Runtime failed to find the '${
        (cause as any).path[0]
      }' environment variable`
    )
  ),
  Effect.runSync
);

const program = Effect.gen(function* () {
  const fiber = yield* forwardInvocationToHandler(lambda).pipe(
    Effect.forever,
    Effect.fork
  );

  yield* Effect.logInfo("Listening for lambda invocations...");

  yield* Fiber.join(fiber);
}).pipe(
  Effect.catchAll((cause) =>
    RuntimeApiService.initError(cause._tag, cause.cause)
  ),
  Effect.provide(RuntimeApiService.Default)
);

GlobalRuntime.runFork(program);
