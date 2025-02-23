import { type EffectHandler, makeLambda } from "@effect-aws/lambda";
import { Config, Effect, Function, Layer } from "effect";
import {
  FileDoesNotExist,
  HandlerDoesNotExist,
  HandlerIsNotAFunction,
  InitError,
  ObjectIsNotALayer,
} from "./errors";

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

    if (!Function.isFunction(handler)) {
      return yield* new HandlerIsNotAFunction({
        message: `Exported variable '${variableName}' is not a function`,
      });
    }

    return handler as EffectHandler<any, never, never, any>;
  });

export const getExportedLayer = (file: any, variableName: string) =>
  Effect.gen(function* () {
    const layer: unknown = file[variableName];

    if (layer == undefined) {
      return null;
    }

    if (!Layer.isLayer(layer)) {
      return yield* new ObjectIsNotALayer();
    }

    return layer as Layer.Layer<unknown, unknown>;
  });
