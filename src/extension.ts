import { Effect, Fiber } from "effect";
import { ExtensionApiService } from "./extensionApi";

const program = Effect.gen(function* () {
  yield* Effect.logInfo("Registering extension...");

  const extensionId = yield* ExtensionApiService.register({
    events: ["SHUTDOWN"],
  });

  yield* Effect.annotateLogsScoped({ extensionId });

  yield* Effect.logInfo("Extension registered successfully");

  const fiber = yield* ExtensionApiService.nextEvent(extensionId).pipe(
    Effect.flatMap(Effect.annotateLogsScoped),
    Effect.andThen(() => Effect.logInfo("Received execution event")),
    Effect.scoped,
    Effect.forever,
    Effect.fork
  );

  yield* Effect.logInfo("Listening for execution events...");

  yield* Fiber.join(fiber);
}).pipe(Effect.scoped, Effect.provide(ExtensionApiService.Default));

Effect.runFork(program);
