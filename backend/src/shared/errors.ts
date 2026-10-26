export function httpError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}
export function fieldError(status: number, field: string, message: string) {
  return Object.assign(httpError(status, message), { fieldErrors: { [field]: message } });
}
