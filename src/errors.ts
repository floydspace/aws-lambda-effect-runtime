import { Data } from "effect";

export class FileDoesNotExist extends Data.TaggedError("FileDoesNotExist")<{
  message: string;
}> {}

export class InitError extends Data.TaggedError("InitError")<{
  cause: unknown;
}> {}

export class HandlerDoesNotExist extends Data.TaggedError(
  "HandlerDoesNotExist"
)<{
  message: string;
}> {}

export class HandlerIsNotAFunction extends Data.TaggedError(
  "HandlerIsNotAFunction"
)<{
  message: string;
}> {}

export class ObjectIsNotALayer extends Data.TaggedError(
  "ObjectIsNotALayer"
)<{}> {}
