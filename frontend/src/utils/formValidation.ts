export type FieldErrors = Record<string, string>;
type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
export function collectFieldErrors(form: HTMLFormElement): FieldErrors {
  const errors: FieldErrors = {};
  for (const control of form.querySelectorAll<Control>(
    'input[data-field],select[data-field],textarea[data-field]'
  )) {
    if (control.disabled) continue;
    const field = control.dataset.field!;
    const validity = control.validity;
    const input = control as HTMLInputElement;
    let message = '';
    if (validity.badInput) message = 'Bitte eine gültige Zahl eingeben.';
    else if (validity.valueMissing) message = 'Bitte dieses Feld ausfüllen.';
    else if (validity.typeMismatch)
      message =
        input.type === 'email'
          ? 'Bitte eine gültige E-Mail-Adresse eingeben.'
          : 'Bitte einen gültigen Wert eingeben.';
    else if (validity.patternMismatch)
      message = field.startsWith('colors.')
        ? 'Bitte einen Hex-Farbwert mit sechs Stellen eingeben, z. B. #246649.'
        : 'Bitte das geforderte Format verwenden.';
    else if (control.value && input.minLength > 0 && control.value.length < input.minLength)
      message = `Bitte mindestens ${input.minLength} Zeichen eingeben.`;
    else if (input.maxLength > 0 && control.value.length > input.maxLength)
      message = `Bitte maximal ${input.maxLength} Zeichen eingeben.`;
    else if (validity.rangeUnderflow) message = `Der Wert muss mindestens ${input.min} sein.`;
    else if (validity.rangeOverflow) message = `Der Wert darf höchstens ${input.max} sein.`;
    else if (validity.stepMismatch) message = 'Bitte einen gültigen Zahlenwert eingeben.';
    if (message && !errors[field]) errors[field] = message;
  }
  return errors;
}
export function focusFirstError(form: HTMLFormElement | null, errors: FieldErrors) {
  const control = Array.from(form?.querySelectorAll<HTMLElement>('[data-field]') || []).find(
    (control) => errors[control.dataset.field!]
  );
  control?.focus();
}
