import "server-only";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { getCurrentUser, hasModule } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { DialSettingForm } from "./dial-setting-form";

/** "Calling" in Settings and on the caller page: how the call buttons dial for you. */
export async function DialSettingCard() {
  const user = await getCurrentUser();
  if (user.role !== "caller" && !hasModule(user, "sales")) return null;
  // Callers have no table access of their own: their own row with the secret key.
  const supabase = user.role === "caller" ? createAdminClient() : await createClient();
  if (!supabase) return null;
  const { data, error } = await supabase.from("profiles").select("dial_template").eq("id", user.id).maybeSingle();
  if (error) return null;
  return (
    <Card>
      <CardHeader
        title="Calling"
        description="How the call button on the call screen and the call sheet dials. Calls your phone system reports come in at the lead with their recording."
      />
      <CardBody className="py-5">
        <DialSettingForm template={data?.dial_template ?? null} />
      </CardBody>
    </Card>
  );
}
