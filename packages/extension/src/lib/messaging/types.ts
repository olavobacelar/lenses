import { Data } from "effect";

export class NoActiveTabError extends Data.TaggedError("NoActiveTabError")<{}> {}
