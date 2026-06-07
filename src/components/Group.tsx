import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getProgressPercent } from "../lib/mapPosition";
import { supabase, type Group, type GroupMember } from "../lib/supabase";

interface GroupProps {
  userId: string;
  userGroups: Group[];
  activeGroupId: string | null;
  onGroupsChange: () => Promise<void>;
  onActiveGroupChange: (groupId: string | null) => void;
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
  userGroups,
  activeGroupId,
  onGroupsChange,
  onActiveGroupChange,
}: GroupProps) {
  const { t, i18n } = useTranslation();
  const [groupMemberMap, setGroupMemberMap] = useState<Record<string, GroupMember[]>>({});
  const [copiedGroupId, setCopiedGroupId] = useState<string | null>(null);
  const [groupName, setGroupName] = useState("");
  const [inviteInput, setInviteInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{
    text: string;
    type: "error" | "success";
  } | null>(null);

  const loadMembersForGroup = useCallback(async (groupId: string) => {
    const { data, error } = await supabase.rpc("get_group_members", { p_group_id: groupId });
    if (error) return;
    setGroupMemberMap((prev) => ({ ...prev, [groupId]: (data ?? []) as GroupMember[] }));
  }, []);

  useEffect(() => {
    for (const group of userGroups) {
      void loadMembersForGroup(group.id);
    }
  }, [userGroups, loadMembersForGroup]);

  // Realtime: refresh members when step_logs or profiles change
  useEffect(() => {
    if (userGroups.length === 0) return;

    const channels = userGroups.map((group) =>
      supabase
        .channel(`group-screen-${group.id}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "step_logs" },
          () => void loadMembersForGroup(group.id),
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "profiles" },
          () => void loadMembersForGroup(group.id),
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "group_members",
            filter: `group_id=eq.${group.id}`,
          },
          () => void loadMembersForGroup(group.id),
        )
        .subscribe(),
    );

    return () => {
      for (const ch of channels) void supabase.removeChannel(ch);
    };
  }, [userGroups, loadMembersForGroup]);

  const createGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = groupName.trim();
    if (!name) {
      setMessage({ text: t("group.enterGroupName"), type: "error" });
      return;
    }

    setLoading(true);
    setMessage(null);

    const inviteCode = generateInviteCode();
    const { data: newGroup, error: createError } = await supabase
      .from("groups")
      .insert({ name, invite_code: inviteCode })
      .select("id, name, invite_code, created_at")
      .single();

    if (createError || !newGroup) {
      setMessage({
        text: createError?.message ?? t("group.couldNotCreate"),
        type: "error",
      });
      setLoading(false);
      return;
    }

    const { error: joinError } = await supabase
      .from("group_members")
      .insert({ group_id: newGroup.id, user_id: userId });

    if (joinError) {
      setMessage({ text: joinError.message, type: "error" });
      setLoading(false);
      return;
    }

    setGroupName("");
    await onGroupsChange();
    onActiveGroupChange(newGroup.id);
    setLoading(false);
    setMessage({ text: t("group.groupCreated", { name }), type: "success" });
  };

  const joinGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = inviteInput.trim().toUpperCase();
    if (code.length !== 8) {
      setMessage({ text: t("group.inviteCodeLength"), type: "error" });
      return;
    }

    setLoading(true);
    setMessage(null);

    const { data: found, error: findError } = await supabase
      .from("groups")
      .select("id, name")
      .eq("invite_code", code)
      .maybeSingle();

    if (findError || !found) {
      setMessage({
        text: findError?.message ?? t("group.groupNotFound"),
        type: "error",
      });
      setLoading(false);
      return;
    }

    if (userGroups.some((g) => g.id === found.id)) {
      setMessage({ text: t("group.alreadyInGroup"), type: "error" });
      setLoading(false);
      return;
    }

    const { error: insertError } = await supabase
      .from("group_members")
      .insert({ group_id: found.id, user_id: userId });

    if (insertError) {
      setMessage({ text: insertError.message, type: "error" });
      setLoading(false);
      return;
    }

    setInviteInput("");
    await onGroupsChange();
    onActiveGroupChange(found.id);
    setLoading(false);
    setMessage({ text: t("group.groupJoined", { name: found.name }), type: "success" });
  };

  const leaveGroup = async (groupId: string) => {
    setLoading(true);
    setMessage(null);

    const { error } = await supabase
      .from("group_members")
      .delete()
      .eq("group_id", groupId)
      .eq("user_id", userId);

    if (error) {
      setMessage({ text: error.message, type: "error" });
      setLoading(false);
      return;
    }

    if (activeGroupId === groupId) {
      const remaining = userGroups.filter((g) => g.id !== groupId);
      onActiveGroupChange(remaining[0]?.id ?? null);
    }

    await onGroupsChange();
    setGroupMemberMap((prev) => {
      const next = { ...prev };
      delete next[groupId];
      return next;
    });
    setLoading(false);
    setMessage({ text: t("group.groupLeft"), type: "success" });
  };

  const copyInviteCode = async (group: Group) => {
    try {
      await navigator.clipboard.writeText(group.invite_code);
      setCopiedGroupId(group.id);
      setTimeout(() => setCopiedGroupId(null), 2000);
    } catch {
      setMessage({ text: t("group.couldNotCopy"), type: "error" });
    }
  };

  return (
    <div className="screen">
      {userGroups.length === 0 && (
        <div className="card">
          <p className="empty-state" style={{ paddingBottom: 0 }}>
            {t("group.noFellowship")}
          </p>
        </div>
      )}

      {userGroups.map((group) => {
        const members = groupMemberMap[group.id] ?? [];
        const isActive = activeGroupId === group.id;
        return (
          <div key={group.id} className={`card group-card${isActive ? " group-card-active" : ""}`}>
            <div className="group-card-header">
              <div>
                <h2 className="section-title" style={{ marginBottom: 2 }}>{group.name}</h2>
                <p className="group-start-date">
                  {t("group.trackingSince", {
                    date: new Date(group.created_at).toLocaleDateString(i18n.language, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    }),
                  })}
                </p>
              </div>
              {isActive ? (
                <span className="group-active-badge">{t("group.onMap")}</span>
              ) : (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => onActiveGroupChange(group.id)}
                >
                  {t("group.viewOnMap")}
                </button>
              )}
            </div>

            <div className="section">
              <p className="subtitle" style={{ marginBottom: 8, textAlign: "left" }}>
                {t("group.inviteCode")}
              </p>
              <div className="invite-row">
                <div className="invite-code">{group.invite_code}</div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void copyInviteCode(group)}
                >
                  {copiedGroupId === group.id ? t("group.copied") : t("group.copy")}
                </button>
              </div>
            </div>

            <div className="section">
              <h3 className="section-title">{t("group.members", { count: members.length })}</h3>
              {members.length === 0 ? (
                <p className="empty-state">{t("group.noMembers")}</p>
              ) : (
                <ul className="member-list">
                  {members.map((member) => (
                    <li key={member.id} className="member-item">
                      <span className="member-name">
                        {member.display_name}
                        {member.id === userId ? t("group.you") : ""}
                      </span>
                      <span className="member-meta">
                        {member.group_steps.toLocaleString(i18n.language)} {t("group.steps")}
                        <br />
                        {getProgressPercent(member.group_steps)}%
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
                onClick={() => void leaveGroup(group.id)}
                disabled={loading}
              >
                {t("group.leaveGroup")}
              </button>
            </div>
          </div>
        );
      })}

      <div className="card">
        <div className="section">
          <h2 className="section-title">{t("group.joinWithCode")}</h2>
          <form onSubmit={(e) => void joinGroup(e)}>
            <label htmlFor="invite-code">{t("group.eightCharCode")}</label>
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
              {t("group.joinGroup")}
            </button>
          </form>
        </div>

        <div className="section">
          <h2 className="section-title">{t("group.createFellowship")}</h2>
          <form onSubmit={(e) => void createGroup(e)}>
            <label htmlFor="group-name">{t("group.groupName")}</label>
            <input
              id="group-name"
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder={t("group.createFellowship")}
              maxLength={60}
            />
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {t("group.createGroup")}
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
