import {
  FetchHttpClient,
  HttpBody,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "@effect/platform";
import { Config, Effect, ParseResult, Schema } from "effect";

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

export const RequestId = Schema.String.pipe(Schema.brand("RequestId"));
export type RequestId = typeof RequestId.Type;

export const TraceId = Schema.String.pipe(Schema.brand("TraceId"));
export type TraceId = typeof TraceId.Type;

export type LambdaRequest<E = any> = {
  readonly requestId: RequestId;
  readonly traceId: TraceId;
  readonly functionArn: string;
  readonly deadlineMs: number | null;
  readonly event: E;
};

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
        nextInvocation: (): Effect.Effect<
          LambdaRequest,
          HttpClientError.HttpClientError | ParseResult.ParseError
        > =>
          client.get("invocation/next").pipe(
            Effect.flatMap(
              HttpClientResponse.schemaJson(
                Schema.Struct({
                  body: Schema.Any,
                  headers: Schema.Struct({
                    "lambda-runtime-aws-request-id": RequestId,
                    "lambda-runtime-trace-id": TraceId,
                    "lambda-runtime-invoked-function-arn": Schema.String,
                    "lambda-runtime-deadline-ms": Schema.optional(
                      Schema.NumberFromString
                    ).pipe(Schema.withDecodingDefault(() => 0)),
                  }),
                })
              )
            ),
            Effect.map(({ body, headers }) => ({
              requestId: headers["lambda-runtime-aws-request-id"],
              traceId: headers["lambda-runtime-trace-id"],
              functionArn: headers["lambda-runtime-invoked-function-arn"],
              deadlineMs: headers["lambda-runtime-deadline-ms"],
              event: body,
            })),
            Effect.scoped
          ),
        invocationResponse: (requestId: RequestId, response: unknown) =>
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
        invocationError: (requestId: RequestId, type: string, cause: unknown) =>
          client
            .post(`invocation/${requestId}/error`, {
              headers: {
                "Content-Type": "application/vnd.aws.lambda.error+json",
                "Lambda-Runtime-Function-Error-Type": `EffectRuntime.${type}`,
              },
              body: HttpBody.unsafeJson(formatError(cause)),
            })
            .pipe(Effect.scoped),
      };
    }),
    dependencies: [FetchHttpClient.layer],
    accessors: true,
  }
) {}

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
