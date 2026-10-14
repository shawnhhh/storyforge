// Same-origin requests go through Vite's local /api proxy in development.
export async function getJson<T>(path: `/api/${string}`, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal })
  if (!response.ok) {
    throw new Error(`Local service request failed: ${response.status}`)
  }
  // This generic does not validate runtime data; add schema validation for business APIs.
  return response.json() as Promise<T>
}
