/** Reject when `promise` does not settle within `ms` (prevents infinite cover spinners). */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = 'timeout'
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(label)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}
