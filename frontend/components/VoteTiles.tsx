"use client";

import { Vote } from "@/lib/api";
import { useAuth } from "@/lib/AuthContext";

export const VOTE_META: Record<Vote, { label: string; icon: string; active: string; badge: string }> = {
  yes: {
    label: "Yes",
    icon: "👍",
    active: "border-green-600 bg-green-50 text-green-800",
    badge: "bg-green-100 text-green-800",
  },
  maybe: {
    label: "Maybe",
    icon: "🤔",
    active: "border-amber-500 bg-amber-50 text-amber-800",
    badge: "bg-amber-100 text-amber-800",
  },
  no: {
    label: "No",
    icon: "👎",
    active: "border-red-500 bg-red-50 text-red-800",
    badge: "bg-red-100 text-red-800",
  },
  more_info: {
    label: "Need info",
    icon: "❓",
    active: "border-blue-500 bg-blue-50 text-blue-800",
    badge: "bg-blue-100 text-blue-800",
  },
};

const VOTE_ORDER: Vote[] = ["yes", "maybe", "no", "more_info"];

function displayName(email: string, selfEmail?: string) {
  if (selfEmail && email === selfEmail) return "You";
  const name = email.split("@")[0];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function VoteBadges({ votes }: { votes: Record<string, Vote> }) {
  const { session } = useAuth();
  const entries = Object.entries(votes ?? {});
  if (entries.length === 0) {
    return <span className="text-xs text-stone-400">No votes yet</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {entries.map(([email, vote]) => {
        const meta = VOTE_META[vote];
        return (
          <span
            key={email}
            title={`${email} voted ${meta.label}`}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${meta.badge}`}
          >
            {meta.icon} {displayName(email, session?.email)}: {meta.label}
          </span>
        );
      })}
    </div>
  );
}

export function VoteButtons({
  currentVote,
  onVote,
  disabled,
}: {
  currentVote: Vote | undefined;
  onVote: (vote: Vote) => void;
  disabled?: boolean;
}) {
  const { session } = useAuth();
  if (session?.role !== "owner") return null;
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-stone-400">Your vote</p>
      <div className="flex flex-wrap gap-1.5">
        {VOTE_ORDER.map((vote) => {
          const meta = VOTE_META[vote];
          const active = currentVote === vote;
          return (
            <button
              key={vote}
              type="button"
              disabled={disabled}
              onClick={(e) => {
                e.stopPropagation();
                onVote(vote);
              }}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition disabled:opacity-50 ${
                active ? meta.active : "border-stone-200 bg-white text-stone-500 hover:border-stone-400"
              }`}
            >
              {meta.icon} {meta.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
