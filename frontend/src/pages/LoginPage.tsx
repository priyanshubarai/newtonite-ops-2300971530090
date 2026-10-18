import { useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { login } from "../api/auth";
import { isApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Alert } from "../components/Alert";
import { FormField } from "../components/FormField";

const GENERIC_LOGIN_FAILURE = "Invalid email or password.";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Login screen. On success the returned token is stored in memory and the
 * session query (`GET /auth/me`) takes over; the user is then returned to the
 * page they were trying to reach.
 *
 * Failure messaging is deliberately generic and identical for unknown email,
 * wrong password, and disabled account so account existence is never revealed.
 */
export function LoginPage() {
  const { signIn, status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);

  const redirectTo =
    (location.state as { from?: string } | null)?.from ?? "/items";

  // Already signed in (e.g. a stale /login URL): go straight to the app.
  useEffect(() => {
    if (status === "authenticated") {
      navigate(redirectTo, { replace: true });
    }
  }, [status, navigate, redirectTo]);

  const loginMutation = useMutation({
    mutationFn: (credentials: { email: string; password: string }) =>
      login(credentials.email, credentials.password),
    onSuccess: (data) => {
      signIn(data.token);
    },
    onError: (error) => {
      setFormError(
        isApiError(error) && error.status === 401
          ? GENERIC_LOGIN_FAILURE
          : isApiError(error) && error.status !== 0
            ? error.message
            : "We couldn't reach the server. Check your connection and try again.",
      );
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const errors: { email?: string; password?: string } = {};
    const trimmedEmail = email.trim();
    if (!trimmedEmail) errors.email = "Enter your email address.";
    else if (!EMAIL_PATTERN.test(trimmedEmail)) errors.email = "Enter a valid email address.";
    if (!password) errors.password = "Enter your password.";

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setFormError(null);
    loginMutation.mutate({ email: trimmedEmail, password });
  }

  const submitting = loginMutation.isPending;

  return (
    <main className="auth-layout">
      <div className="auth-card">
        <h1 className="auth-card__title">Newtonite Operations</h1>
        <p className="auth-card__subtitle">Sign in to manage your team's work.</p>

        {formError && (
          <Alert tone="error" title="Sign-in failed">
            {formError}
          </Alert>
        )}

        <form className="form" onSubmit={handleSubmit} noValidate aria-busy={submitting}>
          <FormField id="login-email" label="Email" error={fieldErrors.email} required>
            {(props) => (
              <input
                {...props}
                className="input"
                type="email"
                name="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            )}
          </FormField>

          <FormField id="login-password" label="Password" error={fieldErrors.password} required>
            {(props) => (
              <input
                {...props}
                className="input"
                type="password"
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            )}
          </FormField>

          <button
            type="submit"
            className="button button--primary button--block"
            disabled={submitting}
            aria-disabled={submitting}
            aria-busy={submitting}
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="auth-card__note">
          Use a seeded demo account (see the project README) to explore the dashboard.
        </p>
      </div>
    </main>
  );
}
