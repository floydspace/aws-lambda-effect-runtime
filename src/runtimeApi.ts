import {
  FetchHttpClient,
  HttpBody,
  HttpClient,
  HttpClientRequest,
  Headers,
} from "@effect/platform";
import { Config, Effect, Option } from "effect";

export const RuntimeApi = Effect.gen(function* () {
  const baseUrl = yield* Config.nonEmptyString("AWS_LAMBDA_RUNTIME_API");
  const client = yield* HttpClient.HttpClient;

  return client.pipe(
    HttpClient.filterStatusOk,
    HttpClient.mapRequest(
      HttpClientRequest.prependUrl(`http://${baseUrl}/2018-06-01/runtime/`)
    ),
    HttpClient.transformResponse((response) =>
      response.pipe(
        Effect.flatMap((res) =>
          200 <= res.status && res.status < 300
            ? Effect.succeed(res)
            : Effect.dieMessage(
                `Runtime failed to send request to Lambda [status: ${res.status}]`
              )
        )
      )
    )
  );
});

export class RuntimeApiService extends Effect.Service<RuntimeApiService>()(
  "aws-lambda-effect-runtime/RuntimeApiService",
  {
    effect: Effect.gen(function* () {
      const client = yield* RuntimeApi;

      return {
        initError: (type: string, cause: unknown) =>
          client
            .post("init/error", {
              headers: {
                "Content-Type": "application/vnd.aws.lambda.error+json",
                "Lambda-Runtime-Function-Error-Type": `EffectRuntime.${type}`,
              },
              body: HttpBody.unsafeJson(formatError(cause)),
            })
            .pipe(Effect.scoped),
        invocationError: (requestId: string, type: string, cause: unknown) =>
          client
            .post(`invocation/${requestId}/error`, {
              headers: {
                "Content-Type": "application/vnd.aws.lambda.error+json",
                "Lambda-Runtime-Function-Error-Type": `EffectRuntime.${type}`,
              },
              body: HttpBody.unsafeJson(formatError(cause)),
            })
            .pipe(Effect.scoped),
        nextInvocation: () =>
          Effect.gen(function* () {
            const response = yield* client.get("invocation/next");

            const requestId = Headers.get(
              response.headers,
              "Lambda-Runtime-Aws-Request-Id"
            ).pipe(Option.getOrUndefined);
            if (requestId === undefined) {
              return yield* Effect.dieMessage(
                "Runtime received a request without a request ID"
              );
            }
            const traceId = Headers.get(
              response.headers,
              "Lambda-Runtime-Trace-Id"
            ).pipe(Option.getOrUndefined);
            if (traceId === undefined) {
              return yield* Effect.dieMessage(
                "Runtime received a request without a trace ID"
              );
            }
            const functionArn = Headers.get(
              response.headers,
              "Lambda-Runtime-Invoked-Function-Arn"
            ).pipe(Option.getOrUndefined);
            if (functionArn === undefined) {
              return yield* Effect.dieMessage(
                "Runtime received a request without a function ARN"
              );
            }
            const deadlineMs =
              parseInt(
                Headers.get(
                  response.headers,
                  "Lambda-Runtime-Deadline-Ms"
                ).pipe(Option.getOrElse(() => "0"))
              ) || null;
            const event = yield* response.json.pipe(
              Effect.catchAllDefect(() =>
                Effect.dieMessage(
                  "Runtime received a request with invalid JSON"
                )
              )
            );
            return {
              requestId,
              traceId,
              functionArn,
              deadlineMs,
              event,
            } as LambdaRequest;
          }).pipe(Effect.scoped),

        invocationResponse: (requestId: string, response: unknown) =>
          client
            .post(`invocation/${requestId}/response`, {
              body:
                response === null
                  ? HttpBody.empty
                  : typeof response === "string"
                  ? HttpBody.text(response)
                  : HttpBody.unsafeJson(response),
            })
            .pipe(Effect.scoped),
      };
    }),
    dependencies: [FetchHttpClient.layer],
    accessors: true,
  }
) {}

export type LambdaRequest<E = any> = {
  readonly requestId: string;
  readonly traceId: string;
  readonly functionArn: string;
  readonly deadlineMs: number | null;
  readonly event: E;
};

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
