"use client";

import { Vote } from "@/lib/api";
import { useAuth } from "@/lib/AuthContext";

export const VOTE_META: Record<Vote, { label: string; color: string; short: string }> = {
  yes: { label: "Yes", color: "bg-green-100 text-green-800 border-green-300", short: "Y" },
  maybe: { label: "Maybe", color: "bg-amber-100 text-amber-800 border-amber-300", short: "M" },
  no: { label: "No", color: "bg-red-100 text-red-800 border-red-300", short: "N" },
  more_info: { label: "Need info", color: "bg-blue-100 text-blue-800 border-blue-300", short: "?" },
};

const VOTE_ORDER: Vote[] = ["yes", "maybe", "no", "more_info"];

export function VoteBadges({ votes }: { votes: Record<string, Vote> }) {
  const entries = Object.entries(votes ?? {});
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map(([email, vote]) => {
        const meta = VOTE_META[vote];
        return (
          <span
            key={email}
            title={`${email}: ${meta.label}`}
            className={`rounded border px-1.5 py-0.5 text-xs ${meta.color}`}
          >
            {email.split("@")[0]}: {meta.label}
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
    <div className="flex gap-1">
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
            className={`rounded border px-2 py-1 text-xs disabled:opacity-50 ${
              active ? meta.color : "border-gray-200 text-gray-500 hover:bg-gray-50"
            }`}
          >
            {meta.label}
          </button>
        );
      })}
    </div>
  );
}
