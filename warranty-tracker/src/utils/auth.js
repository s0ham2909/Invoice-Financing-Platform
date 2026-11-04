// Simple auth helpers for localStorage-based auth

export function isLoggedIn() {
  return localStorage.getItem("isLoggedIn") === "true";
}

export function getCurrentUser() {
  return localStorage.getItem("currentUser") || null;
}

export function logout() {
  localStorage.removeItem("isLoggedIn");
  localStorage.removeItem("currentUser");
}
