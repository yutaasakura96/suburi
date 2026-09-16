// The shared error envelope (07 §2). `message` is for the developer and the log, never rendered.

export function unauthenticated() {
  return Response.json(
    {
      error: {
        code: "unauthenticated",
        message: "No session, or the session has expired.",
        detail: {},
      },
    },
    { status: 401 },
  );
}
