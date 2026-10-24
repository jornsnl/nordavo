import { Mail, Phone } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

export function ContactCard() {
  return (
    <Card>
      <CardHeader title="Vragen of iets bespreken?" description="We denken graag mee, ook over je volgende vacature." />
      <CardBody className="space-y-3 text-sm pointer-coarse:space-y-0">
        <p className="font-display font-semibold text-brand-900">Nordavo</p>
        <a
          href="mailto:info@nordavo.nl"
          className="flex items-center gap-2 text-brand-700 hover:text-brand-900 hover:underline active:text-brand-900 pointer-coarse:min-h-11"
        >
          <Mail className="size-4 text-muted" aria-hidden="true" />
          info@nordavo.nl
        </a>
        <a
          href="tel:+31680227346"
          className="flex items-center gap-2 text-brand-700 hover:text-brand-900 hover:underline active:text-brand-900 pointer-coarse:min-h-11"
        >
          <Phone className="size-4 text-muted" aria-hidden="true" />
          +31 6 80227346
        </a>
      </CardBody>
    </Card>
  );
}
