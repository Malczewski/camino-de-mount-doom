import { useEffect, useState } from "react";
import {
  getNearestLandmark,
  getProgressPercent,
} from "../lib/mapPosition";
import { supabase } from "../lib/supabase";

interface ProfileProps {
  userId: string;
  onAccountDeleted: () => void;
  onLogout: () => void;
}

export default function Profile({ userId, onAccountDeleted, onLogout }: ProfileProps) {
  const [totalSteps, setTotalSteps] = useState(0);
  const [displayName, setDisplayName] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    type: "error" | "success";
  } | null>(null);

  useEffect(() => {
    const loadProfile = async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("display_name, total_steps")
        .eq("id", userId)
        .single();

      if (error) {
        setMessage({ text: error.message, type: "error" });
      } else if (data) {
        setDisplayName(data.display_name ?? "");
        setTotalSteps(data.total_steps ?? 0);
      }
      setLoading(false);
    };

    void loadProfile();

    const channel = supabase
      .channel(`profile-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "profiles",
          filter: `id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as {
            total_steps?: number;
            display_name?: string | null;
          };
          if (typeof row.total_steps === "number") {
            setTotalSteps(row.total_steps);
          }
          if (row.display_name !== undefined) {
            setDisplayName(row.display_name ?? "");
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "step_logs" },
        (payload) => {
          const row = payload.new as { user_id?: string } | null;
          const eventUserId =
            row?.user_id ??
            (payload.old as { user_id?: string } | null)?.user_id;
          if (eventUserId === userId) {
            void supabase
              .from("profiles")
              .select("total_steps")
              .eq("id", userId)
              .single()
              .then(({ data }) => {
                if (data) setTotalSteps(data.total_steps ?? 0);
              });
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  const startEditingName = () => {
    setNewName(displayName);
    setEditingName(true);
    setMessage(null);
  };

  const saveName = async () => {
    const trimmed = newName.trim();
    setSavingName(true);
    setMessage(null);

    const { error } = await supabase
      .from("profiles")
      .update({ display_name: trimmed || null })
      .eq("id", userId);

    setSavingName(false);

    if (error) {
      setMessage({ text: error.message, type: "error" });
      return;
    }

    setDisplayName(trimmed);
    setEditingName(false);
    setMessage({ text: "Name updated!", type: "success" });
  };

  const cancelEditName = () => {
    setEditingName(false);
    setNewName("");
  };

  const logout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      setMessage({ text: error.message, type: "error" });
      return;
    }
    onLogout();
  };

  const deleteAccount = async () => {
    const confirmed = window.confirm(
      "Delete your account permanently? This cannot be undone.",
    );
    if (!confirmed) return;

    setDeleting(true);
    setMessage(null);

    const { error: profileError } = await supabase
      .from("profiles")
      .delete()
      .eq("id", userId);

    if (profileError) {
      setMessage({ text: profileError.message, type: "error" });
      setDeleting(false);
      return;
    }

    const { error: signOutError } = await supabase.auth.signOut();
    setDeleting(false);

    if (signOutError) {
      setMessage({ text: signOutError.message, type: "error" });
      return;
    }

    onAccountDeleted();
  };

  const progress = getProgressPercent(totalSteps);
  const landmark = getNearestLandmark(totalSteps);

  if (loading) {
    return (
      <div className="screen">
        <div className="card">
          <p className="empty-state">Loading profile…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="card">
        <h2 className="section-title">{displayName || "Your journey"}</h2>

        <div className="section">
          <h3 className="section-title">Display name</h3>
          {editingName ? (
            <div className="name-edit-row">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Your name"
                maxLength={60}
                autoFocus
                style={{ marginBottom: 0 }}
              />
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => void saveName()}
                disabled={savingName}
              >
                {savingName ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={cancelEditName}
                disabled={savingName}
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="name-display-row">
              <span className="profile-name-value">
                {displayName || <em style={{ color: "#6e6e73" }}>No name set</em>}
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={startEditingName}
              >
                Edit
              </button>
            </div>
          )}
        </div>

        <div className="profile-stat">
          <span className="profile-stat-label">Total steps</span>
          <span className="profile-stat-value">
            {totalSteps.toLocaleString()}
          </span>
        </div>
        <div className="profile-stat">
          <span className="profile-stat-label">Progress to Mount Doom</span>
          <span className="profile-stat-value">{progress}%</span>
        </div>
        <div className="profile-stat">
          <span className="profile-stat-label">Nearest landmark</span>
          <span className="profile-stat-value">{landmark.name}</span>
        </div>

        <div className="section">
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void logout()}
            >
              Log out
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => void deleteAccount()}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete account"}
            </button>
          </div>
          <p className="profile-legal">
            <a href="/privacy-policy.html">Privacy Policy</a>
          </p>
        </div>

        {message && (
          <div className={`message ${message.type}`}>{message.text}</div>
        )}
      </div>
    </div>
  );
}
