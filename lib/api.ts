import { NextResponse } from "next/server";

import { AccountError } from "@/lib/account";
import { StorageNotConfiguredError } from "@/lib/storage";

/** JSON error responses shared by the API routes. */

export function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function forbidden(message: string) {
  return NextResponse.json({ error: message }, { status: 403 });
}

export function failure(err: unknown, tag = "api") {
  if (err instanceof AccountError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof StorageNotConfiguredError) {
    return NextResponse.json({ error: err.message }, { status: 503 });
  }
  console.error(`[${tag}]`, err);
  return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}
