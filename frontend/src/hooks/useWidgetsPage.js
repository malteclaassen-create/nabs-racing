import { useCallback } from "react";
import { api } from "../api/client.js";
import { useApi } from "./useApi.js";
import { useAuth } from "./useAuth.js";

// Does this person get the Widgets section of the profile?
//
// Admins always do: they try the widgets out before anybody else. Everyone
// else once an admin has opened it (Admin -> Site texts -> Widgets, backend
// lib/widgetsPage.js). `isPublic` rides along so the section can tell an admin
// that the members cannot see it yet.
//
// The page's Android half (the NABS app) has its own switch, the same way round:
// `androidVisible` says whether this person gets it.
//
// A failed read keeps it with the admins, the same answer as "not yet".
export function useWidgetsPage() {
  const { user } = useAuth();
  const isAdmin = !!user?.isAdmin;
  const { data, loading } = useApi(
    useCallback(() => api.widgetsPageIsPublic().catch(() => ({ public: false, androidPublic: false })), [])
  );
  const isPublic = data?.public === true;
  const androidPublic = data?.androidPublic === true;
  return {
    visible: isAdmin || isPublic,
    isPublic,
    androidVisible: isAdmin || androidPublic,
    androidPublic,
    isAdmin,
    loading: loading && !data,
  };
}
