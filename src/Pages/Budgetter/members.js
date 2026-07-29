// Shared display helpers for household members. Clerk user ids are the only
// identity the budget database stores (no emails, ever), so a member who
// hasn't been given a display name is shown as a short id fragment rather
// than a raw `user_2abc…` string.

/** Everyone still in the household, in join order. */
export const activeMembers = (members = []) => members.filter((m) => !m.removedAt);

/** "You" / "Sarah" / "Member 3f2a" — never a raw Clerk id. */
export const memberLabel = (member, youUserId) => {
  if (!member) return "Someone";
  if (member.displayName) return member.displayName;
  if (member.userId === youUserId) return "You";
  return `Member ${String(member.userId).slice(-4)}`;
};

/** Same, starting from a bare user id (for rows that carry only `added_by`). */
export const labelForUserId = (userId, members = [], youUserId) => {
  if (!userId) return "Someone";
  const found = members.find((m) => m.userId === userId);
  if (found) return memberLabel(found, youUserId);
  if (userId === youUserId) return "You";
  return `Member ${String(userId).slice(-4)}`;
};

/** A stable 2-character monogram for member avatars. */
export const memberInitials = (label) => {
  const words = String(label).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
};
