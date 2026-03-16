import { FormPageShell } from '@/components/FormPageShell';
import { AppCheckboxGroup } from '@/components/AppCheckboxGroup';

export default function RequestPage() {
  return (
    <FormPageShell
      formspreeId="xojkkago"
      title="I Have a Request"
      subtitle="Have a feature idea or improvement suggestion? Let me know."
      submitLabel="Submit Request"
      successMessage="Request received!"
      successDetail="Thank you for your suggestion. I'll review it soon."
    >
      <AppCheckboxGroup />
    </FormPageShell>
  );
}
