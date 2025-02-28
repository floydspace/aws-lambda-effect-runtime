import {
  FetchHttpClient,
  HttpBody,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "@effect/platform";
import { Config, Effect, Schema } from "effect";

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
        Effect.tapErrorTag("ResponseError", (error) =>
          error.response.text.pipe(
            Effect.tap((text) => Effect.annotateLogsScoped({ text })),
            Effect.tap(() => Effect.logError(`[Runtime API] ${error.message}`))
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
          client.get("invocation/next").pipe(
            Effect.flatMap(
              HttpClientResponse.schemaJson(
                Schema.Struct({
                  body: Schema.Any,
                  headers: Schema.Struct({
                    "lambda-runtime-aws-request-id": Schema.String,
                    "lambda-runtime-trace-id": Schema.String,
                    "lambda-runtime-invoked-function-arn": Schema.String,
                    "lambda-runtime-deadline-ms": Schema.optional(
                      Schema.NumberFromString
                    ).pipe(Schema.withDecodingDefault(() => 0)),
                  }),
                })
              )
            ),
            Effect.map(
              ({ body, headers }) =>
                ({
                  requestId: headers["lambda-runtime-aws-request-id"],
                  traceId: headers["lambda-runtime-trace-id"],
                  functionArn: headers["lambda-runtime-invoked-function-arn"],
                  deadlineMs: headers["lambda-runtime-deadline-ms"],
                  event: body,
                } as LambdaRequest)
            ),
            Effect.scoped
          ),
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
