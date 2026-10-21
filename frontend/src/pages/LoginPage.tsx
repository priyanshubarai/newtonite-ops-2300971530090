import { useEffect, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { login } from "../api/auth";
import { isApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Input, Select } from "../components/ui";
import { DEMO_ACCOUNTS, findDemoAccount, getDemoPassword, rolePreviewLines } from "../lib/demoAccounts";
import { Eye, EyeOff, Lock, Loader2, Mail, Shield } from "lucide-react";

const GENERIC_LOGIN_FAILURE = "Invalid email or password.";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const DEMO_ACCOUNT_OPTIONS = [
  { value: "", label: "Choose a demo account…" },
  ...DEMO_ACCOUNTS.map((account) => ({
    value: account.email,
    label: `${account.name} — ${account.email}`,
  })),
];

export function LoginPage() {
  const { signIn, status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(() => getDemoPassword());
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);

  const redirectTo =
    (location.state as { from?: string } | null)?.from ?? "/overview";

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
  const selectedDemoAccount = findDemoAccount(email);
  const selectedDemoEmail = selectedDemoAccount?.email ?? "";
  const passwordPrefilled = password.length > 0 && getDemoPassword().length > 0;

  return (
    <main className="auth-layout">
      <section className="auth-card card-shell" aria-labelledby="login-title">
        <div className="card-core auth-card__core">
          <header className="auth-card__header">
            <div className="auth-card__mark">
              <Shield width="32" height="32" />
            </div>
            <h1 id="login-title" className="auth-card__title">
              Newtonite Operations
            </h1>
            <p className="auth-card__subtitle">
              Sign in to manage your team's work
            </p>
          </header>

          {formError && (
            <div className="alert alert--error mb-6" role="alert">
              <span className="alert__icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              </span>
              <div className="alert__content">
                <p className="alert__title">Sign-in failed</p>
                <p className="alert__body">{formError}</p>
              </div>
            </div>
          )}

          <form className="auth-form" onSubmit={handleSubmit} noValidate aria-busy={submitting}>
            <Select
              label="Demo account"
              name="demoAccount"
              options={DEMO_ACCOUNT_OPTIONS}
              value={selectedDemoEmail}
              onChange={(event) => setEmail(event.target.value)}
              hint="Testing aid — choosing an account fills the email field."
              disabled={submitting}
            />

            <div>
              <Input
                label="Email"
                type="email"
                name="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                error={fieldErrors.email}
                leadingIcon={<Mail width="20" height="20" />}
                placeholder="you@company.com"
                disabled={submitting}
                aria-busy={submitting}
              />
              <div className="auth-role-preview" role="status" aria-live="polite">
                {selectedDemoAccount ? (
                  <>
                    <p className="auth-role-preview__label">Role preview</p>
                    <ul className="auth-role-preview__list">
                      {rolePreviewLines(selectedDemoAccount).map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="auth-role-preview__empty">
                    {email.trim()
                      ? "Not a seeded demo account — no role preview. The server still verifies every sign-in."
                      : "Choose a demo account to preview its team roles."}
                  </p>
                )}
              </div>
            </div>

            <Input
              label="Password"
              type={showPassword ? "text" : "password"}
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              error={fieldErrors.password}
              hint={passwordPrefilled ? "Prefilled with the documented development demo password." : undefined}
              leadingIcon={<Lock width="20" height="20" />}
              trailingAction={
                <button
                  type="button"
                  className="input-action-button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  disabled={submitting}
                >
                  {showPassword ? (
                    <EyeOff width="20" height="20" />
                  ) : (
                    <Eye width="20" height="20" />
                  )}
                </button>
              }
              placeholder="••••••••"
              disabled={submitting}
              aria-busy={submitting}
            />

            <button
              type="submit"
              className="button button--primary button--full button--lg w-full"
              disabled={submitting}
              aria-disabled={submitting}
              aria-busy={submitting}
            >
              {submitting ? (
                <>
                  <Loader2 width="20" height="20" className="animate-spin mr-2" />
                  Signing in…
                </>
              ) : (
                "Sign in"
              )}
            </button>
          </form>

          <p className="auth-card__note">
            Seeded demo accounts are for local development only. The server verifies every sign-in.
          </p>
        </div>
      </section>
    </main>
  );
}
