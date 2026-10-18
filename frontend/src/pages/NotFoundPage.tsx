import { useNavigate } from "react-router-dom";
import { ErrorState } from "../components/StateViews";

export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="page">
      <ErrorState
        title="Page not found"
        message="That page doesn't exist. Use the navigation above to get back on track."
        secondaryAction={{ label: "Back to work items", onClick: () => navigate("/items") }}
      />
    </div>
  );
}
