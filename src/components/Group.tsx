import { useCallback, useEffect, useRef, useState } from "react";
import { getProgressPercent } from "../lib/mapPosition";
import { supabase, type Group, type GroupMember } from "../lib/supabase";

interface GroupProps {
  userId: string;
  groupId: string | null;
  onGroupChange: (groupId: string | null) => void;
}

function generateInviteCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(
    { length: 8 },
    () => chars[Math.floor(Math.random() * chars.length)],
  ).join("");
}

export default function GroupScreen({
  userId,
  groupId,
  onGroupChange,
}: GroupProps) {
  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [groupName, setGroupName] = useState("");
  const [inviteInput, setInviteInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    type: "error" | "success";
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const memberIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    memberIdsRef.current = new Set(members.map((m) => m.id));
  }, [members]);

  const loadGroup = useCallback(async () => {
    if (!groupId) {
      setGroup(null);
      setMembers([]);
      return;
    }

    const [groupRes, membersRes] = await Promise.all([
      supabase.from("groups").select("id, name, invite_code").eq("id", groupId).single(),
      supabase
        .from("profiles")
        .select("id, display_name, total_steps, group_id")
        .eq("group_id", groupId),
    ]);

    if (groupRes.error) {
      setMessage({ text: groupRes.error.message, type: "error" });
      return;
    }

    if (membersRes.error) {
      setMessage({ text: membersRes.error.message, type: "error" });
      return;
    }

    setGroup(groupRes.data);
    setMembers(
      (membersRes.data ?? []).map((m) => ({
        ...m,
        display_name: m.display_name ?? "Traveler",
      })),
    );
  }, [groupId]);

  useEffect(() => {
    void loadGroup();
  }, [loadGroup]);

  useEffect(() => {
    if (!groupId) return;

    const refreshMemberSteps = async (userIds: string[]) => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, display_name, total_steps, group_id")
        .in("id", userIds);

      if (error || !data) return;

      setMembers((prev) => {
        const updates = new Map(data.map((p) => [p.id, p]));
        return prev.map((m) => {
          const updated = updates.get(m.id);
          if (!updated) return m;
          return {
            ...updated,
            display_name: updated.display_name ?? "Traveler",
          };
        });
      });
    };

    const channel = supabase
      .channel(`group-${groupId}-steps`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "step_logs" },
        (payload) => {
          const row = payload.new as { user_id?: string } | null;
          const userIdFromEvent =
            row?.user_id ??
            (payload.old as { user_id?: string } | null)?.user_id;
          if (userIdFromEvent && memberIdsRef.current.has(userIdFromEvent)) {
            void refreshMemberSteps([userIdFromEvent]);
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles" },
        (payload) => {
          const row = payload.new as { id?: string };
          if (row.id && memberIdsRef.current.has(row.id)) {
            void refreshMemberSteps([row.id]);
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [groupId]);

  const createGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = groupName.trim();
    if (!name) {
      setMessage({ text: "Enter a group name.", type: "error" });
      return;
    }

    setLoading(true);
    setMessage(null);

    const inviteCode = generateInviteCode();
    const { data: newGroup, error: createError } = await supabase
      .from("groups")
      .insert({ name, invite_code: inviteCode })
      .select("id, name, invite_code")
      .single();

    if (createError || !newGroup) {
      setMessage({
        text: createError?.message ?? "Could not create group.",
        type: "error",
      });
      setLoading(false);
      return;
    }

    const { error: joinError } = await supabase
      .from("profiles")
      .update({ group_id: newGroup.id })
      .eq("id", userId);

    setLoading(false);

    if (joinError) {
      setMessage({ text: joinError.message, type: "error" });
      return;
    }

    setGroupName("");
    onGroupChange(newGroup.id);
    setMessage({ text: "Group created!", type: "success" });
  };

  const joinGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = inviteInput.trim().toUpperCase();
    if (code.length !== 8) {
      setMessage({ text: "Invite code must be 8 characters.", type: "error" });
      return;
    }

    setLoading(true);
    setMessage(null);

    const { data: found, error: findError } = await supabase
      .from("groups")
      .select("id")
      .eq("invite_code", code)
      .maybeSingle();

    if (findError || !found) {
      setMessage({
        text: findError?.message ?? "Group not found. Check the invite code.",
        type: "error",
      });
      setLoading(false);
      return;
    }

    const { error: updateError } = await supabase
      .from("profiles")
      .update({ group_id: found.id })
      .eq("id", userId);

    setLoading(false);

    if (updateError) {
      setMessage({ text: updateError.message, type: "error" });
      return;
    }

    setInviteInput("");
    onGroupChange(found.id);
    setMessage({ text: "Joined group!", type: "success" });
  };

  const leaveGroup = async () => {
    if (!groupId) return;
    setLoading(true);
    setMessage(null);

    const { error } = await supabase
      .from("profiles")
      .update({ group_id: null })
      .eq("id", userId);

    setLoading(false);

    if (error) {
      setMessage({ text: error.message, type: "error" });
      return;
    }

    onGroupChange(null);
    setMessage({ text: "You left the group.", type: "success" });
  };

  const copyInviteCode = async () => {
    if (!group?.invite_code) return;
    try {
      await navigator.clipboard.writeText(group.invite_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMessage({ text: "Could not copy to clipboard.", type: "error" });
    }
  };

  if (!groupId || !group) {
    return (
      <div className="screen">
        <div className="card">
          <div className="section">
            <h2 className="section-title">Create a fellowship</h2>
            <form onSubmit={createGroup}>
              <label htmlFor="group-name">Group name</label>
              <input
                id="group-name"
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="The Fellowship"
                maxLength={60}
              />
              <button type="submit" className="btn btn-primary" disabled={loading}>
                Create group
              </button>
            </form>
          </div>

          <div className="section">
            <h2 className="section-title">Join with invite code</h2>
            <form onSubmit={joinGroup}>
              <label htmlFor="invite-code">8-character code</label>
              <input
                id="invite-code"
                type="text"
                value={inviteInput}
                onChange={(e) => setInviteInput(e.target.value.toUpperCase())}
                placeholder="AB12CD34"
                maxLength={8}
                autoCapitalize="characters"
              />
              <button type="submit" className="btn btn-primary" disabled={loading}>
                Join group
              </button>
            </form>
          </div>

          {message && (
            <div className={`message ${message.type}`}>{message.text}</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="card">
        <h2 className="section-title">{group.name}</h2>

        <div className="section">
          <p className="subtitle" style={{ marginBottom: 12, textAlign: "left" }}>
            Invite code
          </p>
          <div className="invite-row">
            <div className="invite-code">{group.invite_code}</div>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void copyInviteCode()}
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>

        <div className="section">
          <h3 className="section-title">Members ({members.length})</h3>
          {members.length === 0 ? (
            <p className="empty-state">No members yet.</p>
          ) : (
            <ul className="member-list">
              {members.map((member) => (
                <li key={member.id} className="member-item">
                  <span className="member-name">
                    {member.display_name}
                    {member.id === userId ? " (you)" : ""}
                  </span>
                  <span className="member-meta">
                    {member.total_steps.toLocaleString()} steps
                    <br />
                    {getProgressPercent(member.total_steps)}%
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="row-actions">
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => void leaveGroup()}
            disabled={loading}
          >
            Leave group
          </button>
        </div>

        {message && (
          <div className={`message ${message.type}`}>{message.text}</div>
        )}
      </div>
    </div>
  );
}
