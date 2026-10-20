import type { ReactNode } from "react";
import React from "react";

/**
 * A labelled form control with hint and error text.
 *
 * Supports two patterns:
 * 1. Render prop: children is a function receiving FieldControlProps (for custom inputs)
 * 2. Direct children: children is a ReactNode (for simple inputs/selects)
 *
 * The render prop receives the id and the ARIA wiring (`aria-invalid`,
 * `aria-describedby`) so each control stays associated with its label, hint,
 * and error message for assistive technology. Marking a field invalid always
 * also shows a visible message — never colour alone.
 */
export interface FieldControlProps {
  id: string;
  "aria-invalid"?: true;
  "aria-describedby"?: string;
  "aria-required"?: true;
}

export function FormField({
  id,
  label,
  error,
  hint,
  required = false,
  children,
}: {
  id: string;
  label: string;
  error?: string | null;
  hint?: string;
  required?: boolean;
  children: ReactNode | ((props: FieldControlProps) => ReactNode);
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy =
    [hintId, errorId].filter((value): value is string => Boolean(value)).join(" ") || undefined;

  const fieldProps: FieldControlProps = {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
    "aria-required": required ? true : undefined,
  };

  // Determine if children is a render prop function or direct ReactNode
  const renderedChildren = typeof children === "function" ? children(fieldProps) : children;

  // If direct children, we need to spread the field props onto the first child element
  let finalChildren = renderedChildren;
  if (typeof children !== "function" && React.isValidElement(renderedChildren)) {
    finalChildren = React.cloneElement(renderedChildren as React.ReactElement, {
      ...fieldProps,
      ...(renderedChildren as React.ReactElement).props,
    });
  }

  return (
    <div className={`field${error ? " field--invalid" : ""}`}>
      <label className="field__label" htmlFor={id}>
        {label}
        {required && (
          <span className="field__required" aria-hidden="true">
            {" "}
            *
          </span>
        )}
      </label>
      {hint && (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      )}
      {finalChildren}
      {error && (
        <p className="field__error" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}
