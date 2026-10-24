
const API_BASE_URL = "http://127.0.0.1:8000";

export async function apiRequest(path, options = {}, token = null) {
  const headers = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });

  const data = await response.json().catch(() => ({}));

  
if (!response.ok) {
  const detail = data.detail;

  const message =
    typeof detail === "string"
      ? detail
      : Array.isArray(detail)
        ? detail.map((item) => item.msg || JSON.stringify(item)).join(", ")
        : detail
          ? JSON.stringify(detail)
          : `Request failed with status ${response.status}`;

  throw new Error(message);
}


  return data;
}

export async function registerUser(email, password) {
  return apiRequest("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function loginUser(email, password) {
  return apiRequest("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}
