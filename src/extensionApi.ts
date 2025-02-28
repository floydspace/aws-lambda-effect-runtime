import {
  FetchHttpClient,
  HttpBody,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "@effect/platform";
import { Config, Effect, Schema } from "effect";

export const ExtensionApi = Effect.gen(function* () {
  const baseUrl = yield* Config.nonEmptyString("AWS_LAMBDA_RUNTIME_API");
  const client = yield* HttpClient.HttpClient;

  return client.pipe(
    HttpClient.filterStatusOk,
    HttpClient.mapRequest(
      HttpClientRequest.prependUrl(`http://${baseUrl}/2020-01-01/extension/`)
    ),
    HttpClient.transformResponse((response) =>
      response.pipe(
        Effect.tapErrorTag("ResponseError", (error) =>
          error.response.text.pipe(
            Effect.tap((text) => Effect.annotateLogsScoped({ text })),
            Effect.tap(() =>
              Effect.logError(`[Extension API] ${error.message}`)
            )
          )
        )
      )
    )
  );
});

export const ExtensionId = Schema.String.pipe(Schema.brand("ExtensionId"));
export type ExtensionId = typeof ExtensionId.Type;

export class ExtensionApiService extends Effect.Service<ExtensionApiService>()(
  "aws-lambda-effect-extension/ExtensionApiService",
  {
    effect: Effect.gen(function* () {
      const client = yield* ExtensionApi;

      return {
        register: (request: { readonly events: string[] }) =>
          client
            .post("register", {
              headers: {
                "Lambda-Extension-Name": "aws-lambda-effect-extension",
              },
              body: HttpBody.unsafeJson(request),
            })
            .pipe(
              Effect.flatMap(
                HttpClientResponse.schemaHeaders(
                  Schema.Struct({ "lambda-extension-identifier": ExtensionId })
                )
              ),
              Effect.map((res) => res["lambda-extension-identifier"]),
              Effect.scoped
            ),
        nextEvent: (extensionId: ExtensionId) =>
          client
            .get("event/next", {
              headers: {
                "Content-Type": "application/json",
                "Lambda-Extension-Identifier": extensionId,
              },
            })
            .pipe(
              Effect.flatMap(
                HttpClientResponse.schemaBodyJson(
                  Schema.Record({ key: Schema.String, value: Schema.Unknown })
                )
              ),
              Effect.scoped
            ),
      };
    }),
    dependencies: [FetchHttpClient.layer],
    accessors: true,
  }
) {}
