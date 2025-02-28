import type { EffectHandler, EffectHandlerWithLayer } from "@effect-aws/lambda";
import { Config, Effect, Function, Layer, Option } from "effect";
import {
  FileDoesNotExist,
  HandlerDoesNotExist,
  HandlerIsNotAFunction,
  InitError,
  ObjectIsNotALayer,
} from "./errors";

const GLOBAL_LAYER_EXPORT_NAME = "globalLayer";

export const importHandler = (
  filePath: string
): Effect.Effect<unknown, FileDoesNotExist | InitError> =>
  Effect.try({
    try: () => require(filePath),
    catch: (cause) => {
      if (
        cause instanceof Error &&
        cause.message.startsWith("Cannot find module")
      ) {
        return new FileDoesNotExist({
          message: `Did not find a file named '${filePath}'`,
        });
      }
      return new InitError({ cause });
    },
  });

export const getExportedHandler = (file: any, variableName: string) =>
  Effect.gen(function* () {
    const handler = file[variableName];

    if (handler == undefined) {
      return yield* new HandlerDoesNotExist({
        message: `File does not have an exported variable named '${variableName}'`,
      });
    }

    if (Function.isFunction(handler)) {
      return handler as EffectHandler<any, never, never, any>;
    }

    if (Function.isFunction(handler.handler) && Layer.isLayer(handler.layer)) {
      return handler as EffectHandlerWithLayer<any, never, never, never, any>;
    }

    return yield* new HandlerIsNotAFunction({
      message: `Exported variable '${variableName}' is not a function`,
    });
  });

export const getExportedLayer = (
  file: any,
  variableName: string
): Effect.Effect<Option.Option<Layer.Layer<unknown>>, ObjectIsNotALayer> =>
  Effect.fromNullable(file[variableName]).pipe(
    Effect.flatMap((layer) =>
      Layer.isLayer(layer)
        ? Effect.succeedSome(layer as Layer.Layer<unknown>)
        : new ObjectIsNotALayer()
    ),
    Effect.catchTag("NoSuchElementException", () => Effect.succeedNone)
  );

export const loadHandlerWithLayer = Effect.gen(function* () {
  yield* Effect.logInfo("Loading handler...");
  const handlerName = yield* Config.nonEmptyString("_HANDLER");
  yield* Effect.annotateLogsScoped({ handlerName });

  const taskRoot = yield* Config.nonEmptyString("LAMBDA_TASK_ROOT");
  yield* Effect.annotateLogsScoped({ rootPath: taskRoot });

  const index = handlerName.lastIndexOf(".");
  const fileName = handlerName.substring(0, index);
  const functionName = handlerName.substring(index + 1);

  const file = yield* importHandler(`${taskRoot}/${fileName}.js`);
  const handlerOrOptions = yield* getExportedHandler(file, functionName);
  const handler = Function.isFunction(handlerOrOptions)
    ? handlerOrOptions
    : handlerOrOptions.handler;
  const maybeLayer = yield* getExportedLayer(file, GLOBAL_LAYER_EXPORT_NAME);
  const layer = Option.isSome(maybeLayer)
    ? maybeLayer.value
    : !Function.isFunction(handlerOrOptions)
    ? handlerOrOptions.layer
    : Layer.empty;

  yield* Effect.logInfo("Handler loaded successfully");

  return { handler, layer } as EffectHandlerWithLayer<any, never>;
}).pipe(Effect.scoped);
