import { useNavigate } from "react-router-dom";

export default function LogoutButton() {
  const navigate = useNavigate();
  const handleLogout = () => {
    localStorage.removeItem("isLoggedIn");
    localStorage.removeItem("currentUser");
    navigate("/login");
  };
  return (
    <button className="bg-red-500 text-white px-3 py-1 rounded" onClick={handleLogout}>
      Logout
    </button>
  );
}
