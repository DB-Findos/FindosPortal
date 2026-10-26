import { useId, useRef, useState } from 'react';
import { ApiError } from '../contexts/ApiContext';
import { collectFieldErrors, focusFirstError, type FieldErrors } from '../utils/formValidation';
export function useFormErrors() {
  const formRef = useRef<HTMLFormElement>(null),
    prefix = useId();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({}),
    [error, setError] = useState('');
  const errorId = (field: string) => `${prefix}-${field}-error`;
  function clearField(field: string) {
    setFieldErrors((previous) => {
      const next = { ...previous };
      delete next[field];
      return next;
    });
  }
  function setFieldError(field: string, message: string) {
    setFieldErrors((previous) => ({ ...previous, [field]: message }));
  }
  function validate(form: HTMLFormElement) {
    const errors = collectFieldErrors(form);
    setError('');
    setFieldErrors(errors);
    focusFirstError(form, errors);
    return Object.keys(errors).length === 0;
  }
  function handleError(caught: unknown, mapField: (field: string) => string = (field) => field) {
    const fields: FieldErrors = {};
    const controls = new Set(
      Array.from(formRef.current?.querySelectorAll<HTMLElement>('[data-field]') || []).map(
        (control) => control.dataset.field
      )
    );
    if (caught instanceof ApiError)
      for (const [field, message] of Object.entries(caught.fieldErrors)) {
        const mapped = mapField(field);
        if (controls.has(mapped) && !fields[mapped]) fields[mapped] = message;
      }
    setFieldErrors(fields);
    setError(
      Object.keys(fields).length
        ? ''
        : caught instanceof Error
          ? caught.message
          : 'Speichern fehlgeschlagen.'
    );
    focusFirstError(formRef.current, fields);
  }
  function inputProps(field: string) {
    return {
      id: `${prefix}-${field}`,
      'data-field': field,
      'aria-invalid': Boolean(fieldErrors[field]),
      'aria-describedby': fieldErrors[field] ? errorId(field) : undefined,
    };
  }
  return {
    formRef,
    fieldErrors,
    error,
    setError,
    clearField,
    setFieldError,
    validate,
    handleError,
    inputProps,
    errorId,
  };
}
