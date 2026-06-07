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
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [apiKeyCopied, setApiKeyCopied] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    type: "error" | "success";
  } | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    const loadProfile = async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("display_name, total_steps, api_key")
        .eq("id", userId)
        .single();

      if (error) {
        setMessage({ text: error.message, type: "error" });
      } else if (data) {
        setDisplayName(data.display_name ?? "");
        setTotalSteps(data.total_steps ?? 0);
        setApiKey(data.api_key ?? null);
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

  const changePassword = async () => {
    if (newPassword !== confirmPassword) {
      setMessage({ text: "Passwords don't match.", type: "error" });
      return;
    }
    if (newPassword.length < 6) {
      setMessage({ text: "Password must be at least 6 characters.", type: "error" });
      return;
    }
    setSavingPassword(true);
    setMessage(null);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSavingPassword(false);
    if (error) {
      setMessage({ text: error.message, type: "error" });
    } else {
      setMessage({ text: "Password changed!", type: "success" });
      setChangingPassword(false);
      setNewPassword("");
      setConfirmPassword("");
    }
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

  const copyApiKey = async () => {
    if (!apiKey) return;
    await navigator.clipboard.writeText(apiKey);
    setApiKeyCopied(true);
    setTimeout(() => setApiKeyCopied(false), 2000);
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

        {apiKey && (
          <div className="section">
            <h3 className="section-title">Garmin watch setup</h3>
            <p style={{ fontSize: "0.875rem", color: "#6e6e73", marginBottom: "0.75rem" }}>
              In the Garmin Connect IQ app, open this app's settings and paste your API key into the "API Key" field.
            </p>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <code style={{
                flex: 1,
                background: "#f5f5f7",
                border: "1px solid #d2d2d7",
                borderRadius: "6px",
                padding: "8px 10px",
                fontSize: "0.8rem",
                wordBreak: "break-all",
                color: "#1d1d1f",
              }}>
                {apiKey}
              </code>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => void copyApiKey()}
                style={{ whiteSpace: "nowrap" }}
              >
                {apiKeyCopied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
        )}

        <div className="section">
          <h3 className="section-title">Password</h3>
          {changingPassword ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <input
                type="password"
                placeholder="New password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={6}
                style={{ marginBottom: 0 }}
              />
              <input
                type="password"
                placeholder="Confirm password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={6}
                style={{ marginBottom: 0 }}
              />
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => void changePassword()}
                  disabled={savingPassword}
                >
                  {savingPassword ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setChangingPassword(false);
                    setNewPassword("");
                    setConfirmPassword("");
                  }}
                  disabled={savingPassword}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => { setChangingPassword(true); setMessage(null); }}
            >
              Change password
            </button>
          )}
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
