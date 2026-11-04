import { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function SignUp() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!username || !password) {
      setError("Username and password required");
      return;
    }
    if (localStorage.getItem(`user_${username}`)) {
      setError("User already exists");
      return;
    }
    localStorage.setItem(`user_${username}` , JSON.stringify({ username, password }));
    localStorage.setItem("isLoggedIn", "true");
    localStorage.setItem("currentUser", username);
    navigate("/dashboard");
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      <h2 className="text-2xl font-bold mb-4">Sign Up</h2>
      <form className="flex flex-col gap-3 w-80" onSubmit={handleSubmit}>
        <input
          className="border p-2 rounded"
          type="text"
          placeholder="Username"
          value={username}
          onChange={e => setUsername(e.target.value)}
        />
        <input
          className="border p-2 rounded"
          type="password"
          placeholder="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
        />
        {error && <div className="text-red-500 text-sm">{error}</div>}
        <button className="bg-blue-600 text-white p-2 rounded" type="submit">Sign Up</button>
      </form>
      <button className="mt-4 underline text-blue-600" onClick={() => navigate("/login")}>Already have an account? Login</button>
    </div>
  );
}
