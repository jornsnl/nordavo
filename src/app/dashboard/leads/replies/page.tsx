import type { Metadata } from "next";
import { Suspense } from "react";
import { MessageSquareText } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { PageHeader } from "@/components/dashboard/page-header";
import { ReplyReviewCard } from "@/components/leads/reply-review-card";
import { ListSkeleton } from "@/components/ui/skeleton";
import { listRepliesToReview } from "@/lib/sales/replies";
import { acceptReplyAction, acceptWithOutcomeAction, rejectReplyAction } from "./actions";

export const metadata: Metadata = {
  title: "Replies to review",
};

export default function Page() {
  return (
    <>
      <PageHeader
        eyebrow="Leads"
        title="Replies to review"
        description="Replies Claude fetched from Instantly and Seleqt and was not sure about. Accept Claude's suggestion with one click, pick another outcome, or reject it. A reply only moves the company once you accept it; the company is already paused in every sequence."
      />
      <Suspense fallback={<ListSkeleton rows={4} />}>
        <Replies />
      </Suspense>
    </>
  );
}

async function Replies() {
  const replies = await listRepliesToReview();
  if (replies.length === 0) {
    return (
      <EmptyState
        icon={MessageSquareText}
        title="Nothing to review"
        description="When Claude marks a reply as doubtful, it shows up here with its suggestion."
      />
    );
  }
  return (
    <>
      <p className="mb-4 text-sm text-muted">
        {replies.length} {replies.length === 1 ? "reply waits" : "replies wait"} for you, oldest first.
      </p>
      <ul className="space-y-4">
        {replies.map((reply) => (
          <ReplyReviewCard
            key={reply.id}
            reply={reply}
            acceptAction={acceptReplyAction.bind(null, reply.id)}
            rejectAction={rejectReplyAction.bind(null, reply.id)}
            otherAction={acceptWithOutcomeAction.bind(null, reply.id)}
          />
        ))}
      </ul>
    </>
  );
}
