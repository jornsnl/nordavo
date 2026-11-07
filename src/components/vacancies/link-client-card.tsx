"use client";

import { startTransition, useActionState } from "react";
import { Link2, LoaderCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormMessage } from "@/components/ui/field";
import { initialActionState, type ActionState } from "@/lib/action-state";
import { TALENT_POOL_LABEL } from "@/lib/talent/talent-pool";
import { OwnerPicker } from "./owner-picker";

type Option = { id: string; label: string };

/**
 * On a talent pool vacancy: link it to a client or prospect, which turns it
 * into a normal vacancy. The three-week clock starts at that moment.
 */
export function LinkClientCard({
  action,
  clients,
  companies,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  clients: Option[];
  companies: Option[];
}) {
  const [state, formAction, pending] = useActionState(action, initialActionState);

  return (
    <Card>
      <CardHeader
        title="Link to a client"
        description="This vacancy is in the talent pool: no three-week clock and not counted on the dashboard or in the report."
        actions={<Badge tone="accent">{TALENT_POOL_LABEL}</Badge>}
      />
      <CardBody>
        <form
          className="space-y-4"
          noValidate
          onSubmit={(event) => {
            // Submit manually so React does not reset the fields when validation fails.
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            startTransition(() => formAction(formData));
          }}
        >
          <FormMessage error={state.error} success={state.message} />
          <OwnerPicker
            clients={clients}
            companies={companies}
            defaultOwnerType="client"
            allowTalentPool={false}
            errors={state.fieldErrors ?? {}}
            legend="Link this vacancy to"
          />
          <p className="text-sm text-muted">
            Once linked, it is a normal vacancy: the clock towards three candidates within three weeks starts today
            and it counts on the dashboard and in the report.
          </p>
          <Button type="submit" disabled={pending} aria-busy={pending}>
            {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Link2 aria-hidden="true" />}
            {pending ? "Linking" : "Link vacancy"}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
