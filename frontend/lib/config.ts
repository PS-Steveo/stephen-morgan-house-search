// Baked in at build time (static export) via NEXT_PUBLIC_* env vars set in CI.
// Not secrets -- a Cognito pool/client ID and an API Gateway URL are meant to
// be public; the pool itself has self-signup off and requires real creds.
export const config = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "",
  userPoolId: process.env.NEXT_PUBLIC_USER_POOL_ID ?? "",
  userPoolClientId: process.env.NEXT_PUBLIC_USER_POOL_CLIENT_ID ?? "",
};
