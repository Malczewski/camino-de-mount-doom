import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t, i18n } = useTranslation();
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
    setMessage({ text: t("profile.nameUpdated"), type: "success" });
  };

  const cancelEditName = () => {
    setEditingName(false);
    setNewName("");
  };

  const changePassword = async () => {
    if (newPassword !== confirmPassword) {
      setMessage({ text: t("profile.passwordsDoNotMatch"), type: "error" });
      return;
    }
    if (newPassword.length < 6) {
      setMessage({ text: t("profile.passwordTooShort"), type: "error" });
      return;
    }
    setSavingPassword(true);
    setMessage(null);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSavingPassword(false);
    if (error) {
      setMessage({ text: error.message, type: "error" });
    } else {
      setMessage({ text: t("profile.passwordChanged"), type: "success" });
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
    const confirmed = window.confirm(t("profile.deleteConfirm"));
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
          <p className="empty-state">{t("profile.loadingProfile")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="card">
        <h2 className="section-title">{displayName || t("profile.yourJourney")}</h2>

        <div className="section">
          <h3 className="section-title">{t("profile.displayName")}</h3>
          {editingName ? (
            <div className="name-edit-row">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t("profile.yourName")}
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
                {savingName ? t("profile.saving") : t("profile.save")}
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={cancelEditName}
                disabled={savingName}
              >
                {t("profile.cancel")}
              </button>
            </div>
          ) : (
            <div className="name-display-row">
              <span className="profile-name-value">
                {displayName || <em style={{ color: "#6e6e73" }}>{t("profile.noNameSet")}</em>}
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={startEditingName}
              >
                {t("profile.edit")}
              </button>
            </div>
          )}
        </div>

        <div className="profile-stat">
          <span className="profile-stat-label">{t("profile.totalSteps")}</span>
          <span className="profile-stat-value">
            {totalSteps.toLocaleString(i18n.language)}
          </span>
        </div>
        <div className="profile-stat">
          <span className="profile-stat-label">{t("profile.progressToMountDoom")}</span>
          <span className="profile-stat-value">{progress}%</span>
        </div>
        <div className="profile-stat">
          <span className="profile-stat-label">{t("profile.nearestLandmark")}</span>
          <span className="profile-stat-value">{landmark.name}</span>
        </div>

        {apiKey && (
          <div className="section">
            <h3 className="section-title">{t("profile.garminSetup")}</h3>
            <a
              href="https://apps.garmin.com/apps/7298dd51-99a7-434c-b19e-9a50334c5976"
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary btn-sm"
              style={{ display: "inline-flex", marginBottom: "0.75rem", textDecoration: "none" }}
            >
              {t("profile.garminDownload")}
            </a>
            <p style={{ fontSize: "0.875rem", color: "#6e6e73", marginBottom: "0.75rem" }}>
              {t("profile.garminInstructions")}
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
                {apiKeyCopied ? t("profile.copied") : t("profile.copy")}
              </button>
            </div>
          </div>
        )}

        <div className="section">
          <h3 className="section-title">{t("profile.password")}</h3>
          {changingPassword ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <input
                type="password"
                placeholder={t("profile.newPassword")}
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={6}
                style={{ marginBottom: 0 }}
              />
              <input
                type="password"
                placeholder={t("profile.confirmPassword")}
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
                  {savingPassword ? t("profile.saving") : t("profile.save")}
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
                  {t("profile.cancel")}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => { setChangingPassword(true); setMessage(null); }}
            >
              {t("profile.changePassword")}
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
              {t("profile.logOut")}
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => void deleteAccount()}
              disabled={deleting}
            >
              {deleting ? t("profile.deleting") : t("profile.deleteAccount")}
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
