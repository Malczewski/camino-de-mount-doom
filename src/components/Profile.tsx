import { useEffect, useState } from "react";
import {
  getNearestLandmark,
  getProgressPercent,
} from "../lib/mapPosition";
import { supabase } from "../lib/supabase";

interface ProfileProps {
  userId: string;
  onAccountDeleted: () => void;
}

export default function Profile({ userId, onAccountDeleted }: ProfileProps) {
  const [totalSteps, setTotalSteps] = useState(0);
  const [displayName, setDisplayName] = useState("");
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
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => void deleteAccount()}
            disabled={deleting}
          >
            {deleting ? "Deleting…" : "Delete account"}
          </button>
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
