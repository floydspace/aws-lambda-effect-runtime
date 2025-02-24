import {
  FetchHttpClient,
  Headers,
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
        Effect.flatMap((res) =>
          200 <= res.status && res.status < 300
            ? Effect.succeed(res)
            : res.text.pipe(
                Effect.flatMap((error) =>
                  Effect.dieMessage(`register failed [error: ${error}]`)
                )
              )
        )
      )
    )
  );
});

export interface RegisterRequest {
  events: string[];
}

export class ExtensionApiService extends Effect.Service<ExtensionApiService>()(
  "aws-lambda-effect-extension/ExtensionApiService",
  {
    effect: Effect.gen(function* () {
      const client = yield* ExtensionApi;

      return {
        register: (request: RegisterRequest) =>
          client
            .post("register", {
              headers: {
                "Lambda-Extension-Name": "aws-lambda-effect-extension",
              },
              body: HttpBody.unsafeJson(request),
            })
            .pipe(
              Effect.flatMap((res) =>
                Headers.get(res.headers, "Lambda-Extension-Identifier")
              ),
              Effect.scoped
            ),
        nextEvent: (extensionId: string) =>
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
