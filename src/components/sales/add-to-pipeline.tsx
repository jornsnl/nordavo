"use client";

import { useActionState, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { SubmitButton } from "@/components/ui/submit-button";
import { labelOf, pipelineEntryStages, pipelineStages } from "@/lib/sales/labels";
import { addToPipeline, searchPipelineCandidates, type AddToPipelineState } from "./actions";
import { CompanyPicker } from "./company-picker";

/**
 * Add company on the pipeline page: pick one or more warm leads and put
 * them in at Contact or Interested. The lead page has the same in one click.
 */
export function AddToPipelineButton() {
  const [open, setOpen] = useState(false);
  const [round, setRound] = useState(0);
  const [state, formAction] = useActionState(async (prev: AddToPipelineState, formData: FormData) => {
    const result = await addToPipeline(prev, formData);
    if (result.ok) {
      setRound((r) => r + 1);
      setOpen(false);
    }
    return result;
  }, {} as AddToPipelineState);

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" />
        Add company
      </Button>
      {state.ok && state.message && !open && (
        <p role="status" className="sr-only">
          {state.message}
        </p>
      )}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add to the pipeline"
        description="For warm leads: companies you were in touch with that need follow up."
      >
        <form action={formAction} className="space-y-4">
          <CompanyPicker key={round} search={searchPipelineCandidates} label="Company" />
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-ink">Stage</legend>
            {pipelineEntryStages.map((s, i) => (
              <label key={s} className="flex items-start gap-2 text-sm">
                <input type="radio" name="stage" value={s} defaultChecked={i === 0} className="mt-0.5" />
                <span>
                  <span className="font-medium">{labelOf(pipelineStages, s)}</span>
                  <span className="block text-muted">
                    {s === "contact"
                      ? "Two way contact, no clear interest yet. For example \"send some info\" or \"call back in a month\"."
                      : "They showed interest."}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <FormMessage error={state.error} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton pendingLabel="Adding">Add to the pipeline</SubmitButton>
          </div>
        </form>
      </Modal>
    </>
  );
}
