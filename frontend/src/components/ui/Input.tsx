import { forwardRef } from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  /** Interactive trailing control (e.g. a show/hide-password button). */
  trailingAction?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      error,
      hint,
      leadingIcon,
      trailingIcon,
      trailingAction,
      className = "",
      id,
      ...props
    },
    ref
  ) => {
    const inputId = id || `input-${Math.random().toString(36).slice(2)}`;
    const errorId = `${inputId}-error`;
    const hintId = `${inputId}-hint`;

    return (
      <div className="form-group">
        {label && (
          <label
            htmlFor={inputId}
            className="form-label"
          >
            {label}
          </label>
        )}
        <div className="input-wrapper">
          {leadingIcon && (
            <div className="input-leading-icon" aria-hidden="true">
              {leadingIcon}
            </div>
          )}
          <input
            id={inputId}
            className={`
              input
              ${error ? "input--error" : ""}
              ${leadingIcon ? "input-has-leading-icon" : ""}
              ${trailingIcon || trailingAction ? "input-has-trailing-icon" : ""}
              ${className}
            `}
            aria-invalid={error ? "true" : "false"}
            aria-describedby={error ? errorId : hint ? hintId : undefined}
            {...props}
            ref={ref}
          />
          {trailingAction && (
            <div className="input-action">{trailingAction}</div>
          )}
          {trailingIcon && (
            <div className="input-trailing-icon" aria-hidden="true">
              {trailingIcon}
            </div>
          )}
        </div>
        {error && (
          <p
            id={errorId}
            className="form-error"
            role="alert"
          >
            {error}
          </p>
        )}
        {hint && !error && (
          <p id={hintId} className="form-hint">
            {hint}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      label,
      error,
      hint,
      leadingIcon,
      trailingIcon,
      className = "",
      id,
      ...props
    },
    ref
  ) => {
    const inputId = id || `textarea-${Math.random().toString(36).slice(2)}`;
    const errorId = `${inputId}-error`;
    const hintId = `${inputId}-hint`;

    return (
      <div className="form-group">
        {label && (
          <label
            htmlFor={inputId}
            className="form-label"
          >
            {label}
          </label>
        )}
        <div className="input-wrapper">
          {leadingIcon && (
            <div className="input-leading-icon" style={{ top: "var(--space-4)" }} aria-hidden="true">
              {leadingIcon}
            </div>
          )}
          <textarea
            id={inputId}
            className={`
              input textarea
              ${error ? "input--error" : ""}
              ${leadingIcon ? "input-has-leading-icon" : ""}
              ${trailingIcon ? "input-has-trailing-icon" : ""}
              ${className}
            `}
            aria-invalid={error ? "true" : "false"}
            aria-describedby={error ? errorId : hint ? hintId : undefined}
            {...props}
            ref={ref}
          />
          {trailingIcon && (
            <div className="input-trailing-icon" style={{ top: "var(--space-4)" }} aria-hidden="true">
              {trailingIcon}
            </div>
          )}
        </div>
        {error && (
          <p
            id={errorId}
            className="form-error"
            role="alert"
          >
            {error}
          </p>
        )}
        {hint && !error && (
          <p id={hintId} className="form-hint">
            {hint}
          </p>
        )}
      </div>
    );
  }
);

Textarea.displayName = "Textarea";

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: string;
  options: { value: string; label: string }[];
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      label,
      error,
      hint,
      options,
      className = "",
      id,
      ...props
    },
    ref
  ) => {
    const selectId = id || `select-${Math.random().toString(36).slice(2)}`;
    const errorId = `${selectId}-error`;
    const hintId = `${selectId}-hint`;

    return (
      <div className="form-group">
        {label && (
          <label
            htmlFor={selectId}
            className="form-label"
          >
            {label}
          </label>
        )}
        <div className="input-wrapper">
          <select
            id={selectId}
            className={`
              input select
              ${error ? "input--error" : ""}
              ${className}
            `}
            aria-invalid={error ? "true" : "false"}
            aria-describedby={error ? errorId : hint ? hintId : undefined}
            {...props}
            ref={ref}
          >
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        {error && (
          <p
            id={errorId}
            className="form-error"
            role="alert"
          >
            {error}
          </p>
        )}
        {hint && !error && (
          <p id={hintId} className="form-hint">
            {hint}
          </p>
        )}
      </div>
    );
  }
);

Select.displayName = "Select";