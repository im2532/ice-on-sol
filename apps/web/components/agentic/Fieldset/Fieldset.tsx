import { forwardRef } from 'react';
import styles from './Fieldset.module.css';

/* ---------------------------------------------------------------------------
   Fieldset — reset <fieldset> with no default border/padding/margin
   --------------------------------------------------------------------------- */
export type FieldsetProps = React.FieldsetHTMLAttributes<HTMLFieldSetElement> & {
  className?: string;
};

export const Fieldset = forwardRef<HTMLFieldSetElement, FieldsetProps>(
  function Fieldset({ className, ...props }, ref) {
    return (
      <fieldset
        ref={ref}
        className={[styles.fieldset, className].filter(Boolean).join(' ')}
        {...props}
      />
    );
  },
);

/* ---------------------------------------------------------------------------
   Legend — <legend> with semibold heading font
   --------------------------------------------------------------------------- */
export type LegendProps = React.HTMLAttributes<HTMLLegendElement> & {
  className?: string;
};

export const Legend = forwardRef<HTMLLegendElement, LegendProps>(
  function Legend({ className, ...props }, ref) {
    return (
      <legend
        ref={ref}
        data-slot="legend"
        className={[styles.legend, className].filter(Boolean).join(' ')}
        {...props}
      />
    );
  },
);

/* ---------------------------------------------------------------------------
   FieldGroup — flex column container with gap between fields
   --------------------------------------------------------------------------- */
export type FieldGroupProps = React.HTMLAttributes<HTMLDivElement> & {
  className?: string;
};

export const FieldGroup = forwardRef<HTMLDivElement, FieldGroupProps>(
  function FieldGroup({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        data-slot="control"
        className={[styles.fieldGroup, className].filter(Boolean).join(' ')}
        {...props}
      />
    );
  },
);

/* ---------------------------------------------------------------------------
   Field — flex column wrapper for label + control + description + error
   Uses data-slot adjacent-sibling selectors for spacing
   --------------------------------------------------------------------------- */
export type FieldProps = React.HTMLAttributes<HTMLDivElement> & {
  className?: string;
};

export const Field = forwardRef<HTMLDivElement, FieldProps>(
  function Field({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={[styles.field, className].filter(Boolean).join(' ')}
        {...props}
      />
    );
  },
);

/* ---------------------------------------------------------------------------
   Label — <label> with medium weight, user-select none
   --------------------------------------------------------------------------- */
export type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement> & {
  disabled?: boolean;
  className?: string;
};

export const Label = forwardRef<HTMLLabelElement, LabelProps>(
  function Label({ disabled, className, ...props }, ref) {
    return (
      <label
        ref={ref}
        data-slot="label"
        data-disabled={disabled || undefined}
        className={[styles.label, className].filter(Boolean).join(' ')}
        {...props}
      />
    );
  },
);

/* ---------------------------------------------------------------------------
   Description — <p> with secondary color
   --------------------------------------------------------------------------- */
export type DescriptionProps = React.HTMLAttributes<HTMLParagraphElement> & {
  className?: string;
};

export const Description = forwardRef<HTMLParagraphElement, DescriptionProps>(
  function Description({ className, ...props }, ref) {
    return (
      <p
        ref={ref}
        data-slot="description"
        className={[styles.description, className].filter(Boolean).join(' ')}
        {...props}
      />
    );
  },
);

/* ---------------------------------------------------------------------------
   ErrorMessage — <p> with red text and role="alert"
   --------------------------------------------------------------------------- */
export type ErrorMessageProps = React.HTMLAttributes<HTMLParagraphElement> & {
  className?: string;
};

export const ErrorMessage = forwardRef<HTMLParagraphElement, ErrorMessageProps>(
  function ErrorMessage({ className, ...props }, ref) {
    return (
      <p
        ref={ref}
        data-slot="error"
        role="alert"
        className={[styles.errorMessage, className].filter(Boolean).join(' ')}
        {...props}
      />
    );
  },
);
