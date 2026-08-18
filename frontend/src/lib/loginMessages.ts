export type LoginFailurePayload = {
  error?: string;
  reason?: string;
  code?: string;
  failCount?: number;
};

// User PIN login failure message. The attempt counter is the server's own
// login-attempt/rate-limit mechanism (failCount inside the rate-limit window),
// so it stays correct across reloads and is never just React state. Disabled
// login surfaces the configured reason. The high-attempt warning is deliberately
// name-free — the app never hardcodes a partner's name in copy.
export function userLoginErrorMessage(payload: LoginFailurePayload | null | undefined): string {
  if (!payload) return "Login failed";
  if (payload.code === "login_disabled") return payload.reason ?? "Login is currently disabled.";
  if (payload.failCount !== undefined) {
    return payload.failCount >= 3 ? "Only the owner of this jar can unlock it 🔐" : "Wrong password";
  }
  return payload.error ?? "Login failed";
}

export function adminLoginErrorMessage(payload: LoginFailurePayload | null | undefined): string {
  if (!payload) return "Login failed";
  switch (payload.code) {
    case "rate_limited":
      return "Too many login attempts. Please try again later.";
    case "invalid_email":
      return "Please enter a valid email address.";
    case "missing_credentials":
      return "Email and password are required.";
    case "invalid_credentials":
      return "Invalid email or password.";
    default:
      return payload.error ?? "Login failed";
  }
}
