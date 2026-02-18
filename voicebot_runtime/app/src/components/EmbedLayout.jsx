import { Outlet } from "react-router-dom";

import RequireAuth from "./RequireAuth";
import WebrtcFabLoader from "./WebrtcFabLoader";

export default function EmbedLayout() {
  return (
    <RequireAuth>
      <div className="min-h-screen">
        <Outlet />
      </div>
      <WebrtcFabLoader />
    </RequireAuth>
  );
}
