import { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleSubmit = (e) => {
    e.preventDefault();
    const user = localStorage.getItem(`user_${username}`);
    if (!user) {
      setError("User not found");
      return;
    }
    const { password: storedPassword } = JSON.parse(user);
    if (password !== storedPassword) {
      setError("Incorrect password");
      return;
    }
    localStorage.setItem("isLoggedIn", "true");
    localStorage.setItem("currentUser", username);
    navigate("/dashboard");
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      <h2 className="text-2xl font-bold mb-4">Login</h2>
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
        <button className="bg-blue-600 text-white p-2 rounded" type="submit">Login</button>
      </form>
      <button className="mt-4 underline text-blue-600" onClick={() => navigate("/signup")}>Don't have an account? Sign Up</button>
    </div>
  );
}
