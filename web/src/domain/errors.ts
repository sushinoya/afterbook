export class ReaderConnectionError extends Error {
  constructor(
    message: string,
    readonly code: ReaderConnectionErrorCode,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ReaderConnectionError";
  }
}

export type ReaderConnectionErrorCode =
  | "unsupported-browser"
  | "permission-denied"
  | "invalid-source"
  | "invalid-path"
  | "reader-not-supported";

export function errorName(error: unknown): string | undefined {
  return errorProperty(error, "name");
}

export function errorMessage(error: unknown): string | undefined {
  return errorProperty(error, "message");
}

function errorProperty(error: unknown, property: "name" | "message"): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const value = (error as Record<string, unknown>)[property];
  return typeof value === "string" ? value : undefined;
}
