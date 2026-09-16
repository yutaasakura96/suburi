import { getDb } from "../db";
import { type Auth, createAuth } from "./auth";

let auth: Auth | undefined;

// The app's instance, bound to the app pool with the adapter's transactions on.
export function getAuth() {
  auth ??= createAuth({ db: getDb(), transaction: true });
  return auth;
}
