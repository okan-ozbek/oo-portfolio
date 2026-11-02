// Reverse proxies can return HTML error pages instead of the API's JSON.
// Keep those failures useful without showing server markup in the dashboard.
export async function readApiResponse(response) {
  let data;
  try { data = JSON.parse(await response.text()); } catch { /* Use the HTTP status below. */ }
  if (!response.ok) {
    if (typeof data?.error === 'string' && data.error.trim()) throw new Error(data.error);
    const messages = {
      401: 'Your session expired. Please sign in again.',
      413: 'The upload exceeds the server upload limit.',
      500: 'The server could not process this request. Please try again.',
      502: 'The server is temporarily unavailable. Please try again.',
      503: 'The server is temporarily unavailable. Please try again.',
      504: 'The server took too long to respond. Please try again.',
    };
    throw new Error(`${messages[response.status] ?? 'Request failed. Please try again.'} (HTTP ${response.status})`);
  }
  if (data === undefined) throw new Error('The server returned an invalid response. Please try again.');
  return data;
}
