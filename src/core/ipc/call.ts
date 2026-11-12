export async function call<T>(
  operation: string,
  execute: () => Promise<T>,
): Promise<T> {
  const started = performance.now();
  try {
    return await execute();
  } catch (error) {
    throw new Error(
      `${operation}：${typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : String(error)}`,
      { cause: error },
    );
  } finally {
    console.debug(
      '[local operation]',
      operation,
      Math.round(performance.now() - started),
    );
  }
}
